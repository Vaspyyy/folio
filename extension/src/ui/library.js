import { request } from "../client.js";
import { coverUrl, newPages } from "../core/model.js";
import { readingProgress, continueReading } from "./presentation.js";
import { createWorkspace } from "./workspace.js";
let workspace;
const $ = (id) => document.getElementById(id);
const labels = {
  all: "All titles",
  planned: "Want to read",
  reading: "Reading",
  finished: "Finished",
  dropped: "Dropped",
};
let entries = [],
  active = "all",
  artwork = false,
  refreshVersion = 0,
  toastTimer;
try {
  artwork = localStorage.getItem("folio:artwork") === "true";
} catch {}
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
};
const message = (text) => {
  clearTimeout(toastTimer);
  $("message").textContent = text;
  toastTimer = setTimeout(() => {
    $("message").textContent = "";
  }, 6000);
};
const iconPaths = {
  all: "M3 4h5v16H3z M10 4h5v16h-5z M18 4l3 15",
  planned: "M6 3h12v18l-6-4-6 4z",
  reading: "M12 5v15 M12 5C8 2 3 3 3 3v15s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2",
  finished: "M4 12l5 5L20 6",
  dropped: "M6 6l12 12 M18 6L6 18",
};
function icon(key) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", iconPaths[key]);
  svg.append(path);
  return svg;
}
function art(entry, miniature = false) {
  const m = entry.metadata,
    cover = node("div", undefined, "book-art");
  const colors = [
    "#3d5b50",
    "#92674c",
    "#566778",
    "#726075",
    "#86794a",
    "#3d6266",
  ];
  const hash = [...m.url].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  cover.style.setProperty("--jacket", colors[hash % colors.length]);
  const jacket = node("div", undefined, "jacket");
  jacket.setAttribute("aria-hidden", "true");
  jacket.append(
    node("span", "✧", "jacket-mark"),
    node("span", miniature ? m.title.slice(0, 1) : m.title, "jacket-title"),
    node("span", "THE FOLIO COLLECTION", "jacket-foot"),
  );
  cover.append(jacket);
  const url =
    entry.personal.coverChoice === "jacket"
      ? null
      : coverUrl(entry.personal.coverChoice) || coverUrl(m.coverUrl);
  if (artwork && url && !workspace?.isPrivate()) {
    const img = node("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => img.remove();
    img.src = url;
    cover.append(img);
  }
  return cover;
}
function progress(entry) {
  const { percent, label } = readingProgress(entry),
    block = node("div", undefined, "reading-progress"),
    text = node("div", undefined, "progress-label");
  text.append(
    node("span", label),
    node("span", percent === null ? "—" : `${percent}%`),
  );
  block.append(text);
  if (percent !== null) {
    const bar = node("progress");
    bar.max = 100;
    bar.value = percent;
    bar.setAttribute("aria-label", `${entry.metadata.title}: ${label}`);
    block.append(bar);
  }
  return block;
}
function readLink(entry, className = "read") {
  const { metadata: m, personal: p } = entry;
  const label =
    p.status === "finished"
      ? "Read again"
      : p.page
        ? "Continue reading"
        : "Start reading";
  const link = node("a", label, className);
  link.append(node("span", "↗"));
  link.lastChild.setAttribute("aria-hidden", "true");
  link.href =
    m.url +
    (p.status === "finished"
      ? "#folio-page=1"
      : p.page
        ? `#folio-page=${p.page}`
        : "");
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}
async function refresh() {
  const version = ++refreshVersion;
  const data = await request("list");
  if (version !== refreshVersion) return;
  entries = data;
  const selected = $("collection").value;
  $("collection").replaceChildren(new Option("All collections", ""));
  const names = [
    ...new Set(entries.flatMap((e) => e.personal.collections)),
  ].sort();
  for (const name of names) $("collection").add(new Option(name, name));
  $("collection").value = names.includes(selected) ? selected : "";
  render();
}
function editor(entry) {
  const { metadata: m, personal: p } = entry;
  const details = node("details", undefined, "editor");
  const summary = node("summary", "···", "edit-toggle");
  summary.setAttribute("aria-label", `Edit ${m.title}`);
  summary.title = "Edit title";
  details.append(summary);
  details.addEventListener("toggle", () => {
    if (details.open)
      for (const other of document.querySelectorAll(".editor[open]"))
        if (other !== details) other.open = false;
  });
  const form = node("form");
  form.append(node("h4", "Make it yours"));
  const row = node("div", undefined, "editor-row");
  const statusLabel = node("label", "Reading status"),
    status = node("select");
  for (const [key, label] of Object.entries(labels).filter(
    ([key]) => key !== "all",
  ))
    status.add(new Option(label, key));
  status.value = p.status;
  statusLabel.append(status);
  const pageLabel = node("label", "Page"),
    page = node("input");
  page.type = "number";
  page.min = "0";
  page.max = "1000000";
  page.required = true;
  page.value = p.page;
  pageLabel.append(page);
  row.append(statusLabel, pageLabel);
  form.append(row);
  const collectionLabel = node("label", "Collections · comma separated"),
    collection = node("input");
  collection.value = p.collections.join(", ");
  collection.placeholder = "Favorites, Weekend reads";
  collectionLabel.append(collection);
  form.append(collectionLabel);
  const actions = node("div", undefined, "editor-actions"),
    remove = node("button", "Remove", "remove"),
    save = node("button", "Save changes", "save-edit");
  remove.type = "button";
  save.type = "submit";
  actions.append(remove, save);
  form.append(actions);
  form.onsubmit = async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await request("update", {
        url: m.url,
        patch: {
          status: status.value,
          page: Number(page.value),
          collections: collection.value.split(","),
        },
      });
      await refresh();
      message("Changes saved.");
      [...document.querySelectorAll(".edit-toggle")]
        .find((el) => el.getAttribute("aria-label") === `Edit ${m.title}`)
        ?.focus();
    } catch (error) {
      message(error.message);
      save.disabled = false;
    }
  };
  remove.onclick = async () => {
    if (
      !confirm(`Remove “${m.title}” and its reading record from your library?`)
    )
      return;
    try {
      await request("remove", { url: m.url });
      await refresh();
      message("Title removed.");
    } catch (error) {
      message(error.message);
    }
  };
  details.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      details.open = false;
      summary.focus();
    }
  });
  details.append(form);
  return details;
}
function renderContinue() {
  const reading = continueReading(entries),
    filtered =
      active !== "all" || $("search").value.trim() || $("collection").value;
  $("continue-section").hidden = !reading.length || !!filtered;
  $("continue-content").replaceChildren();
  if (!reading.length || filtered) return;
  const count = entries.filter((e) => e.personal.status === "reading").length;
  $("continue-count").textContent = `View all ${count} in progress ↗`;
  $("continue-count").onclick = () => {
    active = "reading";
    $("collection").value = "";
    render();
  };
  $("continue-content").classList.toggle("single", reading.length === 1);
  const entry = reading[0],
    featured = node("article", undefined, "featured"),
    copy = node("div", undefined, "featured-copy");
  copy.append(
    node("span", "YOUR CURRENT CHAPTER", "eyebrow"),
    node("h3", entry.metadata.title),
    progress(entry),
    readLink(entry),
  );
  featured.append(art(entry), copy);
  $("continue-content").append(featured);
  if (reading.length > 1) {
    const queue = node("div", undefined, "continue-queue");
    for (const e of reading.slice(1)) {
      const item = node("article", undefined, "queue-item"),
        text = node("div", undefined, "queue-copy");
      text.append(node("h3", e.metadata.title), progress(e));
      const link = readLink(e, "queue-arrow");
      link.textContent = "↗";
      link.setAttribute("aria-label", `Continue ${e.metadata.title}`);
      item.append(art(e, true), text, link);
      queue.append(item);
    }
    if (reading.length === 2)
      queue.append(
        node("p", "A familiar world is only a page away.", "queue-note"),
      );
    $("continue-content").append(queue);
  }
}
function render() {
  $("artwork").setAttribute("aria-checked", String(artwork));
  $("edition-count").textContent =
    `${entries.length} ${entries.length === 1 ? "STORY" : "STORIES"}, ALL YOURS`;
  $("navigation").replaceChildren();
  for (const [key, label] of Object.entries(labels)) {
    const button = node("button");
    button.append(
      icon(key),
      node("span", label),
      node(
        "span",
        entries.filter((e) => key === "all" || e.personal.status === key)
          .length,
        "nav-number",
      ),
    );
    button.setAttribute("aria-current", String(active === key));
    button.onclick = () => {
      active = key;
      render();
    };
    $("navigation").append(button);
  }
  workspace?.navigation(active, $("collection").value);
  workspace?.mosaic($("collection").value);
  $("updates-toolbar").hidden = active !== "updates";
  renderContinue();
  const query = $("search").value.toLowerCase().trim(),
    collection = $("collection").value;
  const visible = entries.filter(
    (e) =>
      (active === "all" ||
        e.personal.status === active ||
        (active === "favorites" && e.personal.favorite) ||
        (active === "queue" && e.personal.queued) ||
        (active === "updates" && newPages(e) > 0)) &&
      e.metadata.title.toLowerCase().includes(query) &&
      (!collection || e.personal.collections.includes(collection)),
  );
  const scope = collection
    ? "collection:" + collection
    : active === "queue"
      ? "queue"
      : active === "favorites"
        ? "favorites"
        : "all";
  const ordered = $("sort").value === "manual" || active === "queue";
  visible.sort((a, b) =>
    ordered
      ? (a.personal.orders?.[scope] ?? Infinity) -
          (b.personal.orders?.[scope] ?? Infinity) ||
        b.personal.updatedAt - a.personal.updatedAt
      : $("sort").value === "title"
        ? a.metadata.title.localeCompare(b.metadata.title)
        : $("sort").value === "pages"
          ? (b.metadata.pageCount || 0) - (a.metadata.pageCount || 0)
          : b.personal.updatedAt - a.personal.updatedAt,
  );
  async function move(from, to) {
    const urls = visible.map((e) => e.metadata.url);
    const [url] = urls.splice(from, 1);
    urls.splice(to, 0, url);
    try {
      await request("reorder", { urls, scope });
      await refresh();
      message("Shelf order saved.");
    } catch (error) {
      message(error.message);
    }
  }
  $("shelf-name").textContent =
    collection ||
    { updates: "New pages", favorites: "Your favorites", queue: "Read next" }[
      active
    ] ||
    "The bookshelf";
  $("shelf-total").textContent = visible.length;
  $("shelf-description").textContent =
    active === "all"
      ? "Every story has a place."
      : labels[active] ||
        {
          updates: "Followed stories, fresh pages.",
          favorites: "The ones worth keeping.",
          queue: "Your next chapter, in your order.",
        }[active];
  $("count").textContent =
    `${visible.length} ${visible.length === 1 ? "title" : "titles"}${collection ? ` in ${collection}` : ""}`;
  $("clear-filters").hidden = !query && !collection && active === "all";
  $("entries").replaceChildren();
  $("empty").hidden = entries.length > 0;
  $("no-results").hidden = !entries.length || visible.length > 0;
  for (const [index, entry] of visible.entries()) {
    const { metadata: m, personal: p } = entry,
      card = node("article", undefined, "card");
    card.dataset.url = m.url;
    const coverLink = node("button", undefined, "book-link");
    coverLink.type = "button";
    coverLink.replaceChildren(
      art(entry),
      node("span", labels[p.status], "status-pill"),
    );
    coverLink.setAttribute("aria-label", `Details for ${m.title}`);
    coverLink.onclick = () => workspace.inspect(entry, coverLink);
    if (ordered && !query) {
      card.draggable = true;
      card.addEventListener("dragstart", (event) => {
        if (event.target.closest("input,select,textarea,details")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData("application/x-folio-title", m.url);
      });
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        const from = visible.findIndex(
          (e) =>
            e.metadata.url ===
            event.dataTransfer.getData("application/x-folio-title"),
        );
        if (from >= 0 && from !== index) move(from, index);
      });
    }
    const body = node("div", undefined, "card-body");
    const heading = node("h3"),
      titleButton = node("button", m.title, "title-button");
    titleButton.onclick = () => workspace.inspect(entry, titleButton);
    heading.append(titleButton);
    body.append(
      heading,
      node(
        "div",
        `${m.pageCount ? `${m.pageCount} pages` : "Length not yet known"} · Multporn`,
        "book-meta",
      ),
      progress(entry),
    );
    const footer = node("footer");
    if (newPages(entry)) {
      const read = node(
        "button",
        `Read ${newPages(entry)} new pages ↗`,
        "read",
      );
      read.onclick = () =>
        workspace.readNew(entry).catch((e) => message(e.message));
      footer.append(read);
      const badge = node("div", `${newPages(entry)} new pages`, "new-pages");
      body.append(badge);
      if (active === "updates") {
        const ack = node("button", "Mark seen", "acknowledge");
        ack.onclick = () =>
          request("acknowledge", { url: m.url })
            .then(refresh)
            .catch((e) => message(e.message));
        body.append(ack);
      }
    } else footer.append(readLink(entry));
    footer.append(editor(entry));
    body.append(footer);
    if (p.collections.length) {
      const chips = node("div", undefined, "collection-chips");
      for (const name of p.collections.slice(0, 2))
        chips.append(node("span", name));
      if (p.collections.length > 2)
        chips.append(node("span", `+${p.collections.length - 2}`));
      body.append(chips);
    }
    if (p.favorite) {
      const favorite = node("span", "♥ Favorite", "favorite-label");
      body.append(favorite);
    }
    if (ordered && !query) {
      const controls = node("div", undefined, "order-controls");
      for (const [delta, label] of [
        [-1, "Move earlier"],
        [1, "Move later"],
      ]) {
        const button = node("button", delta < 0 ? "←" : "→");
        button.setAttribute("aria-label", `${label}: ${m.title}`);
        button.disabled = index + delta < 0 || index + delta >= visible.length;
        button.onclick = () => move(index, index + delta);
        controls.append(button);
      }
      body.append(controls);
    }
    card.append(coverLink, body);
    $("entries").append(card);
  }
}
workspace = createWorkspace({
  getEntries: () => entries,
  refresh,
  render,
  message,
  art,
  navigate: (mode, collection) => {
    active = mode;
    $("collection").value = collection;
    $("search").value = "";
    if (mode === "queue" || collection) $("sort").value = "manual";
    render();
  },
});
$("collection").addEventListener("input", () => {
  if ($("collection").value) $("sort").value = "manual";
  render();
});
for (const id of ["search", "sort"]) $(id).addEventListener("input", render);
$("clear-filters").onclick = () => {
  active = "all";
  $("search").value = "";
  $("collection").value = "";
  render();
};
$("artwork").onclick = () => {
  artwork = !artwork;
  try {
    localStorage.setItem("folio:artwork", String(artwork));
  } catch {
    message("Artwork preference could not be saved.");
  }
  render();
};
$("import-button").onclick = () => $("import").click();
$("export").onclick = async () => {
  try {
    const data = await request("export"),
      url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      ),
      link = node("a");
    link.href = url;
    link.download = `folio-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message("Backup exported.");
  } catch (error) {
    message(error.message);
  }
};
$("import").onchange = async () => {
  try {
    const file = $("import").files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024)
      throw new Error("Backup is too large (20 MB maximum)");
    const added = await request("import", {
      data: JSON.parse(await file.text()),
    });
    await refresh();
    message(`Imported ${added} titles. Existing records were kept.`);
  } catch (error) {
    message(`Import failed: ${error.message}`);
  } finally {
    $("import").value = "";
  }
};
window.addEventListener("focus", () => {
  if (!document.querySelector(".editor[open]") && !$("title-drawer").open)
    refresh().catch((error) => message(error.message));
});
refresh().catch((error) => message(error.message));
