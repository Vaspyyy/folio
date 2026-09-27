import { request } from "../client.js";
import { canonicalUrl } from "../core/model.js";
import { readerSnapshot } from "../adapters/multporn.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let sourceUrl;
try {
  sourceUrl = canonicalUrl(params.get("url"));
} catch {
  sourceUrl = null;
}
const requestedPage = Math.max(1, Number(params.get("page")) || 1);
let record = null;
let metadata = null;
let pages = [];
let current = 1;
let observer = null;
let progressWrite = Promise.resolve();

const loadPreference = (key, fallback) => {
  try {
    return localStorage.getItem("folio:reader:" + key) || fallback;
  } catch {
    return fallback;
  }
};
const savePreference = (key, value) => {
  try {
    localStorage.setItem("folio:reader:" + key, String(value));
  } catch {}
};

$("mode").value = loadPreference("mode", "paged");
$("fit").value = loadPreference("fit", "width");
$("zoom").value = loadPreference("zoom", "100");

function setState(name) {
  $("loading").hidden = name !== "loading";
  $("error").hidden = name !== "error";
  $("reader").hidden = name !== "reader";
}

function showError(error) {
  setState("error");
  $("error-message").textContent = error.message;
  if (sourceUrl) {
    $("source-fallback").href = sourceUrl;
    $("source-fallback").hidden = false;
  } else {
    $("source-fallback").hidden = true;
  }
}

function pageImage(url, index) {
  const shell = document.createElement("div");
  shell.className = "page-shell";
  shell.dataset.page = String(index + 1);
  const img = document.createElement("img");
  img.className = "page";
  img.alt = `Page ${index + 1}`;
  img.loading = Math.abs(index + 1 - current) <= 1 ? "eager" : "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.src = url;
  img.onerror = () => {
    img.alt = `Page ${index + 1} failed to load`;
    shell.classList.add("failed");
  };
  const number = document.createElement("span");
  number.className = "page-number";
  number.textContent = `Page ${index + 1}`;
  shell.append(img, number);
  return shell;
}

function updatePosition(page, persist = true) {
  current = Math.min(Math.max(1, page), pages.length || 1);
  $("position").textContent = `Page ${current} of ${pages.length}`;
  $("progress").value = pages.length ? (current / pages.length) * 100 : 0;
  $("previous").disabled = current <= 1;
  $("next").disabled = current >= pages.length;
  const nextUrl = new URL(location.href);
  nextUrl.searchParams.set("page", String(current));
  history.replaceState(null, "", nextUrl);
  if (persist && record) {
    progressWrite = progressWrite
      .catch(() => {})
      .then(() =>
        request("progress", {
          url: sourceUrl,
          page: current,
          automatic: false,
        }),
      )
      .then((next) => {
        record = next;
      })
      .catch(() => {});
  }
}

function applyPresentation() {
  const stage = $("stage");
  stage.dataset.mode = $("mode").value;
  stage.dataset.fit = $("fit").value;
  stage.style.setProperty("--zoom", String(Number($("zoom").value) / 100));
}

function renderPages() {
  observer?.disconnect();
  observer = null;
  $("stage").replaceChildren();
  applyPresentation();
  if ($("mode").value === "paged") {
    $("stage").append(pageImage(pages[current - 1], current - 1));
    const preload = (index) => {
      if (pages[index]) {
        const img = new Image();
        img.referrerPolicy = "no-referrer";
        img.src = pages[index];
      }
    };
    preload(current);
    preload(current - 2);
    return;
  }
  const fragment = document.createDocumentFragment();
  pages.forEach((url, index) => fragment.append(pageImage(url, index)));
  $("stage").append(fragment);
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort(
          (a, b) =>
            Math.abs(a.boundingClientRect.top - innerHeight * 0.25) -
            Math.abs(b.boundingClientRect.top - innerHeight * 0.25),
        )[0];
      if (!visible) return;
      const page = Number(visible.target.dataset.page);
      if (page && page !== current) updatePosition(page);
    },
    { rootMargin: "-15% 0px -55% 0px", threshold: [0, 0.1] },
  );
  document
    .querySelectorAll(".page-shell")
    .forEach((shell) => observer.observe(shell));
  requestAnimationFrame(() =>
    document
      .querySelector(`.page-shell[data-page="${current}"]`)
      ?.scrollIntoView({ block: "start" }),
  );
}

function go(page) {
  if (!pages.length) return;
  updatePosition(page);
  if ($("mode").value === "paged") renderPages();
  else
    document
      .querySelector(`.page-shell[data-page="${current}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("previous").onclick = () => go(current - 1);
$("next").onclick = () => go(current + 1);
$("mode").onchange = () => {
  savePreference("mode", $("mode").value);
  renderPages();
};
$("fit").onchange = () => {
  savePreference("fit", $("fit").value);
  applyPresentation();
};
$("zoom").oninput = () => {
  savePreference("zoom", $("zoom").value);
  applyPresentation();
};
$("fullscreen").onclick = () =>
  (document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen()
  ).catch(() => {});

$("save").onclick = async () => {
  if (!metadata || record) return;
  try {
    record = await request("save", { metadata });
    $("save").textContent = "Saved ✓";
    $("save").setAttribute("aria-pressed", "true");
    await request("progress", { url: sourceUrl, page: current });
  } catch (error) {
    showError(error);
  }
};

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select, textarea")) return;
  if (["ArrowRight", "PageDown"].includes(event.key)) {
    event.preventDefault();
    go(current + 1);
  } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
    event.preventDefault();
    go(current - 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    go(1);
  } else if (event.key === "End") {
    event.preventDefault();
    go(pages.length);
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    $("fullscreen").click();
  } else if (event.key.toLowerCase() === "c") {
    event.preventDefault();
    $("mode").value = $("mode").value === "paged" ? "continuous" : "paged";
    $("mode").dispatchEvent(new Event("change"));
  }
});

(async () => {
  if (!sourceUrl) {
    showError(new Error("Missing or unsupported source URL"));
    return;
  }
  $("source-fallback").href = sourceUrl;
  setState("loading");
  try {
    record = await request("get", { url: sourceUrl });
    const response = await fetch(sourceUrl, {
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const html = await response.text();
    if (html.length > 12_000_000) throw new Error("Source page is too large");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const snapshot = readerSnapshot(doc, sourceUrl);
    metadata = snapshot.metadata;
    pages = snapshot.pages;
    await request("observeCatalog", {
      items: [metadata],
      authoritative: true,
    });
    if (record) {
      record = await request("refresh", { metadata });
    }
    $("title").textContent = metadata.title;
    $("author").textContent = metadata.author || "Author not available";
    document.title = `${metadata.title} · Folio Reader`;
    current = Math.min(
      pages.length,
      Math.max(
        1,
        requestedPage > 1
          ? requestedPage
          : record?.personal?.page > 0
            ? record.personal.page
            : 1,
      ),
    );
    $("save").textContent = record ? "Saved ✓" : "Save to library";
    $("save").setAttribute("aria-pressed", String(!!record));
    $("save").disabled = !!record;
    setState("reader");
    updatePosition(current, false);
    renderPages();
  } catch (error) {
    showError(error);
  }
})();
