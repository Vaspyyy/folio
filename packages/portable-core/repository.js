import {
  emptyDocument,
  editDocument,
  mergeDocuments,
  randomHex,
  itemsOf,
} from "./model.js";
const result = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function openRepository(name = "folio-portable") {
  const r = indexedDB.open(name, 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("state");
    r.result.createObjectStore("assets", { keyPath: ["itemId", "index"] });
    r.result.createObjectStore("downloads", { keyPath: "id" });
  };
  const db = await result(r);
  db.onversionchange = () => db.close();
  const repo = new Repository(db);
  await repo.transaction(["state"], "readwrite", async (tx) => {
    const state = tx.objectStore("state");
    if (!(await result(state.get("device")))) state.put(randomHex(), "device");
  });
  return repo;
}
export class Repository {
  constructor(db) {
    this.db = db;
  }
  async transaction(stores, mode, work) {
    const tx = this.db.transaction(stores, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () =>
        reject(tx.error || new Error("Storage transaction aborted"));
      tx.onerror = () => {};
    });
    try {
      const value = await work(tx);
      await done;
      return value;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw e;
    }
  }
  get(key) {
    return this.transaction(["state"], "readonly", (tx) =>
      result(tx.objectStore("state").get(key)),
    );
  }
  set(key, value) {
    return this.transaction(["state"], "readwrite", (tx) => {
      tx.objectStore("state").put(value, key);
    });
  }
  document() {
    return this.get("document").then((v) => v ?? emptyDocument());
  }
  async edit(id, patch) {
    const device = await this.get("device");
    return this.transaction(["state"], "readwrite", async (tx) => {
      const s = tx.objectStore("state");
      const next = editDocument(
        (await result(s.get("document"))) ?? emptyDocument(),
        device,
        id,
        patch,
      );
      s.put(next, "document");
      return next;
    });
  }
  merge(doc) {
    return this.transaction(["state"], "readwrite", async (tx) => {
      const s = tx.objectStore("state");
      const next = mergeDocuments(
        (await result(s.get("document"))) ?? emptyDocument(),
        doc,
      );
      s.put(next, "document");
      return next;
    });
  }
  async items() {
    return itemsOf(await this.document());
  }
  async keep(id, blobs) {
    if (!blobs.length || blobs.length > 1000)
      throw new Error("Choose between 1 and 1,000 page images");
    const bytes = blobs.reduce((n, b) => n + b.size, 0);
    if (
      bytes > 512 * 1024 * 1024 ||
      blobs.some(
        (b) =>
          !b.type.startsWith("image/") ||
          b.type === "image/svg+xml" ||
          b.size > 25 * 1024 * 1024,
      )
    )
      throw new Error(
        "Use raster images up to 25 MB each and 512 MB per title",
      );
    return this.transaction(
      ["assets", "downloads"],
      "readwrite",
      async (tx) => {
        const assets = tx.objectStore("assets");
        const old = await result(
          assets.getAllKeys(IDBKeyRange.bound([id, 0], [id, 1000])),
        );
        for (const key of old) assets.delete(key);
        blobs.forEach((blob, index) => assets.put({ itemId: id, index, blob }));
        const item = { id, count: blobs.length, bytes };
        tx.objectStore("downloads").put(item);
        return item;
      },
    );
  }
  downloads() {
    return this.transaction(["downloads"], "readonly", (tx) =>
      result(tx.objectStore("downloads").getAll()),
    );
  }
  assets(id) {
    return this.transaction(["assets"], "readonly", async (tx) =>
      (
        await result(
          tx
            .objectStore("assets")
            .getAll(IDBKeyRange.bound([id, 0], [id, 1000])),
        )
      )
        .sort((a, b) => a.index - b.index)
        .map((v) => v.blob),
    );
  }
  forget(id) {
    return this.transaction(
      ["assets", "downloads"],
      "readwrite",
      async (tx) => {
        const s = tx.objectStore("assets");
        for (const key of await result(
          s.getAllKeys(IDBKeyRange.bound([id, 0], [id, 1000])),
        ))
          s.delete(key);
        tx.objectStore("downloads").delete(id);
      },
    );
  }
}
