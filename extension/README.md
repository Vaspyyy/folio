# Folio — personal comic library

Folio is a Manifest V3 browser extension with its own library interface. It is a new application alongside the original ranking userscript, not a rewrite of that script's UI.

## Build and install

Requires Node.js 22+ and npm.

```sh
npm ci
npm run build
```

In Brave/Chrome/Chromium, open the extensions management page, enable **Developer mode**, choose **Load unpacked**, and select this project's `dist/` directory. Click the extension's toolbar action to open your library. After rebuilding, click Reload on its extension card and reload open source tabs.

This release targets Chromium browsers. Firefox packaging and validation are not included.

## First workflow

1. Open Folio. Background discovery periodically scans a small bounded slice of source listings and builds the local candidate catalog without opening source tabs.
2. Open **For you** and choose **Refresh discovery** whenever you want an immediate scan.
3. Pick a recommendation or saved title and choose **Read in Folio**. The extension fetches the source HTML, extracts the gallery image URLs without executing source scripts, and renders them in its own reader.
4. Use paged or continuous mode, fit width/height, zoom, fullscreen, and keyboard navigation. Reading progress is written to the same local library record.
5. Saving is optional before previewing. An unsaved recommendation can be opened in Folio Reader first and saved from the reader if you want to keep it.

The older source-page companion remains available as a fallback and for metadata capture when you happen to browse the source directly, but normal discovery and reading no longer require keeping the source website open.

After upgrading to 0.2.0, reload the extension and source tabs. Revisit each existing title once to repair its title and page count. Legacy userscript page badges are excluded from heading extraction. Personal records are preserved; no database reset or reimport is needed. Missing reader APIs leave manual bookmarking available. A resume request waits up to 15 seconds for reader initialization and never clamps an unavailable bookmark to another page.

## Bookshelf (0.3.0)

The library now opens with a Continue Reading section featuring the three most recently active titles marked Reading. The shelf uses book jackets, status badges, and progress bars. Finished titles show 100%; titles with unknown lengths show their bookmark without inventing a percentage.

Use the **···** control on a card to open its editor. Change status, bookmark, or collections, then choose **Save changes**. Escape closes the editor; opening another closes the previous one. Returning to the tab does not discard an open editor's draft.

**Cover artwork** is optional and off by default. Turning it on loads cover images directly from the source website, with no referrer, and remembers the preference on this browser. With artwork off, no cover requests are made; designed typographic jackets remain visible. Missing or failed images also fall back to those jackets. The source URL must be HTTPS on multporn.net under `/sites/default/files/`.

Existing records acquire a cover URL the next time you visit their title page after reloading the extension and source tabs. Previously saved covers survive metadata refreshes and are included in backup exports; older backups without covers still import normally. Images themselves are not downloaded for offline storage.

The library supports title search, status/collection filters, recent activity/title/page-count sorting, and JSON export/import. Imports add missing titles and leave existing personal records intact. Removing a title deletes its metadata and personal record after confirmation.

Data stays in the extension's IndexedDB on this browser profile. Source website scripts cannot directly read it. There is no account, server, telemetry, or automatic cross-device synchronization. Version 0.6 adds a bounded local background discovery crawler that runs from the extension itself. Back up before uninstalling the extension or changing browser profiles; uninstalling can erase extension storage.

## Personal workspace (0.4.0)

- **Save while browsing:** supported source listing cards get a Save to Folio button and saved reading-status indicators. Newly appended listings are detected. The legacy userscript's ranking cards are supported too.
- **Title drawer:** click a book cover or title to view its author, description, collections, and recent reading history. Refresh details fetches the source page. Add private notes, Favorite, pin to Read next, follow new pages, and choose a cover or typographic jacket. Personal edits are saved explicitly.
- **Updates:** enable Follow new pages in a title's drawer, then open Updates → Check for updates. Manual checks still run sequentially and can be stopped. In 0.6, scheduled discovery also refreshes a bounded set of followed titles in the background; rate limiting stops the current discovery cycle.
- **New-page baseline:** saved titles start with their known page count as the baseline. Growth above it appears in Updates. Read new pages opens the first page beyond that baseline and resumes reading; Mark seen acknowledges the latest count without changing your reading status or bookmark. Repeated checks don't consume updates. Titles with no known count establish a baseline on their first successful count instead of claiming all pages are new.
- **Publication status:** Unknown / Still publishing / Publication complete is a separate personal label. Marking a title Finished means you finished reading; Folio does not infer that the author has stopped publishing.
- **Collections and queue:** collection names become sidebar destinations with cover mosaics. Favorites and Read next have dedicated shelves. Drag cards or use Move earlier/later controls to arrange shelves. Collection and queue orders are stored independently. Selecting a collection uses Shelf order; other sorts remain available.
- **Appearance:** Paper, Midnight, or System theme, with Comfortable or Compact shelf density. A per-title cover choice is independent of the global artwork toggle. Refresh details obtains up to eight source artwork candidates; their preview respects the artwork toggle.
- **Privacy:** Hide library conceals library titles, artwork, collection names, and the detail drawer, removes rendered cover images, and remains enabled across reloads. Reveal library restores the display. This is a display control, not encryption or a lock on stored data.
- **Continue Reading:** the lead section still displays at most three titles. View all opens the full Reading shelf.

