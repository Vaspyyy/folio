import { syncMobile, shareSavedPages } from "./portable/bridge.js";
import { Library, openDatabase } from "./core/database.js";
import { canonicalUrl } from "./core/model.js";

const library = openDatabase().then((db) => new Library(db));
const DISCOVERY_ALARM = "folio:discovery";
const DISCOVERY_STATE = "folio:discovery-state";
const SIX_HOURS = 6 * 60;
let discoveryRun = null;
let offscreenOpening = null;
let offscreenClosing = null;
let offscreenUsers = 0;

const openLibrary = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });

function readerUrl(url, page = 1) {
  const target = new URL(chrome.runtime.getURL("reader.html"));
  target.searchParams.set("url", canonicalUrl(url));
  if (Number.isInteger(page) && page > 1)
    target.searchParams.set("page", String(page));
  target.hash = `folio-page=${Math.max(1, Number(page) || 1)}`;
  return target.href;
}

const openReader = (url, page = 1) =>
  chrome.tabs.create({ url: readerUrl(url, page) });

async function ensureDiscoveryAlarm(delayInMinutes = SIX_HOURS) {
  const existing = await chrome.alarms.get(DISCOVERY_ALARM);
  if (!existing)
    chrome.alarms.create(DISCOVERY_ALARM, {
      delayInMinutes,
      periodInMinutes: SIX_HOURS,
    });
}

async function ensureOffscreen() {
  if (offscreenClosing) await offscreenClosing;
  if (await chrome.offscreen.hasDocument()) return;
  if (!offscreenOpening) {
    offscreenOpening = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["DOM_PARSER"],
        justification:
          "Parse source HTML for saved reading pages and catalog metadata without opening source tabs.",
      })
      .finally(() => {
        offscreenOpening = null;
      });
  }
  await offscreenOpening;
}

async function withOffscreen(task) {
  offscreenUsers++;
  try {
    await ensureOffscreen();
    return await task();
  } finally {
    offscreenUsers--;
    if (
      !offscreenUsers &&
      (await chrome.offscreen.hasDocument()) &&
      !offscreenUsers
    ) {
      offscreenClosing = chrome.offscreen
        .closeDocument()
        .catch(() => {})
        .finally(() => {
          offscreenClosing = null;
        });
      await offscreenClosing;
    }
  }
}

const syncSavedLibrary = (db, retryPages = false) =>
  syncMobile(db, {
    retryPages,
    pageProvider: (url) =>
      withOffscreen(async () => {
        const response = await chrome.runtime.sendMessage({
          type: "offscreen:readerPages",
          url: canonicalUrl(url),
        });
        if (!response?.ok)
          throw new Error(response?.error || "Reading pages unavailable");
        return response.value;
      }),
  });

async function discoveryStatus() {
  const stored = await chrome.storage.local.get(DISCOVERY_STATE);
  return (
    stored[DISCOVERY_STATE] || {
      running: false,
      lastRunAt: null,
      lastSuccessAt: null,
      stats: null,
      error: null,
    }
  );
}

async function writeDiscoveryState(patch) {
  const current = await discoveryStatus();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [DISCOVERY_STATE]: next });
  return next;
}

async function runDiscovery({ manual = false } = {}) {
  if (discoveryRun) return discoveryRun;
  discoveryRun = (async () => {
    const startedAt = Date.now();
    await writeDiscoveryState({
      running: true,
      lastRunAt: startedAt,
      error: null,
    });
    try {
      const db = await library;
      const [catalog, entries] = await Promise.all([
        db.catalog(2500),
        db.list(),
      ]);
      const now = Date.now();
      const detailFreshMs = 7 * 24 * 60 * 60 * 1000;
      const skipDetailIds = catalog
        .filter(
          (item) =>
            item.detailObservedAt &&
            now - item.detailObservedAt < detailFreshMs,
        )
        .map((item) => item.id);
      const followedUrls = entries
        .filter((entry) => entry.personal.following)
        .map((entry) => entry.metadata.url)
        .slice(0, 20);

      const response = await withOffscreen(() =>
        chrome.runtime.sendMessage({
          type: "offscreen:discover",
          options: {
            roots: ["https://multporn.net/"],
            maxListingPages: manual ? 6 : 4,
            maxDetails: manual ? 18 : 12,
            requestDelayMs: manual ? 250 : 400,
            skipDetailIds,
            followedUrls,
          },
        }),
      );
      if (!response?.ok)
        throw new Error(response?.error || "Background parser unavailable");

      const { listings, details, followed, stats } = response.value;
      if (listings.length) await db.observeCatalog(listings, false);
      if (details.length) await db.observeCatalog(details, true);
      for (const metadata of followed) {
        try {
          await db.save(metadata, true);
        } catch {}
      }
      const state = await writeDiscoveryState({
        running: false,
        lastSuccessAt: Date.now(),
        stats,
        error: null,
      });
      return state;
    } catch (error) {
      await writeDiscoveryState({
        running: false,
        error: error.message,
      });
      throw error;
    } finally {
      discoveryRun = null;
    }
  })();
  return discoveryRun;
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDiscoveryAlarm(1).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  ensureDiscoveryAlarm(5).catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DISCOVERY_ALARM)
    runDiscovery({ manual: false }).catch(() => {});
});
ensureDiscoveryAlarm().catch(() => {});

