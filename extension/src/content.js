import { detectTitle, readingImages } from "./adapters/multporn.js";
import { juiceboxRequest } from "./adapters/reader.js";
import { installListingControls } from "./listings.js";
import { request } from "./client.js";
(async () => {
  const title = detectTitle(document, location.href);
  if (!title) {
    installListingControls();
    return;
  }
  // A detail page is useful discovery metadata even when the user never saves it.
  // This stays separate from the personal library.
  request("observeCatalog", {
    items: [title],
    authoritative: true,
  }).catch(() => {});
  const host = document.createElement("aside");
  host.id = "folio-companion";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    :host{position:fixed;bottom:18px;right:18px;z-index:2147483000;font:14px/1.5 system-ui;color:#eee}
    section{width:260px;max-width:calc(100vw - 60px);padding:16px;background:#182523;border:1px solid #52665c;border-radius:16px;box-shadow:0 8px 32px #0006}
    header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}button,input{font:inherit;border-radius:7px;padding:7px;border:1px solid #688577;background:#233b32;color:#fff}button{cursor:pointer}input{width:70px}p{font-size:12px;color:#bbcbc2;margin-bottom:0}label{display:block;margin:10px 0}nav{display:flex;gap:8px;flex-wrap:wrap}
  </style><section><header><b>Folio / reading companion</b><button id="collapse" aria-label="Collapse companion" aria-expanded="true">−</button></header><div id="body"><nav><button id="save">Save to library</button><button id="library">Library ↗</button></nav><label>Page <input id="page" type="number" min="1" max="1000000" value="1"></label><nav><button id="bookmark">Bookmark page</button><button id="resume">Resume</button></nav><p id="status" role="status">Save this title to keep your place.</p></div></section>`;
  document.body.append(host);
  const $ = (id) => root.getElementById(id);
  let record = null,
    state = null,
    lastObservedPage = null,
    pendingResume = null;
  let ready = false,
    refreshing = false,
    closed = false,
    scrollTimer;
  const images = () => readingImages(document);
  const report = (error) => {
    $("status").textContent = error.message;
  };
  function show(value = record) {
    record = value;
    const continuous = images().length > 0;
    $("save").textContent = record ? "Saved ✓" : "Save to library";
    $("save").disabled = !ready || !!record;
    $("bookmark").disabled = !ready || !record;
    $("resume").disabled = !record?.personal.page || (!continuous && !state);
    if (root.activeElement !== $("page"))
      $("page").value = state?.page || record?.personal.page || 1;
    $("status").textContent = record
      ? (state
          ? `Page ${state.page} of ${state.total}. `
          : record.personal.page
            ? `Bookmarked page ${record.personal.page}. `
            : "In your library. ") +
        (state
          ? "Progress follows the reader."
          : continuous
            ? "Progress follows your scrolling."
            : "Waiting for reader; manual bookmarks are available.")
      : "Save this title to keep your place.";
  }
  async function refreshMetadata() {
    if (!record || refreshing) return;
    const fresh = detectTitle(document, location.href);
    if (!fresh) return;
    if (state) fresh.pageCount = state.total;
    if (
      fresh.title === record.metadata.title &&
      (!fresh.author || fresh.author === record.metadata.author) &&
      (!fresh.description ||
        fresh.description === record.metadata.description) &&
      (!fresh.covers?.length || record.metadata.covers?.length > 0) &&
      (!fresh.coverUrl || fresh.coverUrl === record.metadata.coverUrl) &&
      (fresh.pageCount === null ||
        fresh.pageCount === record.metadata.pageCount)
    )
      return;
    refreshing = true;
    try {
      show(await request("refresh", { metadata: fresh }));
    } finally {
      refreshing = false;
    }
  }
  async function persist(page, automatic = false) {
    if (!record || (automatic && record.personal.page === page)) return;
    show(await request("progress", { url: title.url, page, automatic }));
  }
  $("collapse").onclick = () => {
    const hidden = !$("body").hidden;
    $("body").hidden = hidden;
    $("collapse").textContent = hidden ? "+" : "−";
    $("collapse").setAttribute("aria-expanded", String(!hidden));
  };
  $("library").onclick = () => request("open").catch(report);
  $("save").onclick = async () => {
    try {
      const fresh = detectTitle(document, location.href) || title;
      if (state) fresh.pageCount = state.total;
      show(await request("save", { metadata: fresh }));
    } catch (error) {
      report(error);
    }
  };
  $("bookmark").onclick = () => persist(Number($("page").value)).catch(report);
  async function resume(page) {
    if (!Number.isInteger(page) || page < 1) return;
    const continuous = images();
    if (continuous.length) {
      const image = continuous[page - 1];
      if (image) image.scrollIntoView({ block: "start" });
      else
        report(
          new Error(
            `Saved page ${page} is not available. Your bookmark was kept.`,
          ),
        );
      return;
    }
    pendingResume = { page, sent: false, deadline: Date.now() + 15000 };
    $("status").textContent = `Opening page ${page}…`;
  }
  $("resume").onclick = () => resume(record.personal.page);
  show();
  try {
    record = await request("get", { url: title.url });
    ready = true;
    show();
    const requestedPage = Number(
      new URLSearchParams(location.hash.slice(1)).get("folio-page"),
    );
    if (record && Number.isInteger(requestedPage) && requestedPage > 0)
      await resume(requestedPage);
  } catch (error) {
    report(error);
    return;
  }

  async function poll() {
    if (closed) return;
    try {
      if (document.visibilityState === "visible") {
        const next = await juiceboxRequest("state");
        state = next;
        if (pendingResume) {
          const pending = pendingResume;
          if (
            Date.now() > pending.deadline ||
            (next && pending.page > next.total)
          ) {
            pendingResume = null;
            lastObservedPage = next?.page ?? null;
            report(
              new Error(
                `Could not open page ${pending.page}. Your bookmark was kept.`,
              ),
            );
          } else if (next && !pending.sent) {
            pending.sent = true;
            const confirmed = await juiceboxRequest("resume", pending.page);
            if (confirmed?.page === pending.page) {
              state = confirmed;
              pendingResume = null;
              lastObservedPage = confirmed.page;
              show();
            }
          } else if (next?.page === pending.page) {
            pendingResume = null;
            lastObservedPage = next.page;
            show();
          }
        } else if (next) {
          // Initial page 1 must never erase a saved position while opening a title.
          if (lastObservedPage !== null && next.page !== lastObservedPage)
            await persist(next.page, true);
          lastObservedPage = next.page;
          show();
        } else {
          lastObservedPage = null;
        }
        await refreshMetadata();
      }
    } catch (error) {
      report(error);
    }
    if (!closed) setTimeout(poll, 400);
  }
  poll();
  window.addEventListener("pagehide", () => {
    closed = true;
    clearTimeout(scrollTimer);
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && closed) {
      closed = false;
      poll();
    }
  });
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      if (!record || !images().length) return;
      scrollTimer = setTimeout(async () => {
        if (document.visibilityState !== "visible") return;
        const index = images().findIndex((img) => {
          const box = img.getBoundingClientRect();
          return (
            box.height > 0 &&
            box.bottom > innerHeight * 0.35 &&
            box.top < innerHeight * 0.7
          );
        });
        if (index < 0) return;
        try {
          await persist(index + 1, true);
        } catch (error) {
          report(error);
        }
      }, 600);
    },
    { passive: true },
  );
})();