Existing records migrate automatically to database version 3. Bookmarks, statuses, collections, and timestamps are preserved. New backup exports use format version 3 and include favorites, queue/shelf ordering, follow baselines, notes, cover choices, publication labels, and up to 50 recent reading events. Versions 1 and 2 backups remain importable. Appearance preferences remain local to this browser.

Reload the unpacked extension, then reload the library and source tabs. Version 0.4.0 adds access to `https://multporn.net/*` so the library can fetch source metadata for the actions above. If the browser asks to approve that site access, enable it to use update checks and Refresh details. No other host access is requested.

## Recommendations (0.5.0)

**For you** is a discovery shelf, not a sort mode for the existing library. Folio keeps two separate local datasets:

- **Library observations** train the taste profile. Merely saving is weak evidence; reading/finishing is stronger, favorites are stronger again, and explicit **More like this / Less like this** choices are strongest.
- **Catalog observations** are unsaved titles seen on source listing/detail pages. Listing scans record candidates without adding them to the personal library. Detail visits store authoritative tags/authors, and opening For You performs a small, rate-limited enrichment pass for candidates still missing detail metadata.
- **Candidates stay unsaved.** The ranking worker receives the personal library as profile evidence and the unsaved local catalog as candidates. Saved titles are never returned as recommendations.
- **Familiar ↔ Explore** trades close tag/author/combination affinity for novelty and slate diversity while retaining hard exclusions and negative evidence.
- **Feedback persists independently of library membership.** Saving or later removing a title does not erase an explicit taste choice. **Hide** is a hard candidate dismissal; **Less like this** is negative preference evidence and is intentionally different.
- **Storage stays local.** The catalog is bounded to 2,500 passive observations. Recommendation preferences are stored in `localStorage`; catalog/library metadata live in IndexedDB. The worker keeps ranking off the UI thread and stale jobs are cancelled.

Tag extraction accepts only explicit title tag fields. Passive listing observations never erase richer detail metadata; an authoritative detail observation may intentionally replace fields with empty values when the source really reports none.

## Autonomous discovery and Folio Reader (0.6.0)

Folio no longer depends on a source tab being open.

- **Background discovery:** a Manifest V3 alarm runs roughly every six hours. A short-lived offscreen document provides DOM parsing while the service worker owns scheduling, state, storage, and rate-limit handling. Scheduled runs inspect up to four listing pages and enrich up to twelve stale/new candidates; a manual Refresh discovery run can inspect up to six listing pages and eighteen candidates.
- **Polite source access:** requests are same-origin to the configured source, use no credentials, reject redirects, have timeouts and size limits, run detail enrichment in pairs with delays, and stop the cycle on rate limiting. The existing 2,500-item catalog cap still applies.
- **Native reader:** Folio Reader fetches one title page, parses supported gallery images from inert HTML, and displays the images on a `chrome-extension://` page. Source JavaScript is not executed. Paged and continuous modes, fit controls, zoom, fullscreen, keyboard navigation, save-from-preview, and local progress are built in.
- **Fallback:** if Folio cannot recognize a title's gallery markup, the reader shows an explicit source-page fallback instead of silently inventing pages.
- **Legacy companion:** source-page reading support remains for compatibility, but library Continue reading, Read again, Read new pages, and recommendation clicks now target Folio Reader.

The source still hosts the metadata and page images. "Independent reader" here means Folio owns discovery, navigation, presentation, progress, and library UX; it does not copy or permanently mirror the source media.

## Architecture

