import { imageFetch } from "./native-images.js";
import { setupTutorial } from "./tutorial.js";
import { openRepository } from "../../../packages/portable-core/repository.js";
import { itemsOf, randomHex } from "../../../packages/portable-core/model.js";
import {
  createPair,
  syncRepository,
  downloadTitle,
} from "../../../packages/portable-core/sync.js";
import { parsePairingCode } from "../../../packages/portable-core/crypto.js";
import {
  findComputer,
  rememberPhoneAddress,
  phonePairingCode,
} from "../../../packages/portable-core/setup.js";
const $ = (id) => document.getElementById(id);
const node = (tag, value, className) => {
  const e = document.createElement(tag);
  if (value !== undefined) e.textContent = value;
  if (className) e.className = className;
  return e;
};
let repo,
  items = [],
  downloads = [],
  tab = "library",
  editing = null,
  reading = null,
  current = 1,
  urls = [],
  observer,
  downloadController,
  syncing,
  toastTimer,
  privacy = false,
  artwork = false,
  automatic = true;
const toast = (value) => {
  $("toast").textContent = value;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6000);
};
const run =
  (action) =>
  (...args) =>
    Promise.resolve()
      .then(() => action(...args))
      .catch((e) => toast(e.message));
const bytes = (n) =>
  n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.ceil(n / 1024) + " KB";
function jacket(item, miniature = false) {
  const e = node("div", undefined, "jacket");
  e.append(
    node("small", "THE FOLIO COLLECTION"),
    node("span", miniature ? item.title.slice(0, 1) : item.title),
    node("small", item.authors.join(", ") || "A STORY OF YOUR OWN"),
  );
  if (artwork && item.cover && !privacy) {
    const img = node("img");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => img.remove();
    img.src = item.cover;
    e.append(img);
  }
  return e;
}
const label = (item) =>
  item.status === "finished"
    ? "Read again"
    : item.page
      ? "Continue reading"
      : "Start reading";
const percent = (item) =>
  item.status === "finished"
    ? 100
    : item.pageCount
      ? Math.min(100, Math.round((item.page / item.pageCount) * 100))
      : 0;
