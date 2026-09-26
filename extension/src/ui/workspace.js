import { request } from "../client.js";
import { newPages, coverUrl } from "../core/model.js";
import { fetchMetadata } from "./update-checker.js";
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const load = (key, fallback) => {
  try {
    return localStorage.getItem("folio:" + key) || fallback;
  } catch {
    return fallback;
  }
};
export function createWorkspace({
  getEntries,
  refresh,
  render,
  message,
  art,
  navigate,
}) {
  let privacy = load("privacy", "false") === "true",
    checking = null,
    opener = null,
    drawerVersion = 0;
  const theme = $("theme"),
    density = $("density");
  theme.value = load("theme", "light");
  if (!theme.value) theme.value = "light";
  density.value = load("density", "comfortable");
  if (!density.value) density.value = "comfortable";
  function apply() {
    document.documentElement.dataset.theme =
      theme.value === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme.value;
    document.documentElement.dataset.density = density.value;
    document.body.dataset.private = String(privacy);
    $("privacy").setAttribute("aria-pressed", String(privacy));
    $("privacy").textContent = privacy ? "Reveal library ◉" : "Hide library ◉";
    $("privacy-screen").hidden = !privacy;
    for (const [key, value] of [
      ["theme", theme.value],
      ["density", density.value],
      ["privacy", privacy],
    ])
      try {
        localStorage.setItem("folio:" + key, String(value));
      } catch {}
  }
  theme.onchange = apply;
  density.onchange = apply;
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);
  const setPrivate = () => {
    privacy = !privacy;
    if (privacy) {
      $("title-drawer").close();
      $("message").textContent = "";
    }
    apply();
    render();
  };
  $("privacy").onclick = setPrivate;
  $("reveal").onclick = setPrivate;
  apply();
  $("title-drawer").addEventListener(
    "close",
    () => opener?.isConnected && opener.focus(),
  );
  $("title-drawer").addEventListener("click", (event) => {
    if (event.target === $("title-drawer")) $("title-drawer").close();
  });
  async function modify(entry, patch) {
    await request("update", { url: entry.metadata.url, patch });
    await refresh();
  }
  async function readNew(entry) {
    const page = (entry.personal.acknowledgedCount || 0) + 1;
    await request("progress", { url: entry.metadata.url, page });
    await chrome.tabs.create({
      url: entry.metadata.url + "#folio-page=" + page,
    });
    await refresh();
  }
  async function inspect(entry, trigger) {
    if (privacy) return;
    if (trigger) opener = trigger;
    const version = ++drawerVersion;
    const dialog = $("title-drawer"),
      root = $("drawer-content");
    root.replaceChildren();
    const header = el("div", undefined, "drawer-header"),
      close = el("button", "×", "drawer-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close title details");
    close.onclick = () => dialog.close();
    header.append(
      el("span", "THE STORY, AND YOUR PLACE IN IT", "eyebrow"),
      close,
    );
    root.append(header);
    const lead = el("div", undefined, "drawer-lead"),
      copy = el("div");
    const title = el("h2", entry.metadata.title);
    title.id = "drawer-title";
    copy.append(
      title,
      el(
        "p",
        entry.metadata.author || "Author not yet available",
        "drawer-author",
      ),
      el(
        "p",
        entry.metadata.pageCount
          ? `${entry.metadata.pageCount} pages`
          : "Length not yet known",
      ),
    );
    lead.append(art(entry), copy);
    root.append(lead);
    const description = el(
      "p",
      entry.metadata.description ||
        "No description saved yet. Refresh details to retrieve the source metadata.",
      "drawer-description",
    );
    root.append(description);
    const refreshButton = el("button", "Refresh details", "read");
    refreshButton.type = "button";
    refreshButton.onclick = async () => {
      refreshButton.disabled = true;
      form.inert = true;
      try {
        const metadata = await fetchMetadata(entry.metadata.url);
        const saved = await request("refresh", { metadata });
        await refresh();
        if (dialog.open && version === drawerVersion) await inspect(saved);
        message("Source details refreshed.");
      } catch (error) {
        message(error.message);
        refreshButton.disabled = false;
        form.inert = false;
      }
    };
    root.append(refreshButton);
    if (newPages(entry)) {
      const update = el("div", undefined, "drawer-update");
      const read = el("button", `Read ${newPages(entry)} new pages ↗`, "read");
      read.onclick = () =>
        readNew(entry)
          .then(() => dialog.close())
          .catch((e) => message(e.message));
      update.append(
        el(
          "p",
          `${newPages(entry)} pages added beyond your last acknowledged count.`,
        ),
        read,
      );
      root.append(update);
    }
    const form = el("form", undefined, "drawer-form");
    form.addEventListener("input", () => {
      refreshButton.disabled = true;
      refreshButton.title = "Save your edits before refreshing source details";
    });
    function check(label, value) {
      const l = el("label", undefined, "check-label"),
        input = el("input");
      input.type = "checkbox";
      input.checked = value;
      l.append(input, el("span", label));
      form.append(l);
      return input;
    }
    const favorite = check("Favorite", entry.personal.favorite),
      queued = check("Pin to Read next", entry.personal.queued),
      following = check("Follow new pages", entry.personal.following);
    function field(label, input) {
      const l = el("label", label);
      l.append(input);
      form.append(l);
      return input;
    }
    const publication = el("select");
    for (const [v, t] of [
      ["unknown", "Unknown"],
      ["ongoing", "Still publishing"],
      ["complete", "Publication complete"],
    ])
      publication.add(new Option(t, v));
    publication.value = entry.personal.publication;
    field("Publication status · your label", publication);
    const collections = el("input");
    collections.value = entry.personal.collections.join(", ");
    field("Collections · comma separated", collections);
    const notes = el("textarea");
    notes.rows = 5;
    notes.maxLength = 10000;
    notes.value = entry.personal.notes;
    field("Private notes", notes);
    const choices = el("select");
    choices.add(new Option("Source cover", "auto"));
    choices.add(new Option("Typographic jacket", "jacket"));
    const candidates = [
      ...new Set(
        [
          entry.metadata.coverUrl,
          ...(entry.metadata.covers || []),
          coverUrl(entry.personal.coverChoice),
        ].filter(Boolean),
      ),
    ];
    candidates.forEach((url, i) =>
      choices.add(new Option(`Artwork ${i + 1}`, url)),
    );
    choices.value = entry.personal.coverChoice;
    field("Cover for this title", choices);
    const preview = el("div", undefined, "cover-preview");
    const previewText = el("span", "Preview");
    preview.append(previewText, art(entry));
    form.append(preview);
    choices.onchange = () =>
      preview.replaceChildren(
        el("span", "Preview"),
        art({
          ...entry,
          personal: { ...entry.personal, coverChoice: choices.value },
        }),
      );
    const save = el("button", "Save personal details", "save-edit");
    save.type = "submit";
    form.append(save);
    form.onsubmit = async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await modify(entry, {
          favorite: favorite.checked,
          queued: queued.checked,
          following: following.checked,
          publication: publication.value,
          collections: collections.value.split(","),
          notes: notes.value,
          coverChoice: choices.value,
        });
        dialog.close();
        message("Personal details saved.");
      } catch (error) {
        message(error.message);
        save.disabled = false;
      }
    };
    root.append(form);
    const history = el("section", undefined, "reading-history");
    history.append(el("h3", "Your reading history"));
    const events = entry.personal.history || [];
    if (!events.length)
      history.append(el("p", "New reading activity will appear here."));
    else {
      const list = el("ol");
      for (const event of [...events].reverse().slice(0, 20)) {
        list.append(
          el(
            "li",
            `${event.type === "status" ? event.status : "Read"} · page ${event.page} — ${new Date(event.at).toLocaleString()}`,
          ),
        );
      }
      history.append(list);
    }
    root.append(history);
    if (!dialog.open) dialog.showModal();
    root.scrollTop = 0;
  }
  async function checkUpdates() {
    if (checking) return;
    const followed = getEntries().filter((e) => e.personal.following);
    if (!followed.length) {
      message("Follow a title in its details to check for new pages.");
      return;
    }
    checking = new AbortController();
    $("check-updates").disabled = true;
    $("cancel-check").hidden = false;
    $("update-errors").replaceChildren();
    let done = 0,
      failed = 0;
    try {
      for (const entry of followed) {
        if (checking.signal.aborted) break;
        $("update-status").textContent =
          `Checking ${done + 1} of ${followed.length}…`;
        try {
          const metadata = await fetchMetadata(
            entry.metadata.url,
            checking.signal,
          );
          await request("refresh", { metadata });
        } catch (error) {
          if (checking.signal.aborted) break;
          failed++;
          if (error.rateLimited) checking.abort();
          $("update-errors").append(
            el("li", `${entry.metadata.title}: ${error.message}`),
          );
        }
        done++;
        if (done < followed.length)
          await new Promise((resolve) => setTimeout(resolve, 250));
      }
      $("update-status").textContent =
        `${checking.signal.aborted ? "Stopped" : "Checked"} · ${done} of ${followed.length} titles${failed ? ` · ${failed} failed` : ""}`;
      await refresh();
    } finally {
      checking = null;
      $("check-updates").disabled = false;
      $("cancel-check").hidden = true;
    }
  }
  $("check-updates").onclick = () =>
    checkUpdates().catch((e) => message(e.message));
  $("cancel-check").onclick = () => checking?.abort();
  function navigation(active, collection) {
    const entries = getEntries();
    $("special-nav").replaceChildren();
    for (const [key, label, count] of [
      ["updates", "Updates", entries.filter((e) => newPages(e) > 0).length],
      [
        "favorites",
        "Favorites",
        entries.filter((e) => e.personal.favorite).length,
      ],
      ["queue", "Read next", entries.filter((e) => e.personal.queued).length],
    ]) {
      const button = el("button");
      button.append(el("span", label), el("span", count, "nav-number"));
      button.setAttribute("aria-current", String(active === key));
      button.onclick = () => navigate(key, "");
      $("special-nav").append(button);
    }
    const names = [
      ...new Set(entries.flatMap((e) => e.personal.collections)),
    ].sort();
    $("collection-nav").replaceChildren();
    if (names.length)
      $("collection-nav").append(el("div", "COLLECTIONS", "nav-caption"));
    for (const name of names) {
      const button = el("button", name);
      button.setAttribute("aria-current", String(name === collection));
      button.onclick = () => navigate("all", name);
      $("collection-nav").append(button);
    }
  }
  function mosaic(collection) {
    const container = $("collection-mosaic");
    container.replaceChildren();
    container.hidden = !collection;
    if (!collection) return;
    const items = getEntries().filter((e) =>
      e.personal.collections.includes(collection),
    );
    const covers = el("div", undefined, "mosaic-covers");
    for (const entry of items.slice(0, 4)) covers.append(art(entry, true));
    const copy = el("div");
    copy.append(
      el("span", "YOUR COLLECTION", "eyebrow"),
      el("h3", collection),
      el("p", `${items.length} titles · drag cards to arrange this shelf`),
    );
    container.append(covers, copy);
  }
  return { inspect, readNew, navigation, mosaic, isPrivate: () => privacy };
}