- `src/core/model.js`: validated records and versioned backup format.
- `src/core/database.js`: IndexedDB schema migrations and atomic storage operations. `personal` owns reading state, `metadata` owns saved-title source metadata, and `catalog` owns bounded unsaved discovery observations.
- `src/core/recommender.js`: the Folio side of the local recommender. Maps library records to ranking items, rebuilds the profile from the library plus the stored explicit choices, and owns the `folio:recommender` profile store.
- `packages/local-recommender/`: the standalone, dependency-free ranking package. Used by `ranking-worker.js`; it still knows nothing about Folio's models or database.
- `src/adapters/multporn.js`: source adapter for title/listing metadata, pagination discovery, and native-reader page extraction.
- `src/adapters/juicebox-bridge.js`: small MAIN-world bridge using the site's `window.jcgal` API. Supports only reading current/total pages and navigating to a bounded image index. It has no access to extension storage.
- `src/adapters/reader.js`: isolated-world bridge client with validated responses and request timeouts.
- `src/content.js`: isolated site companion, explicit bookmarks, and supported-reader progress.
- `src/listings.js`: isolated listing controls, bounded status lookups, and dynamic listing observation.
- `src/background.js`: service-worker message boundary plus six-hour discovery scheduling, offscreen-parser lifecycle, discovery status, and native-reader opening.
- `src/ui/workspace.js`: detail drawer, collections, preferences, privacy, and manual update-check orchestration.
- `src/ui/update-checker.js`: same-host, timeout-bounded HTML fetches parsed into inert templates; redirects are rejected, and source scripts are not executed.
- `src/offscreen.js`: short-lived DOM parser used by background discovery; it fetches bounded listing/detail pages and returns inert metadata snapshots.\n- `src/ui/reader.js`: native Folio reader and reading-progress persistence.\n- `src/ui/`: full-page library. All supplied titles and collection names are rendered as text.

Schema version 1 creates the saved metadata/personal stores; version 2 migrates personal records and initializes known page-count baselines; version 3 adds the separate unsaved `catalog` store. Future schema migrations belong in `onupgradeneeded`; unknown future backup versions are rejected. Writes resolve after transaction commit.

The extension requests host access only to `https://multporn.net/*` for source metadata checks. It requests no tabs permission or access to other sites. Its declared content scripts run only on `https://multporn.net/*`. Cover artwork loads only when the optional artwork toggle is enabled. The library remains usable offline with typographic jackets.

## Validation

```sh
npm run check
BROWSER_PATH=/usr/bin/brave npm run test:browser
```

The browser smoke tests also cover listing saves, notes and covers, update detection, cancellation/failures, queue and collection ordering, appearance, and privacy. The **For you** shelf has its own smoke test (`scripts/recommend-smoke.mjs`): it trains on a fixture library, ranks unsaved catalog candidates, checks save/dismiss/feedback behavior, verifies persisted Explore state, and exercises a 600-candidate worker ranking. The existing suites cover continuous readers, delayed Juicebox initialization, and the bookshelf UI (editing, progress, filters, optional covers, failed-image fallback, and responsive layout). The continuous-reader test loads the real built extension in a disposable profile, intercepts source requests with a non-explicit synthetic gallery, exercises saving/editing/reloading/resuming, and produces desktop/mobile screenshots in `test-results/`. It does not contact the live site. `BROWSER_PATH` can point to another compatible Chromium binary supporting unpacked extensions.

On 2026-09-26, the live technical probe verified a 43-page Juicebox title: count/title repair, saved status/collection preservation, API resume, page-change persistence, and reopening. Image, media, font, and third-party requests were blocked during the probe; this verifies the reader API workflow, not artwork rendering or every site layout. Slideshow totals come from the API rather than rendered image elements.

Run the opt-in live probe with `npm run test:live`. It creates a disposable browser profile, visits one real title, and blocks artwork and third-party resources. Normal tests remain fixture-only. The API integration follows the site's Juicebox loader and the [Juicebox API documentation](https://juicebox.net/support/api/).

## Scope and next steps

This release covers autonomous local discovery, a native Folio reader, personal organization, reading progress, and manual/scheduled metadata checks. Legacy cache import, automatic backup, offline media caching, and synchronization remain future work. The original userscript and its tests remain available at the project root. Its count cache contains observations, not saved-library choices, so it is not silently converted into personal records.

### Ranking responsiveness and tag boundaries

Ranking runs in a module worker, so library rendering and editing do not wait for
it. New requests terminate obsolete workers, and stale responses cannot replace
newer results. The profile and candidate pool are separate: saved/read titles train
taste, while unsaved catalog observations are ranked for discovery.

Tag extraction accepts only explicit `field-name-field-tags` fields in the current
title container when available. Navigation, sidebars, related listings, external
links, and wrappers around title links are excluded. Pages without a recognized
field yield no tags; live markup compatibility remains unverified.

## Paired Android companion (0.7.0)

Open **Your devices** from the library sidebar to pair with Folio Pocket. Library
metadata and reading progress sync through an encrypted relay. Your browser grants
access only to the relay origin you select; the manifest lists optional origins
so arbitrary personal relay servers can be used. Open a saved title in the Folio
reader once to share its page list, then select **Keep offline** on the phone.
Unsaved catalog records are not shared. See [the setup guide](../apps/README.md).
