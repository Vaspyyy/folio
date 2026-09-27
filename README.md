> **New direction: Folio personal library** — the new browser extension lives in [`extension/`](extension/README.md). It provides a full-page library, collections, reading state, and backup/import, plus a **For you** discovery shelf that ranks unsaved titles observed while you browse with the standalone recommender in [`packages/local-recommender/`](packages/local-recommender/README.md). Build it with `npm ci && npm run build`, then load `dist/` as an unpacked Chromium extension. The userscript below remains the legacy ranking tool.

# Multporn Rank by Page Count

A userscript that lets you sort multporn.net listings **by comic page count**, live in the browser.

The site itself only sorts by newest, updated, or most viewed — there is no built-in page-count ranking
(every sorting surface was checked: `/new`, `/sort_comics`, `/best`, `/search`). This script adds it:
open any tag, section, character, author, search, `/sort_comics` or `/new` page, and it scans the whole
listing, counts every comic's pages in the background, and shows you a grid ranked longest-first —
so you can actually find the long, high-effort comics.

## Install

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome / Firefox / Edge) — recommended
   - [Violentmonkey](https://violentmonkey.github.io/) (Firefox / Chrome)
2. Open the manager's dashboard → **Create new script**.
3. Delete the template and paste the entire contents of `multporn-pagecount.user.js`.
4. Save (Ctrl+S).
5. Visit any multporn.net listing page — the control panel appears bottom-right.

## Usage

1. Go to a listing page, e.g. the **Furry** tag:
   `https://multporn.net/category/furry?rule34=2`
   (also works on sections like `/comics/super_mario`, `/sort_comics` with filters,
   `/search?search_api_views_fulltext=...`, `/new`, character/author pages).
2. The scan starts automatically. The panel shows progress:
   - **Scanning listing pages…** — walks the pagination of the whole listing to collect every comic.
   - **Fetching page counts…** — fetches each comic page and counts its gallery images
     (the grid fills in live as counts arrive).
3. When done, the listing is replaced by a card grid sorted by **pages (high → low)**.
   Each card shows the thumbnail, title, view count and a green page-count badge.
   The scan starts from the first listing page even if you opened a later page.
4. Use the panel to switch sorts (**Pages ↑ / Views ↓ / Original order**) or
   **↻ Refresh** to re-fetch counts (e.g. for comics that got new chapters).

Comic detail pages also get a "N pages" badge next to the title.

## Controls

| Control | What it does |
|---|---|
| **Sort** | Pages ↓ / Pages ↑ / Views ↓ / Original order (the original listing is restored) |
| **Scan pages** | Limit how many listing pages to scan (`0` = the whole listing) |
| **Cache days** | Reuse saved page counts for this many days (`0` = never reuse) |
| **▶ Start / resume** | Run the scan (or continue after Stop) |
| **■ Stop** | Abort the current scan/count |
| **↻ Refresh** | Delete cached counts for the current listing and re-fetch |

## How it works

- **Page count** = number of gallery images on the comic's page (the HTML contains every image;
  verified against the site's own juicebox XML, 12 = 12).
- **Pagination** is auto-detected per page type (tag pages use `page=0,N`, `/sort_comics` uses `page=N`).
- **Caching**: completed full-listing URL scans and page counts are stored in your browser's `localStorage`,
  so revisits are instant and big tags only cost time once. Limited or interrupted listing scans are not reused
  as complete results. Storage keys: `mpr:counts`, `mpr:listing`, `mpr:settings`.
- **All requests go to multporn.net from your own browser** — no third parties, no login needed.

## Notes & limits

- **Big tags take a while.** Furry (~2,400 comics) ≈ 3–5 minutes on first visit; `/new`
  (~22,000 items across all types) is far larger — use the *Scan pages* limit there, or stick to tags.
- **Ongoing comics** grow over time; their counts go stale after `cache days` and on **↻ Refresh**.
- **Section browsers** (`/comics`, `/manga`, `/comics_rus`, …) list franchises, not comics — use a tag,
  manga franchise page, search page or `/sort_comics` page to rank actual entries.
- The listing cache is tied to the listing path and filters you used; the pagination parameter is intentionally
  omitted so a full scan is reusable from any page in that listing. `/category/furry?rule34=2` and
  `/sort_comics?field_category_tid=furry` are separate caches.
- Be polite: the script throttles to 6 concurrent requests with small delays. If the site ever rate-limits
  you, lower *concurrency* in the settings object near the top of the script or use a smaller listing.

## Development checks

Run the built-in checks with Deno:

```sh
deno check --no-config multporn-pagecount.user.js tests/multporn-pagecount.test.mjs
deno test --no-config --allow-read tests/multporn-pagecount.test.mjs
```

The tests cover URL normalization, object-to-URL count requests, offset pagination, cache signatures and
listing metadata extraction.

## Files

- `multporn-pagecount.user.js` — the userscript (paste into your manager)
- `tests/multporn-pagecount.test.mjs` — lightweight regression tests for the scan/count helpers
