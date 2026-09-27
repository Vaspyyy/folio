import { Library, openDatabase } from "./core/database.js";
import { canonicalUrl } from "./core/model.js";
const library = openDatabase().then((db) => new Library(db));
const openLibrary = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
chrome.action.onClicked.addListener(openLibrary);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
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
          "listingStatus",
          "saveListing",
          "observeCatalog",
        ].includes(message.type)
      )
        throw new Error("Unsupported site action");
      if (
        !["open", "listingStatus", "saveListing", "observeCatalog"].includes(
          message.type,
        ) &&
        canonicalUrl(message.url || message.metadata?.url) !==
          canonicalUrl(sender.url)
      )
        throw new Error("Title does not match the current page");
    }
    if (message.type === "open") {
      await openLibrary();
      return null;
    }
    const db = await library;
    switch (message.type) {
      case "catalog":
        return db.catalog(message.limit);
      case "observeCatalog":
        return db.observeCatalog(
          message.items,
          message.authoritative === true,
        );
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
