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

1. Visit a supported title at multporn.net (comic, manga, or upload with a recognized gallery).
2. Select **Save to library** in the Folio companion.
3. Open **Library** to set reading status, collections, or a page bookmark.
4. Choose **Continue reading** to reopen the title. Juicebox readers navigate to the saved image through their API; continuous `.pages--full` readers scroll to it. Finished titles offer **Read again** from page 1.
5. Juicebox page changes are checked every 400 ms while the tab is visible. Continuous-reader scrolling updates progress after 600 ms of inactivity. Finished/dropped titles keep their status and bookmark during automatic tracking, including changes made in another library tab. The explicit Bookmark page action moves a title to Reading.

After upgrading to 0.2.0, reload the extension and source tabs. Revisit each existing title once to repair its title and page count. Legacy userscript page badges are excluded from heading extraction. Personal records are preserved; no database reset or reimport is needed. Missing reader APIs leave manual bookmarking available. A resume request waits up to 15 seconds for reader initialization and never clamps an unavailable bookmark to another page.

## Bookshelf (0.3.0)

The library now opens with a Continue Reading section featuring the three most recently active titles marked Reading. The shelf uses book jackets, status badges, and progress bars. Finished titles show 100%; titles with unknown lengths show their bookmark without inventing a percentage.

Use the **···** control on a card to open its editor. Change status, bookmark, or collections, then choose **Save changes**. Escape closes the editor; opening another closes the previous one. Returning to the tab does not discard an open editor's draft.

**Cover artwork** is optional and off by default. Turning it on loads cover images directly from the source website, with no referrer, and remembers the preference on this browser. With artwork off, no cover requests are made; designed typographic jackets remain visible. Missing or failed images also fall back to those jackets. The source URL must be HTTPS on multporn.net under `/sites/default/files/`.

Existing records acquire a cover URL the next time you visit their title page after reloading the extension and source tabs. Previously saved covers survive metadata refreshes and are included in backup exports; older backups without covers still import normally. Images themselves are not downloaded for offline storage.

The library supports title search, status/collection filters, recent activity/title/page-count sorting, and JSON export/import. Imports add missing titles and leave existing personal records intact. Removing a title deletes its metadata and personal record after confirmation.

Data stays in the extension's IndexedDB on this browser profile. Source website scripts cannot directly read it. There is no account, server, background crawler, telemetry, or automatic cross-device synchronization. Back up before uninstalling the extension or changing browser profiles; uninstalling can erase extension storage.

## Personal workspace (0.4.0)

- **Save while browsing:** supported source listing cards get a Save to Folio button and saved reading-status indicators. Newly appended listings are detected. The legacy userscript's ranking cards are supported too.
- **Title drawer:** click a book cover or title to view its author, description, collections, and recent reading history. Refresh details fetches the source page. Add private notes, Favorite, pin to Read next, follow new pages, and choose a cover or typographic jacket. Personal edits are saved explicitly.
- **Updates:** enable Follow new pages in a title's drawer, then open Updates → Check for updates. Checks run sequentially while the library tab is open, can be stopped, and report individual failures without replacing valid metadata. Rate limiting stops the batch. No scheduled background crawling runs.
- **New-page baseline:** saved titles start with their known page count as the baseline. Growth above it appears in Updates. Read new pages opens the first page beyond that baseline and resumes reading; Mark seen acknowledges the latest count without changing your reading status or bookmark. Repeated checks don't consume updates. Titles with no known count establish a baseline on their first successful count instead of claiming all pages are new.
- **Publication status:** Unknown / Still publishing / Publication complete is a separate personal label. Marking a title Finished means you finished reading; Folio does not infer that the author has stopped publishing.
- **Collections and queue:** collection names become sidebar destinations with cover mosaics. Favorites and Read next have dedicated shelves. Drag cards or use Move earlier/later controls to arrange shelves. Collection and queue orders are stored independently. Selecting a collection uses Shelf order; other sorts remain available.
- **Appearance:** Paper, Midnight, or System theme, with Comfortable or Compact shelf density. A per-title cover choice is independent of the global artwork toggle. Refresh details obtains up to eight source artwork candidates; their preview respects the artwork toggle.
- **Privacy:** Hide library conceals library titles, artwork, collection names, and the detail drawer, removes rendered cover images, and remains enabled across reloads. Reveal library restores the display. This is a display control, not encryption or a lock on stored data.
- **Continue Reading:** the lead section still displays at most three titles. View all opens the full Reading shelf.

Existing records migrate automatically to database version 2. Bookmarks, statuses, collections, and timestamps are preserved. New backup exports use format version 2 and include favorites, queue/shelf ordering, follow baselines, notes, cover choices, publication labels, and up to 50 recent reading events. Version 1 backups remain importable. Appearance preferences remain local to this browser.

Reload the unpacked extension, then reload the library and source tabs. Version 0.4.0 adds access to `https://multporn.net/*` so the library can fetch source metadata for the actions above. If the browser asks to approve that site access, enable it to use update checks and Refresh details. No other host access is requested.

## Recommendations (0.5.0)

**For you** is a special shelf in the sidebar that ranks your own library with the standalone `packages/local-recommender` package, now bundled into the library page.

