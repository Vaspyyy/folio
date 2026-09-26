export const STATUSES = ["planned", "reading", "finished", "dropped"];
export function canonicalUrl(value) {
  const u = new URL(value);
  if (
    u.origin !== "https://multporn.net" ||
    !/^\/(?:comics\/[^/]+|hentai_manga\/[^/]+|mp\d+)\/?$/.test(u.pathname)
  )
    throw new Error("Unsupported title URL");
  return u.origin + u.pathname.replace(/\/$/, "");
}
export function coverUrl(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.origin === "https://multporn.net" &&
      u.pathname.startsWith("/sites/default/files/") &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
const shortText = (value, max = 1000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
export function metadata(value) {
  const url = canonicalUrl(value.url);
  const title = String(value.title || "")
    .trim()
    .slice(0, 500);
  if (!title) throw new Error("A title is required");
  const pageCount =
    Number.isInteger(value.pageCount) && value.pageCount > 0
      ? value.pageCount
      : null;
  return {
    id: url,
    url,
    source: "multporn",
    title,
    pageCount,
    coverUrl: coverUrl(value.coverUrl),
    author: shortText(value.author, 300),
    description: shortText(value.description, 6000),
    covers: [
      ...new Set(
        (Array.isArray(value.covers) ? value.covers : [])
          .map(coverUrl)
          .filter(Boolean),
      ),
    ].slice(0, 8),
    observedAt: Date.now(),
  };
}
export function personal(value = {}) {
  if (value.status !== undefined && !STATUSES.includes(value.status))
    throw new Error("Invalid reading status");
  const page = value.page ?? 0;
  if (!Number.isInteger(page) || page < 0 || page > 1000000)
    throw new Error("Invalid page");
  if (
    value.collections !== undefined &&
    (!Array.isArray(value.collections) ||
      value.collections.some((x) => typeof x !== "string"))
  )
    throw new Error("Invalid collections");
  return {
    status: value.status || "planned",
    page,
    collections: [
      ...new Set(
        (value.collections || [])
          .map((x) => x.trim().slice(0, 80))
          .filter(Boolean),
      ),
    ].slice(0, 30),
    favorite: value.favorite === true,
    queued: value.queued === true,
    following: value.following === true,
    acknowledgedCount:
      Number.isInteger(value.acknowledgedCount) && value.acknowledgedCount >= 0
        ? value.acknowledgedCount
        : null,
    publication: ["unknown", "ongoing", "complete"].includes(value.publication)
      ? value.publication
      : "unknown",
    notes: shortText(value.notes, 10000),
    coverChoice:
      value.coverChoice === "jacket"
        ? "jacket"
        : coverUrl(value.coverChoice) || "auto",
    orders: Object.fromEntries(
      Object.entries(value.orders || {})
        .filter(([k, v]) => k.length < 120 && Number.isFinite(v) && v >= 0)
        .slice(0, 40),
    ),
    history: (Array.isArray(value.history) ? value.history : [])
      .filter(
        (h) =>
          h &&
          ["page", "status"].includes(h.type) &&
          Number.isFinite(h.at) &&
          h.at > 0 &&
          Number.isInteger(h.page) &&
          h.page >= 0,
      )
      .slice(-50)
      .map((h) => ({
        type: h.type,
        page: h.page,
        at: h.at,
        status: STATUSES.includes(h.status) ? h.status : "reading",
      })),
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}
export function validateBackup(data) {
  if (
    data?.format !== "folio-library" ||
    ![1, 2].includes(data.version) ||
    !Array.isArray(data.entries) ||
    data.entries.length > 50000
  )
    throw new Error("Unsupported backup format");
  const seen = new Set();
  return data.entries.map((entry) => {
    const m = metadata(entry.metadata);
    if (seen.has(m.id)) throw new Error("Duplicate title in backup");
    seen.add(m.id);
    return {
      metadata: m,
      personal: {
        id: m.id,
        ...personal({
          ...entry.personal,
          acknowledgedCount: entry.personal?.acknowledgedCount ?? m.pageCount,
        }),
      },
    };
  });
}

export function newPages(entry) {
  const base = entry.personal.acknowledgedCount;
  return entry.personal.following &&
    Number.isInteger(base) &&
    entry.metadata.pageCount > base
    ? entry.metadata.pageCount - base
    : 0;
}