async function reload() {
  items = await repo.items();
  downloads = await repo.downloads();
  render();
}
function navigate(next) {
  tab = next;
  render();
}
function render() {
  document.body.dataset.private = String(privacy);
  $("privacy").setAttribute("aria-pressed", String(privacy));
  $("privacy").setAttribute(
    "aria-label",
    privacy ? "Reveal library" : "Hide library",
  );
  $("privacy-screen").hidden = !privacy;
  $("home").hidden = tab === "devices";
  $("devices").hidden = tab !== "devices";
  for (const [id, value] of [
    ["nav-library", "library"],
    ["nav-offline", "offline"],
    ["nav-devices", "devices"],
  ]) {
    if (tab === value) $(id).setAttribute("aria-current", "page");
    else $(id).removeAttribute("aria-current");
  }
  $("shelf-heading").textContent =
    tab === "offline" ? "Kept close, always." : "The bookshelf";
  $("artwork").checked = artwork;
  $("automatic").checked = automatic;
  $("continue").replaceChildren();
  const latest = items
    .filter((i) => i.status === "reading" && i.page > 0)
    .sort((a, b) => a.title.localeCompare(b.title))[0];
  $("continue-section").hidden = !latest || tab === "offline" || privacy;
  if (latest && !privacy) {
    const hero = node("div", undefined, "hero"),
      copy = node("div", undefined, "hero-copy");
    copy.append(
      node("span", "YOUR CURRENT CHAPTER", "edition"),
      node("h3", latest.title),
      node("p", `Page ${latest.page} of ${latest.pageCount || "—"}`),
    );
    const button = node("button", "Continue reading ↗");
    button.onclick = run(() => openReader(latest));
    copy.append(button);
    hero.append(jacket(latest, true), copy);
    $("continue").append(hero);
  }
  const q = $("search").value.toLowerCase().trim(),
    filter = $("filter").value;
  const visible = items.filter(
    (i) =>
      (tab !== "offline" || downloads.some((d) => d.id === i.id)) &&
      (!q ||
        i.title.toLowerCase().includes(q) ||
        i.authors.join(" ").toLowerCase().includes(q) ||
        i.collections.join(" ").toLowerCase().includes(q)) &&
      (filter === "all" ||
        i.status === filter ||
        (filter === "favorites" && i.favorite) ||
        (filter === "queue" && i.queued)),
  );
  $("shelf").replaceChildren();
  $("empty").hidden = visible.length > 0;
  if (items.length) {
    $("empty").querySelector("h2").textContent =
      tab === "offline" ? "Keep a story close." : "No titles match yet.";
    $("empty").querySelector("p").textContent =
      tab === "offline"
        ? "Open a title's details and choose Keep offline or Import page images."
        : "Try another search or reading status.";
  }
  $("empty-pair").hidden = items.length > 0;
  if (privacy) return;
  for (const item of visible) {
    const card = node("article", undefined, "card"),
      cover = node("button", undefined, "cover-button");
    cover.setAttribute("aria-label", "Details for " + item.title);
    cover.append(jacket(item));
    cover.onclick = () => showDetail(item);
    const title = node("button", item.title, "title-button");
    title.onclick = () => showDetail(item);
    const downloaded = downloads.find((d) => d.id === item.id);
    card.append(
      cover,
      title,
      node("p", item.authors.join(", ") || `${item.pageCount || "—"} pages`),
    );
    const status = node("div", undefined, "status-line");
    status.append(
      node(
        "span",
        downloaded
          ? "↓ " + bytes(downloaded.bytes)
          : item.status === "finished"
            ? "Finished"
            : item.page
              ? "Page " + item.page
              : "Want to read",
      ),
      node("span", item.pageCount ? percent(item) + "%" : ""),
    );
    const progress = node("progress");
    progress.max = 100;
    progress.value = percent(item);
    progress.setAttribute("aria-label", "Reading progress for " + item.title);
    const read = node("button", label(item) + " ↗", "read");
    read.onclick = run(() => openReader(item));
    card.append(status, progress, read);
    $("shelf").append(card);
  }
}
function showDetail(item = null) {
  editing = item;
  $("detail-title").textContent = item?.title || "Add a title";
  $("edit-title").value = item?.title || "";
  $("edit-status").value = item?.status || "planned";
  $("edit-page").value = item?.page || 0;
  $("edit-collections").value = item?.collections.join(", ") || "";
  $("edit-notes").value = item?.notes || "";
  $("edit-favorite").checked = item?.favorite || false;
  $("edit-queued").checked = item?.queued || false;
  $("read-title").disabled = !item;
  $("remove-title").hidden = !item;
  $("download").disabled = !item || !item.pages.length;
  $("import-pages").disabled = !item;
  const kept = downloads.find((d) => d.id === item?.id);
  $("download-info").textContent = kept
    ? `${kept.count} pages · ${bytes(kept.bytes)} on this device. Removing a download keeps your library entry.`
    : item?.pages.length
      ? "Save these pages for reading without a connection."
      : "Save the title, then import page images. For paired titles, open the saved title in the computer reader once to share its page list.";
  $("remove-download").hidden = !kept;
  $("detail").showModal();
}
async function saveDetail() {
  const id = editing?.id || "local:" + randomHex();
  await repo.edit(id, {
    title: $("edit-title").value,
    status: $("edit-status").value,
    page: Number($("edit-page").value) || 0,
    collections: $("edit-collections")
      .value.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    notes: $("edit-notes").value,
    favorite: $("edit-favorite").checked,
    queued: $("edit-queued").checked,
    deleted: false,
  });
  await reload();
  editing = items.find((i) => i.id === id);
  scheduleSync();
  return editing;
}
let syncTimer;
function scheduleSync() {
  clearTimeout(syncTimer);
  if (automatic)
    syncTimer = setTimeout(
      () => syncNow().catch((e) => toast(e.message)),
      1000,
    );
}
async function syncNow() {
  if (syncing) return syncing;
  if (!(await repo.get("pair"))) return;
  $("sync-indicator").textContent = "Syncing…";
  $("connection-state").textContent = "Syncing your private library…";
  syncing = (async () => {
    await syncRepository(repo);
    await reload();
    $("sync-indicator").textContent = "In sync";
    $("connection-state").textContent =
      "Your library is up to date. Offline downloads stay on this device.";
  })()
    .catch((e) => {
      $("sync-indicator").textContent = "Waiting to sync";
      $("connection-state").textContent = e.message;
      throw e;
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}
async function updatePair() {
  const pair = await repo.get("pair");
  $("paired").hidden = !pair;
  $("device-unpaired").hidden = !!pair;
  $("create-pair").disabled = !!pair;
  $("join-pair").disabled = !!pair;
  $("relay-url").disabled = !!pair;
  $("pair-input").disabled = !!pair;
  $("connection-title").textContent = pair
    ? "Your devices, together."
    : "Connect your library";
  $("pair-code").value = pair ? await phonePairingCode(repo, pair) : "";
  if (pair) $("relay-url").value = pair.relay;
  else {
    $("sync-indicator").textContent = "On this device";
    $("connection-state").textContent =
      "Copy the pairing code from Your devices in Folio on your computer. No server address is needed here.";
  }
}
async function connect(pair, phoneOrigin = null) {
  await rememberPhoneAddress(repo, pair, phoneOrigin);
  await repo.set("pair", pair);
  await updatePair();
  await syncNow();
  toast("Your library is paired.");
}
async function download() {
  if (!editing) return;
  const item = editing;
  downloadController = new AbortController();
  $("download-progress").hidden = false;
  $("cancel-download").hidden = false;
  $("download").disabled = true;
  $("download-progress").value = 0;
  try {
    await downloadTitle(repo, item, {
      signal: downloadController.signal,
      fetcher: imageFetch,
      onProgress: (n, total) => {
        $("download-progress").value = (n / total) * 100;
        $("download-info").textContent = `Keeping page ${n} of ${total}…`;
      },
    });
    await reload();
    $("download-info").textContent = "Ready to read offline.";
    toast("This title is available offline.");
  } catch (e) {
    toast(e.name === "AbortError" ? "Download cancelled." : e.message);
  } finally {
    downloadController = null;
    $("download-progress").hidden = true;
    $("cancel-download").hidden = true;
    $("download").disabled = !item.pages.length;
  }
}
function releaseImages() {
  observer?.disconnect();
  observer = null;
  for (const url of urls) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  urls = [];
}
async function openReader(item) {
  const blobs = await repo.assets(item.id);
  releaseImages();
  urls = blobs.length
    ? blobs.map((b) => URL.createObjectURL(b))
    : item.pages.slice();
  if (!urls.length)
    throw new Error(
      "No page images on this device yet. Open details to import images or use your computer reader to share the page list.",
    );
  reading = item;
  current =
    item.status === "finished"
      ? 1
      : Math.max(1, Math.min(item.page || 1, urls.length));
  $("detail").close();
  $("reader").hidden = false;
  $("reader").dataset.immersive = "false";
  $("reader-title").textContent = item.title;
  $("reader-options").hidden = true;
  paintReader();
  await remember();
}
async function remember() {
  if (!reading) return;
  const id = reading.id,
    page = current;
  await repo.edit(id, { page, status: "reading" });
  scheduleSync();
}
function paintReader() {
  observer?.disconnect();
  observer = null;
  const stage = $("reader-stage");
  stage.replaceChildren();
  stage.dataset.mode = $("reader-mode").value;
  stage.dataset.fit = $("reader-fit").value;
  const indices =
    $("reader-mode").value === "continuous"
      ? urls.map((_, i) => i)
      : [current - 1];
  for (const i of indices) {
    const wrap = node("div", undefined, "page-wrap");
    wrap.dataset.page = i + 1;
    const img = node("img");
    img.alt = "Page " + (i + 1);
    img.loading = Math.abs(i + 1 - current) <= 1 ? "eager" : "lazy";
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    const zoom = Number($("reader-zoom").value) / 100;
    img.style.width = $("reader-fit").value === "width" ? `${zoom * 100}%` : "";
    img.style.height =
      $("reader-fit").value === "height"
        ? `calc((100dvh - 175px) * ${zoom})`
        : "";
    img.onload = () => {
      if ($("reader-fit").value === "natural")
        img.style.width = `${img.naturalWidth * zoom}px`;
    };
    img.onerror = () => {
      wrap.append(
        node(
          "p",
          "Page unavailable. Keep this title offline before losing your connection.",
          "image-error",
        ),
      );
    };
    img.src = urls[i];
    wrap.append(img);
    stage.append(wrap);
  }
  $("reader-position").textContent = `Page ${current} of ${urls.length}`;
  $("reader-progress").value = (current / urls.length) * 100;
  $("previous").disabled = current <= 1;
  $("next").disabled = current >= urls.length;
  if ($("reader-mode").value === "continuous") {
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              Math.abs(a.boundingClientRect.top - 100) -
              Math.abs(b.boundingClientRect.top - 100),
          )[0];
        if (visible) {
          const next = Number(visible.target.dataset.page);
          if (next !== current) {
            current = next;
            $("reader-position").textContent =
              `Page ${current} of ${urls.length}`;
            $("reader-progress").value = (current / urls.length) * 100;
            $("previous").disabled = current <= 1;
            $("next").disabled = current >= urls.length;
            remember().catch((e) => toast(e.message));
          }
        }
      },
      { root: $("reader"), rootMargin: "-80px 0px -50% 0px", threshold: 0.1 },
    );
    for (const wrap of stage.children) observer.observe(wrap);
    requestAnimationFrame(() =>
      stage.querySelector(`[data-page="${current}"]`)?.scrollIntoView(),
    );
  }
}
async function go(delta) {
  current = Math.max(1, Math.min(urls.length, current + delta));
  if ($("reader-mode").value === "paged") paintReader();
  else
    $("reader-stage")
      .querySelector(`[data-page="${current}"]`)
      ?.scrollIntoView();
  await remember();
}
async function closeReader() {
  await remember();
  reading = null;
  $("reader").hidden = true;
  releaseImages();
  await reload();
}
async function boot() {
  repo = await openRepository();
  privacy = (await repo.get("privacy")) ?? false;
  artwork = (await repo.get("artwork")) ?? false;
  automatic = (await repo.get("automatic")) ?? true;
  const preferences = await repo.get("readerPreferences");
  if (preferences) {
    if (["paged", "continuous"].includes(preferences.mode))
      $("reader-mode").value = preferences.mode;
    if (["width", "height", "natural"].includes(preferences.fit))
      $("reader-fit").value = preferences.fit;
    if (Number(preferences.zoom) >= 60 && Number(preferences.zoom) <= 160)
      $("reader-zoom").value = preferences.zoom;
  }
  await reload();
  await updatePair();
  $("nav-library").onclick = () => navigate("library");
  $("nav-offline").onclick = () => navigate("offline");
  $("nav-devices").onclick = () => navigate("devices");
  $("empty-pair").onclick = () => navigate("devices");
  $("search").oninput = render;
  $("filter").onchange = render;
  $("add").onclick = () => showDetail();
  $("close-detail").onclick = () => $("detail").close();
  $("detail-form").onsubmit = run(async (event) => {
    event.preventDefault();
    await saveDetail();
    $("detail").close();
    toast("Changes saved.");
  });
  // Prevent default synchronously before awaiting IndexedDB.
  $("detail-form").addEventListener("submit", (event) =>
    event.preventDefault(),
  );
  $("read-title").onclick = run(() => openReader(editing));
  $("download").onclick = run(download);
  $("cancel-download").onclick = () => downloadController?.abort();
  $("detail").addEventListener("close", () => downloadController?.abort());
  $("remove-download").onclick = run(async () => {
    await repo.forget(editing.id);
    await reload();
    $("download-info").textContent =
      "Download removed. Your library entry is kept.";
    $("remove-download").hidden = true;
  });
  $("import-pages").onclick = () => $("page-files").click();
  $("page-files").onchange = run(async () => {
    const files = [...$("page-files").files].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    if (!files.length) return;
    await repo.keep(editing.id, files);
    await repo.edit(editing.id, { pageCount: files.length });
    await reload();
    $("page-files").value = "";
    $("download-info").textContent = `${files.length} pages ready offline.`;
    scheduleSync();
    toast("Page images imported.");
  });
  $("remove-title").onclick = run(async () => {
    if (!confirm("Remove this title from your library on all paired devices?"))
      return;
    await repo.edit(editing.id, { deleted: true });
    await repo.forget(editing.id);
    $("detail").close();
    await reload();
    scheduleSync();
  });
  $("connect-computer").hidden = !!window.FolioImages;
  $("connect-computer").onclick = run(async () => {
    $("connect-computer").disabled = true;
    try {
      const setup = await findComputer(location.origin);
      await connect(await createPair(setup.computerOrigin), setup.phoneOrigin);
    } finally {
      $("connect-computer").disabled = false;
    }
  });
  $("create-pair").onclick = run(async () =>
    connect(await createPair($("relay-url").value)),
  );
  $("join-pair").onclick = run(() =>
    connect(parsePairingCode($("pair-input").value)),
  );
  $("sync-now").onclick = run(async () => {
    await syncNow();
    toast("Your library is up to date.");
  });
  $("copy-code").onclick = run(async () => {
    await navigator.clipboard.writeText($("pair-code").value);
    toast("Pairing code copied.");
  });
  $("unpair").onclick = run(async () => {
    if (
      !confirm(
        "Disconnect this device? Your local library and downloads will stay here.",
      )
    )
      return;
    await repo.set("pair", null);
    await updatePair();
  });
  const setPrivacy = run(async () => {
    privacy = !privacy;
    if (privacy) {
      $("detail").close();
      if (reading) await closeReader();
      $("toast").hidden = true;
    }
    await repo.set("privacy", privacy);
    render();
  });
  $("privacy").onclick = setPrivacy;
  $("reveal").onclick = setPrivacy;
  $("artwork").onchange = run(async () => {
    artwork = $("artwork").checked;
    await repo.set("artwork", artwork);
    render();
  });
  $("automatic").onchange = run(async () => {
    automatic = $("automatic").checked;
    await repo.set("automatic", automatic);
  });
  $("reader-back").onclick = run(closeReader);
  $("previous").onclick = run(() => go(-1));
  $("next").onclick = run(() => go(1));
  const presentation = run(async () => {
    paintReader();
    await repo.set("readerPreferences", {
      mode: $("reader-mode").value,
      fit: $("reader-fit").value,
      zoom: $("reader-zoom").value,
    });
  });
  $("reader-mode").onchange = presentation;
  $("reader-fit").onchange = presentation;
  $("reader-zoom").oninput = presentation;
  $("reader-tools").onclick = () =>
    ($("reader-options").hidden = !$("reader-options").hidden);
  $("reader-fullscreen").onclick = run(() =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : $("reader").requestFullscreen(),
  );
  let touch,
    lastSwipe = 0;
  $("reader-stage").onclick = (event) => {
    if (event.target.matches("img") && Date.now() - lastSwipe > 400)
      $("reader").dataset.immersive = String(
        $("reader").dataset.immersive !== "true",
      );
  };
  $("reader-stage").addEventListener(
    "touchstart",
    (e) => {
      touch = {
        x: e.changedTouches[0].clientX,
        y: e.changedTouches[0].clientY,
      };
    },
    { passive: true },
  );
  $("reader-stage").addEventListener(
    "touchend",
    (e) => {
      if (!touch || $("reader-mode").value !== "paged") return;
      const dx = e.changedTouches[0].clientX - touch.x,
        dy = e.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        lastSwipe = Date.now();
        go(dx < 0 ? 1 : -1).catch((e) => toast(e.message));
      }
      touch = null;
    },
    { passive: true },
  );
  window.addEventListener("keydown", (e) => {
    if (!reading || e.target.matches("input,textarea,select")) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1).catch((e) => toast(e.message));
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1).catch((e) => toast(e.message));
    }
    if (e.key === "Escape") closeReader().catch((e) => toast(e.message));
  });
  window.addEventListener("online", () => {
    if (automatic) syncNow().catch((e) => toast(e.message));
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && automatic) syncNow().catch((e) => toast(e.message));
  });
  setInterval(() => {
    if (automatic && !document.hidden) syncNow().catch(() => {});
  }, 20000);
  if (automatic) syncNow().catch((e) => toast(e.message));
  await setupTutorial(repo, {
    onPair: () => {
      navigate("devices");
      $("pair-input").focus();
    },
    onLocal: () => {
      navigate("library");
      $("add").focus();
    },
    onError: (error) => toast(error.message),
  });
  if (
    "serviceWorker" in navigator &&
    location.hostname !== "appassets.androidplatform.net"
  )
    navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot().catch((e) =>
  toast("Folio could not open its local storage: " + e.message),
);
