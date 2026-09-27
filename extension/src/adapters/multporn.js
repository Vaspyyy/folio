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

export function extractListingItems(doc, href) {
  const found = new Map();
  for (const link of doc.querySelectorAll(
    ".view-content .views-field-title a[href], .mpr-card a[href]",
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
      wrapper.querySelector(".mpr-title")?.textContent || link.textContent
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
  const meta = detectTitle(root, href);
  if (!meta) throw new Error("This page does not expose a supported gallery");
  const nodes = [
    ...root.querySelectorAll(
      ".pages--full img, .juicebox-container .jb-image img, #juicebox-container .jb-image img",
    ),
  ];
  // In a browser template, noscript bodies are text; parse them in another inert template.
  for (const source of root.querySelectorAll(
    ".juicebox-container noscript, #juicebox-container noscript",
  )) {
    if (source.querySelector("img")) continue;
    const template = document.createElement("template");
    template.innerHTML = source.textContent;
    nodes.push(...template.content.querySelectorAll(".jb-image img"));
  }
  const images = [
    ...new Set(
      nodes.map((img) => coverUrl(img.getAttribute("src"))).filter(Boolean),
    ),
  ];
  if (!images.length)
    throw new Error("Page count unavailable; the previous count was kept");
  return {
    ...meta,
    pageCount: images.length,
    covers: [...new Set([meta.coverUrl, ...images].filter(Boolean))].slice(
      0,
      8,
    ),
  };
}