- **Signals.** Every saved title is a signal. Favorites count as likes; a finished title, or one you have started, is positive feedback; a **dropped** title counts as a dismissal and is left off the shelf. Nothing is inferred from the source website, and metadata such as the title or description is never scored.
- **Tags.** Ranking is mostly tag driven, so a title's source tags are now read from its page and stored with the record when you use **Refresh details** or **Check for updates**. Titles saved before 0.5.0 carry no tags until you refresh them once; the metadata store is schemaless, so there is no migration to run, and a listing save never erases tags a refresh already found.
- **Explicit feedback.** Each card on the shelf offers **More like this** and **Less like this**. The choice reranks the shelf immediately and is kept; choosing the active one again clears it so the inferred signals apply again.
- **Explore.** The shelf's slider trades tag affinity for variety, and remembers where it was left.
- **Storage.** Preferences live in this browser's `localStorage` under `folio:recommender`. Only the slider position and your explicit choices are stored; everything else is rebuilt from the library on every visit, so changing a status can never leave a stale weight behind.
- **Backups.** Library records now export as format version 3, which adds tags. Versions 1 and 2 still import. Recommendation preferences stay on this browser and are not part of a backup, like the appearance settings.

Known limits: the recommender's novelty bonus never applies here, because every candidate is itself a library title and therefore already a known tag — Explore works through its diversity penalty and affinity damping instead. Tag extraction reads the source page's `/category/` and `/tag/` links, preferring a `field-name-field-tags` block; if that markup changes, the shelf simply has less to work with, and no other page content is stored. Scores are relative ranking values within your own library, not grades or predictions.

## Architecture

- `src/core/model.js`: validated records and versioned backup format.
- `src/core/database.js`: IndexedDB schema migrations and atomic storage operations. The `personal` store owns reading state and collections; the separate `metadata` store owns observations from the source. Metadata refresh never overwrites personal data.
- `src/core/recommender.js`: the Folio side of the local recommender. Maps library records to ranking items, rebuilds the profile from the library plus the stored explicit choices, and owns the `folio:recommender` profile store.
- `packages/local-recommender/`: the standalone, dependency-free ranking package. Bundled into `library.js`; it still knows nothing about Folio's models or database.
- `src/adapters/multporn.js`: detail-page detection, source tag extraction, and continuous-reader image mapping.
- `src/adapters/juicebox-bridge.js`: small MAIN-world bridge using the site's `window.jcgal` API. Supports only reading current/total pages and navigating to a bounded image index. It has no access to extension storage.
- `src/adapters/reader.js`: isolated-world bridge client with validated responses and request timeouts.
- `src/content.js`: isolated site companion, explicit bookmarks, and supported-reader progress.
- `src/listings.js`: isolated listing controls, bounded status lookups, and dynamic listing observation.
- `src/background.js`: service-worker message boundary. Source content scripts can access their current title or request minimal saved statuses for up to 100 explicit listing URLs at a time. They cannot export, delete, reorder, or enumerate the complete library.
- `src/ui/workspace.js`: detail drawer, collections, preferences, privacy, and manual update-check orchestration.
- `src/ui/update-checker.js`: same-host, timeout-bounded HTML fetches parsed into inert templates; redirects are rejected, and source scripts are not executed.
- `src/ui/`: full-page library. All supplied titles and collection names are rendered as text.

Schema version 1 creates both stores; version 2 migrates personal records and initializes known page-count baselines. Future schema migrations belong in `onupgradeneeded`; unknown future backup versions are rejected. Writes resolve after transaction commit. Concurrent record edits perform their read/modify/write in the same transaction. The database is still at version 2: tags are additive fields on existing metadata records, so nothing has to be migrated and older records gain them when they are next refreshed.

The extension requests host access only to `https://multporn.net/*` for source metadata checks. It requests no tabs permission or access to other sites. Its declared content scripts run only on `https://multporn.net/*`. Cover artwork loads only when the optional artwork toggle is enabled. The library remains usable offline with typographic jackets.

## Validation

```sh
npm run check
BROWSER_PATH=/usr/bin/brave npm run test:browser
```

The browser smoke tests also cover listing saves, notes and covers, update detection, cancellation/failures, queue and collection ordering, appearance, and privacy. The **For you** shelf has its own smoke test (`scripts/recommend-smoke.mjs`): it ranks a fixture library, checks the explanations and the dismissal filter, reranks through explicit feedback, and verifies that the feedback and the explore position survive a reload. The existing suites cover continuous readers, delayed Juicebox initialization, and the bookshelf UI (editing, progress, filters, optional covers, failed-image fallback, and responsive layout). The continuous-reader test loads the real built extension in a disposable profile, intercepts source requests with a non-explicit synthetic gallery, exercises saving/editing/reloading/resuming, and produces desktop/mobile screenshots in `test-results/`. It does not contact the live site. `BROWSER_PATH` can point to another compatible Chromium binary supporting unpacked extensions.

On 2026-09-26, the live technical probe verified a 43-page Juicebox title: count/title repair, saved status/collection preservation, API resume, page-change persistence, and reopening. Image, media, font, and third-party requests were blocked during the probe; this verifies the reader API workflow, not artwork rendering or every site layout. Slideshow totals come from the API rather than rendered image elements.

Run the opt-in live probe with `npm run test:live`. It creates a disposable browser profile, visits one real title, and blocks artwork and third-party resources. Normal tests remain fixture-only. The API integration follows the site's Juicebox loader and the [Juicebox API documentation](https://juicebox.net/support/api/).

## Scope and next steps

This release covers discovery, personal organization, reading, manual update checks, and ranking your own library. Legacy cache import, catalog ranking (recommending titles you have not saved yet), custom reader controls, scheduled checking, automatic backup, and synchronization remain future work. The original userscript and its tests remain available at the project root. Its count cache contains observations, not saved-library choices, so it is not silently converted into personal records.
