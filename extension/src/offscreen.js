import {
  detectTitle,
  extractListingItems,
  listingPageUrls,
  readerPages,
  snapshotMetadata,
} from "./adapters/multporn.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchDocument(url) {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = new Error(
      response.status === 429
        ? "Source rate limit reached"
        : `Source returned HTTP ${response.status}`,
    );
    error.rateLimited = response.status === 429;
    throw error;
  }
  const html = await response.text();
  if (html.length > 8_000_000) throw new Error("Source page is too large");
  return new DOMParser().parseFromString(html, "text/html");
}

function serializableListingItems(doc, href) {
  return extractListingItems(doc, href).map(({ mount, ...metadata }) => metadata);
}

async function discover({
  roots = ["https://multporn.net/"],
  maxListingPages = 4,
  maxDetails = 12,
  requestDelayMs = 350,
  skipDetailIds = [],
  followedUrls = [],
} = {}) {
  const skipped = new Set(skipDetailIds);
  const listings = new Map();
  const details = [];
  const followed = [];
  const errors = [];
  let rateLimited = false;
  let fetchedPages = 0;

  for (const rootUrl of roots) {
    if (rateLimited) break;
    try {
      const root = await fetchDocument(rootUrl);
      const pageUrls = listingPageUrls(root, rootUrl, maxListingPages);
      for (let index = 0; index < pageUrls.length; index++) {
        if (rateLimited) break;
        let doc = index === 0 ? root : null;
        try {
          if (!doc) {
            await sleep(requestDelayMs);
            doc = await fetchDocument(pageUrls[index]);
          }
          fetchedPages++;
          for (const item of serializableListingItems(doc, pageUrls[index]))
            listings.set(item.url, item);
        } catch (error) {
          errors.push(`${pageUrls[index]}: ${error.message}`);
          if (error.rateLimited) rateLimited = true;
        }
      }
    } catch (error) {
      errors.push(`${rootUrl}: ${error.message}`);
      if (error.rateLimited) rateLimited = true;
    }
  }

  const detailTargets = [...listings.values()]
    .filter((item) => !skipped.has(item.url))
    .slice(0, maxDetails);
  for (let i = 0; i < detailTargets.length && !rateLimited; i += 2) {
    const batch = detailTargets.slice(i, i + 2);
    await Promise.all(
      batch.map(async (item) => {
        try {
          await sleep(requestDelayMs);
          const doc = await fetchDocument(item.url);
          const metadata = detectTitle(doc, item.url);
          if (!metadata) throw new Error("Unsupported title markup");
          const pages = readerPages(doc, item.url);
          details.push({
            ...metadata,
            pageCount: pages.length || metadata.pageCount,
            covers: [
              ...new Set([
                metadata.coverUrl,
                ...(metadata.covers || []),
                ...pages,
              ].filter(Boolean)),
            ].slice(0, 8),
          });
        } catch (error) {
          errors.push(`${item.url}: ${error.message}`);
          if (error.rateLimited) rateLimited = true;
        }
      }),
    );
  }

  for (const url of followedUrls) {
    if (rateLimited) break;
    try {
      await sleep(requestDelayMs);
      const doc = await fetchDocument(url);
      followed.push(snapshotMetadata(doc, url));
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
      if (error.rateLimited) rateLimited = true;
    }
  }

  return {
    listings: [...listings.values()],
    details,
    followed,
    stats: {
      fetchedPages,
      discovered: listings.size,
      enriched: details.length,
      followed: followed.length,
      rateLimited,
      errors: errors.slice(0, 12),
    },
  };
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== "offscreen:discover") return;
  discover(message.options).then(
    (value) => reply({ ok: true, value }),
    (error) => reply({ ok: false, error: error.message }),
  );
  return true;
});
