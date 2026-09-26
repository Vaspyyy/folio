import { metadata, personal, validateBackup, canonicalUrl } from "./model.js";
export function openDatabase(name = "folio-library") {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore("metadata", { keyPath: "id" });
        db.createObjectStore("personal", { keyPath: "id" });
      }
      if (event.oldVersion < 2) {
        const tx = request.transaction,
          p = tx.objectStore("personal"),
          m = tx.objectStore("metadata");
        p.openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          const old = cursor.value;
          const read = m.get(old.id);
          read.onsuccess = () => {
            cursor.update({
              id: old.id,
              ...personal({
                ...old,
                acknowledgedCount:
                  old.acknowledgedCount ?? read.result?.pageCount,
              }),
            });
            cursor.continue();
          };
        };
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Close other library tabs to upgrade storage"));
  });
}
const result = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export class Library {
  constructor(db) {
    this.db = db;
  }
  async transaction(mode, work) {
    const tx = this.db.transaction(["metadata", "personal"], mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () =>
        reject(tx.error || new Error("Storage transaction aborted"));
      tx.onerror = () => {};
    });
    try {
      const value = await work(
        tx.objectStore("metadata"),
        tx.objectStore("personal"),
      );
      await done;
      return value;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async list() {
    return this.transaction("readonly", async (m, p) => {
      const [meta, records] = await Promise.all([
        result(m.getAll()),
        result(p.getAll()),
      ]);
      const byId = new Map(meta.map((x) => [x.id, x]));
      return records.map((record) => ({
        metadata: byId.get(record.id),
        personal: { id: record.id, ...personal(record) },
      }));
    });
  }
  async get(url) {
    const id = canonicalUrl(url);
    return this.transaction("readonly", async (m, p) => {
      const [meta, record] = await Promise.all([
        result(m.get(id)),
        result(p.get(id)),
      ]);
      return record
        ? { metadata: meta, personal: { id: record.id, ...personal(record) } }
        : null;
    });
  }
  async save(value, existingOnly = false) {
    const meta = metadata(value);
    await this.transaction("readwrite", async (m, p) => {
      const existing = await result(p.get(meta.id));
      if (existingOnly && !existing) throw new Error("Title no longer saved");
      const oldMeta = await result(m.get(meta.id));
      m.put({
        ...meta,
        author: meta.author || oldMeta?.author || "",
        description: meta.description || oldMeta?.description || "",
        covers: meta.covers.length ? meta.covers : oldMeta?.covers || [],
        coverUrl: meta.coverUrl ?? oldMeta?.coverUrl ?? null,
        pageCount: meta.pageCount ?? oldMeta?.pageCount ?? null,
      });
      if (!existing)
        p.put({
          id: meta.id,
          ...personal({ acknowledgedCount: meta.pageCount }),
        });
      else if (existing.acknowledgedCount == null && meta.pageCount != null)
        p.put({
          ...existing,
          acknowledgedCount: oldMeta?.pageCount ?? meta.pageCount,
        });
    });
    return this.get(meta.id);
  }
  async update(url, patch) {
    const id = canonicalUrl(url);
    await this.transaction("readwrite", async (m, p) => {
      const existing = await result(p.get(id));
      if (!existing) throw new Error("Save this title first");
      const meta = await result(m.get(id));
      const history = [...(existing.history || [])];
      if (
        (patch.status && patch.status !== existing.status) ||
        (patch.page !== undefined && patch.page !== existing.page)
      )
        history.push({
          type:
            patch.status && patch.status !== existing.status
              ? "status"
              : "page",
          page: patch.page ?? existing.page,
          status: patch.status || existing.status,
          at: Date.now(),
        });
      p.put({
        id,
        ...personal({
          ...existing,
          ...patch,
          history,
          acknowledgedCount:
            patch.status === "finished" && existing.status !== "finished"
              ? (meta?.pageCount ?? existing.acknowledgedCount)
              : existing.acknowledgedCount,
          updatedAt: Date.now(),
        }),
      });
    });
    return this.get(id);
  }
  async progress(url, page, automatic = false) {
    const id = canonicalUrl(url);
    await this.transaction("readwrite", async (_m, p) => {
      const existing = await result(p.get(id));
      if (!existing) throw new Error("Save this title first");
      // Recheck in the transaction: another library tab may have marked it finished.
      if (automatic && ["finished", "dropped"].includes(existing.status))
        return;
      p.put({
        id,
        ...personal({
          ...existing,
          page,
          acknowledgedCount:
            existing.acknowledgedCount == null
              ? null
              : Math.max(existing.acknowledgedCount, page),
          history: [
            ...(existing.history || []),
            { type: "page", page, status: "reading", at: Date.now() },
          ],
          status: "reading",
          updatedAt: Date.now(),
        }),
      });
    });
    return this.get(id);
  }
  async acknowledge(url) {
    const id = canonicalUrl(url);
    await this.transaction("readwrite", async (m, p) => {
      const [meta, record] = await Promise.all([
        result(m.get(id)),
        result(p.get(id)),
      ]);
      if (!record) throw new Error("Title no longer saved");
      p.put({
        ...record,
        acknowledgedCount: meta.pageCount ?? record.acknowledgedCount,
      });
    });
  }
  async reorder(urls, scope) {
    if (
      !Array.isArray(urls) ||
      urls.length > 50000 ||
      (!["all", "queue", "favorites"].includes(scope) &&
        !(
          typeof scope === "string" &&
          scope.startsWith("collection:") &&
          scope.length < 120
        ))
    )
      throw new Error("Invalid shelf order");
    const ids = urls.map(canonicalUrl);
    if (new Set(ids).size !== ids.length)
      throw new Error("Duplicate shelf entry");
    await this.transaction("readwrite", async (_m, p) => {
      for (let rank = 0; rank < ids.length; rank++) {
        const record = await result(p.get(ids[rank]));
        if (!record) throw new Error("Title no longer saved");
        p.put({
          ...record,
          orders: { ...(record.orders || {}), [scope]: rank },
        });
      }
    });
  }
  async remove(url) {
    const id = canonicalUrl(url);
    return this.transaction("readwrite", (m, p) => {
      m.delete(id);
      p.delete(id);
    });
  }
  async export() {
    return {
      format: "folio-library",
      version: 2,
      exportedAt: new Date().toISOString(),
      entries: await this.list(),
    };
  }
  async import(data) {
    const entries = validateBackup(data); // Validate everything before opening a write transaction.
    let added = 0;
    await this.transaction("readwrite", async (m, p) => {
      for (const entry of entries) {
        if (await result(p.get(entry.personal.id))) continue; // Merge without overwriting current personal records.
        m.put(entry.metadata);
        p.put(entry.personal);
        added++;
      }
    });
    return added;
  }
}