chrome.action.onClicked.addListener(openLibrary);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type?.startsWith("offscreen:")) return;
  (async () => {
    const ownPage = sender.url?.startsWith(chrome.runtime.getURL(""));
    if (!ownPage) {
      if (new URL(sender.url).origin !== "https://multporn.net")
        throw new Error("Unsupported source");
      if (
        ![
          "get",
          "save",
          "refresh",
          "progress",
          "open",
          "openReader",
          "listingStatus",
          "saveListing",
          "observeCatalog",
        ].includes(message.type)
      )
        throw new Error("Unsupported site action");
      if (
        ![
          "open",
          "openReader",
          "listingStatus",
          "saveListing",
          "observeCatalog",
        ].includes(message.type) &&
        canonicalUrl(message.url || message.metadata?.url) !==
          canonicalUrl(sender.url)
      )
        throw new Error("Title does not match the current page");
    }

    if (message.type === "open") {
      await openLibrary();
      return null;
    }
    if (message.type === "openReader") {
      await openReader(
        message.url || sender.url,
        Number.isInteger(message.page) ? message.page : 1,
      );
      return null;
    }
    if (message.type === "runDiscovery")
      return runDiscovery({ manual: message.manual !== false });
    if (message.type === "discoveryStatus") return discoveryStatus();

    const db = await library;
    switch (message.type) {
      case "mobileSync":
        return syncSavedLibrary(db, true);
      case "mobilePages":
        await shareSavedPages(db, message.url, message.pages);
        // The reader sends this without waiting. Complete the send attempt here;
        // a network failure leaves the saved list available for periodic retry.
        await syncSavedLibrary(db).catch(() => {});
        return null;

      case "catalog":
        return db.catalog(message.limit);
      case "observeCatalog":
        return db.observeCatalog(message.items, message.authoritative === true);
      case "listingStatus": {
        if (!Array.isArray(message.urls) || message.urls.length > 100)
          throw new Error("Invalid listing request");
        const values = await Promise.all(
          message.urls.map((url) => db.get(canonicalUrl(url))),
        );
        return values
          .filter(Boolean)
          .map((e) => ({ url: e.metadata.url, status: e.personal.status }));
      }
      case "saveListing": {
        const existing = await db.get(canonicalUrl(message.metadata?.url));
        const saved = existing || (await db.save(message.metadata));
        return { url: saved.metadata.url, status: saved.personal.status };
      }
      case "acknowledge":
        return db.acknowledge(message.url);
      case "reorder":
        return db.reorder(message.urls, message.scope);
      case "list":
        return db.list();
      case "get":
        return db.get(message.url);
      case "refresh":
        return db.save(message.metadata, true);
      case "save":
        return db.save(message.metadata);
      case "progress":
        return db.progress(
          message.url,
          message.page,
          message.automatic === true,
        );
      case "update":
        return db.update(message.url, message.patch);
      case "remove":
        return db.remove(message.url);
      case "export":
        return db.export();
      case "import":
        return db.import(message.data);
      default:
        throw new Error("Unknown library action");
    }
  })().then(
    (value) => reply({ ok: true, value }),
    (error) => reply({ ok: false, error: error.message }),
  );
  return true;
});

chrome.alarms.get("folio-mobile-sync").then((alarm) => {
  if (!alarm) chrome.alarms.create("folio-mobile-sync", { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "folio-mobile-sync")
    library.then((db) => syncSavedLibrary(db)).catch(() => {});
});
