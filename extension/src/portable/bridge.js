import { openRepository } from "../../../packages/portable-core/repository.js";
import { itemsOf } from "../../../packages/portable-core/model.js";
import { syncRepository } from "../../../packages/portable-core/sync.js";
import { canonicalUrl, metadata, personal } from "../core/model.js";
export const portableFields = (entry) => ({
  title: entry.metadata.title,
  authors: entry.metadata.author ? [entry.metadata.author] : [],
  tags: entry.metadata.tags ?? [],
  pageCount: entry.metadata.pageCount ?? 0,
  cover: entry.metadata.coverUrl ?? "",
  sourceUrl: entry.metadata.url,
  status: entry.personal.status,
  page: entry.personal.page,
  collections: entry.personal.collections,
  notes: entry.personal.notes ?? "",
  favorite: entry.personal.favorite === true,
  queued: entry.personal.queued === true,
  deleted: false,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const result = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
// Compare and project in one transaction: desktop edits made while the network
// request was in flight must win locally and receive a new portable revision.
async function project(library, item, expected) {
  return library.transaction("readwrite", async (m, p) => {
    const [meta, record] = await Promise.all([
      result(m.get(item.id)),
      result(p.get(item.id)),
    ]);
    const actual =
      meta && record
        ? portableFields({ metadata: meta, personal: personal(record) })
        : null;
    const before = expected ? portableFields(expected) : null;
    if (!actual && before) return { conflict: { deleted: true } };
    if (actual && !before) return { baseline: actual, conflict: actual };
    if (item.deleted) {
      if (actual && !same(actual, before))
        return { baseline: actual, conflict: actual };
      m.delete(item.id);
      p.delete(item.id);
      return {};
    }
    const values = {},
      conflict = {};
    for (const key of Object.keys(
      portableFields({
        metadata: { title: "", url: item.id },
        personal: personal(),
      }),
    )) {
      if (actual && !same(actual[key], before[key])) {
        values[key] = actual[key];
        conflict[key] = actual[key];
      } else values[key] = item[key];
    }
    if (actual && same(actual, values)) return { baseline: actual, conflict };
    const nextMeta = metadata({
      ...meta,
      url: item.id,
      title: values.title,
      author: values.authors.join(", "),
      tags: values.tags,
      pageCount: values.pageCount || null,
      coverUrl: values.cover || null,
    });
    const history = [...(record?.history || [])];
    if (
      record &&
      (values.status !== record.status || values.page !== record.page)
    )
      history.push({
        type: values.status !== record.status ? "status" : "page",
        status: values.status,
        page: values.page,
        at: Date.now(),
      });
    const nextPersonal = {
      id: item.id,
      ...personal({
        ...record,
        status: values.status,
        page: values.page,
        collections: values.collections,
        notes: values.notes,
        favorite: values.favorite,
        queued: values.queued,
        history,
        acknowledgedCount:
          !record ||
          (values.status === "finished" && record.status !== "finished")
            ? nextMeta.pageCount
            : record.acknowledgedCount,
        updatedAt: Date.now(),
      }),
    };
    m.put(nextMeta);
    p.put(nextPersonal);
    return {
      baseline: portableFields({ metadata: nextMeta, personal: nextPersonal }),
      conflict,
    };
  });
}
let syncing;
export function syncMobile(library, options = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    const repo = await openRepository();
    try {
      if (!(await repo.get("pair"))) return { paired: false };
      const old = (await repo.get("extensionBaseline")) ?? {};
      const current = await library.list();
      const byId = new Map(current.map((e) => [e.metadata.id, e]));
      for (const entry of current) {
        const id = entry.metadata.id,
          fields = portableFields(entry),
          patch = {};
        for (const [key, value] of Object.entries(fields))
          if (JSON.stringify(old[id]?.[key]) !== JSON.stringify(value))
            patch[key] = value;
        if (Object.keys(patch).length) await repo.edit(id, patch);
      }
      for (const id of Object.keys(old))
        if (!byId.has(id)) await repo.edit(id, { deleted: true });
      await syncRepository(repo, options);
      const shared = itemsOf(await repo.document(), true);
      const baseline = {};
      let changedDuringSync = false;
      for (const item of shared) {
        let id;
        try {
          id = canonicalUrl(item.sourceUrl);
        } catch {
          continue;
        }
        if (id !== item.id) continue;
        const projected = await project(library, item, byId.get(id));
        if (projected.baseline)
          Object.defineProperty(baseline, id, {
            value: projected.baseline,
            enumerable: true,
          });
        if (projected.conflict && Object.keys(projected.conflict).length) {
          await repo.edit(id, projected.conflict);
          changedDuringSync = true;
        }
      }
      // Baselines describe exactly what was projected, never a later snapshot
      // which could silently acknowledge edits that have not been exported.
      await repo.set("extensionBaseline", baseline);
      if (changedDuringSync) await syncRepository(repo, options);
      return { paired: true, lastSync: await repo.get("lastSync") };
    } finally {
      repo.db.close();
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}
export async function shareSavedPages(library, url, pages) {
  const entry = await library.get(url);
  if (!entry)
    throw new Error("Save this title before sending its pages to your devices");
  const repo = await openRepository();
  try {
    await repo.edit(entry.metadata.id, {
      ...portableFields(entry),
      pages,
      pageCount: pages.length,
    });
  } finally {
    repo.db.close();
  }
}
