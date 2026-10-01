export const FIELDS = [
  "title",
  "authors",
  "tags",
  "pages",
  "pageCount",
  "cover",
  "sourceUrl",
  "status",
  "page",
  "collections",
  "notes",
  "favorite",
  "queued",
  "deleted",
];
const statuses = ["planned", "reading", "finished", "dropped"];
export const text = (value, max = 500) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
export function mediaUrl(value) {
  if (!value) return "";
  const u = new URL(value);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Use an HTTP or HTTPS media address");
  return u.href;
}
const strings = (value, max = 50) =>
  [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .filter((v) => typeof v === "string")
        .map((v) => text(v, 120))
        .filter(Boolean),
    ),
  ].slice(0, max);
export function normalizeItem(value) {
  if (
    !value ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    value.id.length > 2000
  )
    throw new Error("Invalid title ID");
  const pages = (value.pages ?? []).map(mediaUrl);
  if (pages.length > 1000 || pages.some((v) => !v))
    throw new Error("A title supports at most 1,000 page addresses");
  const pageCount = value.pageCount ?? pages.length;
  if (!Number.isInteger(pageCount) || pageCount < 0 || pageCount > 1000000)
    throw new Error("Invalid page count");
  const page = value.page ?? 0;
  if (!Number.isInteger(page) || page < 0 || page > 1000000)
    throw new Error("Invalid reading position");
  const title = text(value.title);
  if (!title) throw new Error("Give this title a name");
  return {
    id: value.id,
    title,
    authors: strings(value.authors),
    tags: strings(value.tags),
    pages,
    pageCount,
    cover: mediaUrl(value.cover),
    sourceUrl: mediaUrl(value.sourceUrl),
    status: statuses.includes(value.status) ? value.status : "planned",
    page,
    collections: strings(value.collections, 30),
    notes: text(value.notes, 10000),
    favorite: value.favorite === true,
    queued: value.queued === true,
    deleted: value.deleted === true,
  };
}
export function emptyDocument() {
  return { version: 1, clock: 0, items: {} };
}
const keySort = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const newer = (a, b) =>
  !b ||
  a.clock > b.clock ||
  (a.clock === b.clock && keySort(a.device, b.device) > 0);
export function validateDocument(value) {
  if (
    value?.version !== 1 ||
    !Number.isSafeInteger(value.clock) ||
    value.clock < 0 ||
    !value.items ||
    Array.isArray(value.items) ||
    Object.keys(value.items).length > 5000
  )
    throw new Error("Invalid portable library");
  const items = {};
  for (const [id, fields] of Object.entries(value.items)) {
    const raw = { id };
    const clean = {};
    for (const [field, register] of Object.entries(fields)) {
      if (
        !FIELDS.includes(field) ||
        !register ||
        !Number.isSafeInteger(register.clock) ||
        register.clock < 1 ||
        register.clock > value.clock ||
        typeof register.device !== "string" ||
        !/^[a-f0-9]{32}$/.test(register.device)
      )
        throw new Error("Invalid library revision");
      raw[field] = register.value;
    }
    const normalized = normalizeItem(raw);
    for (const field of Object.keys(fields))
      clean[field] = { ...fields[field], value: normalized[field] };
    Object.defineProperty(items, id, {
      value: clean,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { version: 1, clock: value.clock, items };
}
export function itemsOf(doc, includeDeleted = false) {
  return Object.entries(doc.items)
    .map(([id, fields]) =>
      normalizeItem({
        id,
        ...Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, v.value]),
        ),
      }),
    )
    .filter((v) => includeDeleted || !v.deleted);
}
export function editDocument(doc, device, id, patch) {
  const next = structuredClone(validateDocument(doc));
  if (!/^[a-f0-9]{32}$/.test(device)) throw new Error("Invalid device ID");
  const fields = Object.hasOwn(next.items, id) ? next.items[id] : {};
  const existing = {
    id,
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.value])),
  };
  const item = normalizeItem({ ...existing, ...patch, id });
  const changes = FIELDS.filter(
    (k) =>
      Object.hasOwn(patch, k) &&
      JSON.stringify(fields[k]?.value) !== JSON.stringify(item[k]),
  );
  if (!changes.length) return next;
  next.clock++;
  for (const k of changes)
    fields[k] = { value: item[k], clock: next.clock, device };
  // A new record always needs its title and explicit deletion state.
  if (!fields.title)
    fields.title = { value: item.title, clock: next.clock, device };
  if (!fields.deleted)
    fields.deleted = { value: false, clock: next.clock, device };
  Object.defineProperty(next.items, id, {
    value: fields,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return next;
}
export function mergeDocuments(left, right) {
  const a = validateDocument(left),
    b = validateDocument(right);
  const result = emptyDocument();
  result.clock = Math.max(a.clock, b.clock);
  for (const id of [
    ...new Set([...Object.keys(a.items), ...Object.keys(b.items)]),
  ].sort(keySort)) {
    const fields = {};
    for (const k of FIELDS) {
      const x = a.items[id]?.[k],
        y = b.items[id]?.[k];
      if (x || y) fields[k] = structuredClone(y && newer(y, x) ? y : x);
    }
    Object.defineProperty(result.items, id, {
      value: fields,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}
export const randomHex = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
