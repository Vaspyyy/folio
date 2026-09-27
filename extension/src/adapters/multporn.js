import { canonicalUrl, coverUrl } from "../core/model.js";
export function cleanTitle(doc) {
  const heading = doc.querySelector("h1");
  if (!heading) return "";
  const clone = heading.cloneNode(true);
  // The legacy userscript appends an unclassed span containing "N pages".
  // Remove badge elements, not a suffix in the title's own text.
  for (const badge of clone.querySelectorAll("span, .mpr-badge")) {
    if (
      badge.matches(".mpr-badge") ||
      /^\s*[\d,]+\s+pages?\s*$/i.test(badge.textContent)
    )
      badge.remove();
  }
  return clone.textContent.replace(/\s+/g, " ").trim();
}
export function pageTags(root) {
  // Only explicit title tag fields are evidence. Global category navigation,
  // related listings, and linked titles must not become this title's metadata.
  const gallery = root.querySelector(
    ".juicebox-container, #juicebox-container, .pages--full",
  );
  const scope = gallery?.closest("article, .node") || root;
  const nodes = scope.querySelectorAll(
    ".field-name-field-tags a[href], .field-name-field-tags .field-item",
  );
  const tags = [];
  for (const node of nodes) {
    if (node.closest("nav, aside, footer, .view, .related, .related-content"))
      continue;
    // Inspect anchors themselves, never a wrapper's combined link text.
    if (node.matches(".field-item") && node.querySelector("a, .field-item"))
      continue;
    const href = node.getAttribute("href");
    if (node.matches("a") && !termFromHref(href)) continue;
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    const tag = (text || termFromHref(href)).slice(0, 80);
    if (tag && !tags.some((value) => value.toLowerCase() === tag.toLowerCase()))
      tags.push(tag);
    if (tags.length >= 40) break;
  }
  return tags;
}
function termFromHref(href) {
  if (!href) return "";
  try {
    const url = new URL(href, "https://multporn.net");
    if (url.origin !== "https://multporn.net" || url.username || url.password)
      return "";
    const match = /^\/(?:category|tag)\/([^/]+)\/?$/.exec(url.pathname);
    return match ? decodeURIComponent(match[1]).replace(/[_-]+/g, " ") : "";
  } catch {
    return "";
  }
}
export function detectTitle(doc, href) {
  let url;
  try {
    url = canonicalUrl(href);
  } catch {
    return null;
  }
  const gallery = doc.querySelector(
    ".juicebox-container, #juicebox-container, .pages--full",
  );
  if (!gallery) return null;
  const title = cleanTitle(doc);
  if (!title) return null;
  // Slideshow DOM may contain only the current image, duplicate slides or thumbnails.
  // Its authoritative count comes from the reader API, never a count of rendered imgs.
  const images = readingImages(doc);
  return {
    url,
    title,
    pageCount: images.length || null,
    author: [...doc.querySelectorAll(".field-name-field-author a")]
      .map((a) => a.textContent.trim())
      .join(", "),
    description: (
      doc.querySelector(".field-name-body .field-item")?.textContent ||
      doc.querySelector('meta[name="description"]')?.getAttribute("content") ||
      ""
    )
      .trim()
      .slice(0, 6000),
    tags: pageTags(doc),
    covers: [
      ...new Set(
        [...gallery.querySelectorAll("img")]
          .map((img) => coverUrl(img.getAttribute("src")))
          .filter(Boolean),
      ),
    ].slice(0, 8),
    coverUrl: coverUrl(
      doc.querySelector('meta[property="og:image"]')?.getAttribute("content"),
    ),
  };
}
export function readingImages(doc) {
  return [...doc.querySelectorAll(".pages--full img")];
}

function sourceImageUrl(value, base = "https://multporn.net/") {
  if (!value || typeof value !== "string") return null;
  try {
    return coverUrl(new URL(value, base).href);
  } catch {
    return null;
  }
}

function imageCandidate(node, base) {
  for (const attribute of ["data-src", "data-lazy-src", "src"]) {
    const value = sourceImageUrl(node.getAttribute?.(attribute), base);
    if (value) return value;
  }
  const srcset = node.getAttribute?.("srcset");
  if (srcset) {
    const candidates = srcset
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
    for (const candidate of candidates.reverse()) {
      const value = sourceImageUrl(candidate, base);
      if (value) return value;
    }
  }
  return null;
}

export function readerPages(root, href = "https://multporn.net/") {
  const nodes = [
    ...root.querySelectorAll(
      ".pages--full img, .juicebox-container .jb-image img, #juicebox-container .jb-image img",
    ),
  ];
  // Juicebox pages are commonly mirrored in noscript markup. Parse that inert
  // markup so the native reader never needs to execute the source site's scripts.
  for (const source of root.querySelectorAll(
    ".juicebox-container noscript, #juicebox-container noscript",
  )) {
    if (source.querySelector("img")) {
      nodes.push(...source.querySelectorAll("img"));
      continue;
    }
    const template = root.ownerDocument?.createElement?.("template");
    if (!template) continue;
    template.innerHTML = source.textContent || "";
    nodes.push(...template.content.querySelectorAll("img"));
  }
  return [
    ...new Set(nodes.map((node) => imageCandidate(node, href)).filter(Boolean)),
  ];
}

export function readerSnapshot(root, href) {
  const meta = detectTitle(root, href);
  if (!meta) throw new Error("This page does not expose a supported gallery");
  const pages = readerPages(root, href);
  if (!pages.length)
    throw new Error("Reader pages are not available in the source HTML");
  return {
    metadata: {
      ...meta,
      pageCount: pages.length,
      covers: [...new Set([meta.coverUrl, ...pages].filter(Boolean))].slice(
        0,
        8,
      ),
    },
    pages,
  };
}

export function listingPageUrls(root, href, limit = 4) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new RangeError("listing page limit must be between 1 and 20");
  const base = new URL(href);
  const pages = new Map([[base.href, -1]]);
  for (const link of root.querySelectorAll('a[href*="page="]')) {
    try {
      const url = new URL(link.getAttribute("href"), base);
      if (url.origin !== base.origin || url.pathname !== base.pathname) continue;
      const raw = url.searchParams.get("page");
      if (raw === null) continue;
      const n = Number(raw.split(",").pop());
      if (!Number.isInteger(n) || n < 0) continue;
      pages.set(url.href, n);
    } catch {}
  }
  return [...pages.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([url]) => url);
}

export function extractListingItems(doc, href) {
  const found = new Map();
  for (const link of doc.querySelectorAll(
    [
      ".view-content .views-field-title a[href]",
      ".view-content .views-field-field-preview a[href]",
      ".view-content .views-field-field-preview-1 a[href]",
      ".view-content .views-field-field-files a[href]",
      ".mpr-card a[href]",
    ].join(", "),
  )) {
    let url;
    try {
      url = canonicalUrl(new URL(link.getAttribute("href"), href).href);
    } catch {
      continue;
    }
    if (found.has(url)) continue;
    const wrapper =
      link.closest("li, .views-row, td, .masonry-item, .mpr-card") ||
      link.parentElement;
    const title = (
      wrapper.querySelector(".mpr-title")?.textContent ||
      wrapper.querySelector(".views-field-title a, .views-field-name a")
        ?.textContent ||
      link.textContent
    )
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;
    found.set(url, {
      url,
      title,
      pageCount: null,
      coverUrl: coverUrl(wrapper.querySelector("img")?.getAttribute("src")),
      mount: wrapper,
    });
  }
  return [...found.values()];
}

export function snapshotMetadata(root, href) {
  return readerSnapshot(root, href).metadata;
}
