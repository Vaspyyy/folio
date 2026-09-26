// ==UserScript==
// @name         Multporn Rank by Page Count
// @namespace    local.multporn-rank-by-pagecount
// @version      1.0.2
// @description  Sort multporn.net listings (tags, sections, search, sort_comics, /new, manga, uploads) by comic page count, live in the browser — finds the long, high-effort comics instead of just newest/most-viewed.
// @author       ransom
// @match        https://multporn.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* storage helpers                                                     */
  /* ------------------------------------------------------------------ */

  const LS = { counts: 'mpr:counts', listing: 'mpr:listing', settings: 'mpr:settings' };
  const DEFAULT_SETTINGS = {
    maxPages: 0,
    cacheDays: 7,
    concurrency: 6,
    sortMode: 'pages_desc',
    autoStart: true,
  };

  let storageWarning = false;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      storageWarning = true;
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      storageWarning = true;
      return false;
    }
  }

  function objectOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function nonNegativeInt(value, fallback, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(0, Math.floor(n)));
  }

  const settings = Object.assign(
    {},
    DEFAULT_SETTINGS,
    objectOrEmpty(readJson(LS.settings, {})),
  );

  function normalizeSettings() {
    settings.maxPages = nonNegativeInt(settings.maxPages, DEFAULT_SETTINGS.maxPages, 100000);
    settings.cacheDays = nonNegativeInt(settings.cacheDays, DEFAULT_SETTINGS.cacheDays, 3650);
    settings.concurrency = Math.max(1, nonNegativeInt(settings.concurrency, DEFAULT_SETTINGS.concurrency, 24));
    if (!['pages_desc', 'pages_asc', 'views_desc', 'original'].includes(settings.sortMode)) {
      settings.sortMode = DEFAULT_SETTINGS.sortMode;
    }
    settings.autoStart = settings.autoStart !== false;
    return settings;
  }

  normalizeSettings();
  const saveSettings = () => writeJson(LS.settings, settings);

  const counts = objectOrEmpty(readJson(LS.counts, {})); // url -> { p, at }
  const sessionFresh = new Set();

  // Keep localStorage bounded: drop entries older than the cache window (min 30 days),
  // and evict oldest-first when the store exceeds ~2.5 MB.
  const pruneCounts = () => {
    const now = Date.now();
    const keepMs = Math.max(30, settings.cacheDays) * 86400000;
    for (const url of Object.keys(counts)) {
      const c = counts[url];
      if (!c || !Number.isFinite(Number(c.p)) || !Number.isFinite(Number(c.at)) || c.p <= 0 || now - c.at > keepMs) {
        delete counts[url];
        sessionFresh.delete(url);
      }
    }
    const MAX = 2.5 * 1024 * 1024;
    let size = JSON.stringify(counts).length;
    if (size <= MAX) return;
    const byAge = Object.entries(counts).sort((a, b) => Number(a[1].at) - Number(b[1].at));
    for (const [url, c] of byAge) {
      if (size <= MAX) break;
      delete counts[url];
      size -= JSON.stringify({ p: c.p, at: c.at }).length + url.length + 8;
    }
  };

  const saveCounts = () => { pruneCounts(); return writeJson(LS.counts, counts); };

  const listingCache = objectOrEmpty(readJson(LS.listing, {})); // signature -> { urls, at, complete }

  function pruneListingCache() {
    const now = Date.now();
    const keepMs = Math.max(30, settings.cacheDays) * 86400000;
    for (const signature of Object.keys(listingCache)) {
      const entry = listingCache[signature];
      if (!entry || entry.complete !== true || !Array.isArray(entry.urls)
        || !Number.isFinite(Number(entry.at)) || now - entry.at > keepMs) {
        delete listingCache[signature];
      }
    }

    const MAX = 1.5 * 1024 * 1024;
    let size = JSON.stringify(listingCache).length;
    if (size <= MAX) return;
    const byAge = Object.entries(listingCache).sort((a, b) => Number(a[1].at) - Number(b[1].at));
    for (const [signature] of byAge) {
      if (size <= MAX) break;
      delete listingCache[signature];
      size = JSON.stringify(listingCache).length;
    }
  }

  function saveListing(signature, urls) {
    listingCache[signature] = { urls, at: Date.now(), complete: true };
    pruneListingCache();
    return writeJson(LS.listing, listingCache);
  }

  function freshListing(signature) {
    const entry = listingCache[signature];
    return entry && entry.complete === true && Array.isArray(entry.urls)
      && Date.now() - Number(entry.at) < settings.cacheDays * 86400000 ? entry : null;
  }

  const countFresh = (url) => {
    const c = counts[url];
    if (!c || !Number.isFinite(Number(c.p)) || !Number.isFinite(Number(c.at))) return null;
    if (sessionFresh.has(url)) return Number(c.p);
    return Date.now() - c.at < settings.cacheDays * 86400000 ? Number(c.p) : null;
  };

  /* ------------------------------------------------------------------ */
  /* small helpers                                                       */
  /* ------------------------------------------------------------------ */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const parseDoc = (html) => new DOMParser().parseFromString(html, 'text/html');

  let activeOperation = null;

  function beginOperation() {
    if (activeOperation) return null;
    activeOperation = { stopped: false, aborts: new Set() };
    return activeOperation;
  }

  function endOperation(operation) {
    if (activeOperation === operation) activeOperation = null;
  }

  function stopAll() {
    if (!activeOperation) return;
    activeOperation.stopped = true;
    activeOperation.aborts.forEach((controller) => { controller.abort(); });
    activeOperation.aborts.clear();
  }

  async function get(url, operation = null) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (operation?.stopped) throw new Error('Operation stopped');
      const ctrl = new AbortController();
      if (operation) operation.aborts.add(ctrl);
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) {
          const error = new Error('HTTP ' + res.status);
          error.retryable = res.status === 429 || res.status >= 500;
          throw error;
        }
        return await res.text();
      } catch (error) {
        lastError = error;
        const retryable = error?.retryable || error?.name === 'AbortError' || error?.name === 'TypeError';
        if (!retryable || attempt === 2 || operation?.stopped) throw error;
        await sleep(300 * (2 ** attempt) + rand(0, 200));
      } finally {
        clearTimeout(timer);
        if (operation) operation.aborts.delete(ctrl);
      }
    }
    throw lastError;
  }

  /* ------------------------------------------------------------------ */
  /* item extraction                                                     */
  /* ------------------------------------------------------------------ */

  // Comic/manga/user-upload node URLs look like /comics/<slug>, /hentai_manga/<slug>, /mp<digits>.
  // Extraction below only considers listing title/preview fields, which keeps section links out.
  function normItemUrl(href) {
    let u;
    try {
      const parsed = new URL(href, location.href);
      if (parsed.origin !== location.origin) return null;
      u = parsed.pathname.replace(/\/+$/, '');
    } catch {
      return null;
    }
    if (/^\/comics\/[^/]+$/.test(u)) return u;
    if (/^\/hentai_manga\/[^/]+$/.test(u)) return u;
    if (/^\/mp\d+$/.test(u)) return u;
    return null;
  }

  function extractItem(link) {
    const url = normItemUrl(link.getAttribute('href'));
    if (!url) return null;
    const wrapper = link.closest('li, td, tr, .masonry-item, .views-row') || link.parentElement;
    const titleEl = wrapper && wrapper.querySelector('.views-field-title a, .views-field-name a');
    const img = wrapper && wrapper.querySelector(
      '.views-field-field-preview img, .views-field-field-preview-1 img, .views-field-field-files img, img',
    );
    const viewsEl = wrapper && wrapper.querySelector('.views-field-totalcount');
    const viewText = viewsEl ? (viewsEl.textContent.match(/[\d][\d,.\s]*/) || ['0'])[0] : '0';
    const views = Number(viewText.replace(/[^\d]/g, '')) || 0;
    const title = (titleEl?.textContent || link.textContent || '').replace(/\s+/g, ' ').trim();
    const imageUrl = img ? (img.currentSrc || img.src || img.getAttribute('src') || '') : '';
    return { url, title, img: imageUrl, views };
  }

  function extractPageItems(root) {
    const seen = new Set();
    const items = [];
    const selector = [
      '.views-field-title a[href]',
      '.views-field-field-preview a[href]',
      '.views-field-field-preview-1 a[href]',
      '.views-field-field-files a[href]',
    ].join(', ');
    for (const link of root.querySelectorAll(selector)) {
      const it = extractItem(link);
      if (it && !seen.has(it.url)) { seen.add(it.url); items.push(it); }
    }
    return items;
  }

  /* ------------------------------------------------------------------ */
  /* pagination                                                          */
  /* ------------------------------------------------------------------ */

  // Learn the pager URL format from the links on the current page.
  // Tag pages use `page=0,N` (1-based N), search uses plain `page=N`.
  function learnPagerFormat(doc) {
    let best = null;
    let bestN = 0;
    for (const a of doc.querySelectorAll('a[href*="page="]')) {
      try {
        const pageUrl = new URL(a.getAttribute('href'), location.href);
        if (pageUrl.origin !== location.origin || pageUrl.pathname !== location.pathname) continue;
        const value = pageUrl.searchParams.get('page');
        const n = value === null ? NaN : Number(value.split(',').pop());
        if (Number.isInteger(n) && n >= 0 && n > bestN) best = { value, maxPage: n };
        if (Number.isInteger(n) && n > bestN) bestN = n;
      } catch {
        // Ignore malformed or cross-origin pager links.
      }
    }
    return best;
  }

  function buildPageUrl(pageNum, format) {
    const q = new URLSearchParams(location.search);
    q.delete('page');
    if (format) q.set('page', format.value.replace(/\d+$/, String(pageNum)));
    else q.set('page', String(pageNum));
    const qs = q.toString();
    return location.pathname + (qs ? '?' + qs : '');
  }

  function currentPageNumber(format) {
    if (!format) return 0;
    const value = new URLSearchParams(location.search).get('page');
    if (value === null) return 0;
    const n = Number(value.split(',').pop());
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  function listingSignature() {
    const q = new URLSearchParams(location.search);
    q.delete('page');
    q.sort();
    const query = q.toString();
    return location.pathname + (query ? '?' + query : '');
  }

  /* ------------------------------------------------------------------ */
  /* scan + count                                                        */
  /* ------------------------------------------------------------------ */

  async function scanListing(container, onProgress, operation) {
    const format = learnPagerFormat(document);
    const items = extractPageItems(container);
    const all = new Map(items.map((i) => [i.url, i]));
    if (!format) {
      // no pager on this page (e.g. search results): single page listing
      const sig = listingSignature();
      saveListing(sig, [...all.values()]);
      return { urls: [...all.values()], complete: true };
    }
    const total = format.maxPage + 1;
    const currentPage = currentPageNumber(format);
    const pageLimit = settings.maxPages > 0 ? Math.min(total, settings.maxPages) : total;
    let complete = settings.maxPages === 0;
    let failedPages = 0;
    let pagesScanned = 0;
    for (let page = 0; page < pageLimit; page++) {
      if (operation?.stopped) { complete = false; break; }
      pagesScanned++;
      if (page === currentPage) {
        onProgress(page + 1, total, all.size);
        continue;
      }
      await sleep(rand(60, 160));
      if (operation?.stopped) { complete = false; break; }
      let html;
      try {
        html = await get(buildPageUrl(page, format), operation);
      } catch {
        complete = false;
        failedPages++;
        if (failedPages >= 3) break;
        continue;
      }
      const doc = parseDoc(html);
      const found = extractPageItems(doc);
      for (const it of found) {
        if (!all.has(it.url)) all.set(it.url, it);
      }
      onProgress(page + 1, total, all.size);
      if (found.length === 0) {
        if (page < total - 1) complete = false;
        break;
      }
    }
    const urls = [...all.values()];
    const wasStopped = operation?.stopped === true;
    complete = complete && !wasStopped && failedPages === 0;
    if (complete && settings.maxPages === 0) saveListing(listingSignature(), urls);
    return { urls, complete, pagesScanned };
  }

  function countGalleryPages(doc) {
    const gallery = doc.querySelector('.juicebox-container, #juicebox-container, .pages--full');
    if (gallery) {
      const imgs = gallery.querySelectorAll('img[src*="juicebox_medium"], img');
      if (imgs.length) return imgs.length;
    }
    return doc.querySelectorAll('img[src*="juicebox_medium"], .pages--full img').length;
  }

  function normalizeUrls(entries) {
    return entries.map((entry) => (typeof entry === 'string' ? entry : entry?.url)).filter(Boolean);
  }

  async function countPages(urls, onProgress, operation) {
    const normalizedUrls = normalizeUrls(urls);
    const pending = normalizedUrls.filter((url) => countFresh(url) === null);
    let done = 0;
    let invalid = 0;
    let failed = 0;
    let dirty = 0;
    let lastSave = Date.now();
    const total = pending.length;
    let cursor = 0;
    const workers = Array.from({ length: settings.concurrency }, async () => {
      while (!operation?.stopped) {
        const url = pending[cursor++];
        if (url === undefined) return;
        await sleep(rand(40, 140));
        if (operation?.stopped) return;
        try {
          const doc = parseDoc(await get(url, operation));
          const p = countGalleryPages(doc);
          if (p > 0) {
            counts[url] = { p, at: Date.now() };
            sessionFresh.add(url);
            dirty++;
          }
          else {
            delete counts[url]; // section page / non-comic: exclude from ranking
            sessionFresh.delete(url);
            invalid++;
          }
        } catch {
          failed++;
        }
        done++;
        if (dirty >= 25 || Date.now() - lastSave >= 5000) {
          saveCounts();
          dirty = 0;
          lastSave = Date.now();
        }
        if (!operation?.stopped) onProgress(done, total);
      }
    });
    await Promise.all(workers);
    saveCounts();
    return { total, done, invalid, failed };
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */

  const css = `
    .mpr-panel{position:fixed;right:12px;bottom:12px;z-index:2147483000;width:300px;font:13px/1.4 system-ui,sans-serif;
      background:#161616;color:#eee;border:1px solid #3a3a3a;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.6);overflow:hidden}
    .mpr-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#202020;cursor:pointer;user-select:none}
    .mpr-head b{font-size:13px}
    .mpr-body{padding:10px}
    .mpr-status{margin-bottom:6px;color:#bbb;min-height:18px}
    .mpr-bar{height:6px;background:#333;border-radius:3px;overflow:hidden;margin-bottom:10px}
    .mpr-bar > div{height:100%;width:0;background:#4caf50;transition:width .3s}
    .mpr-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
    .mpr-row label{flex:0 0 90px;color:#999}
    .mpr-row select,.mpr-row input{flex:1;background:#222;color:#eee;border:1px solid #444;border-radius:4px;padding:3px 6px}
    .mpr-btns{display:flex;gap:6px}
    .mpr-btns button{flex:1;background:#333;color:#eee;border:1px solid #555;border-radius:4px;padding:5px 0;cursor:pointer}
    .mpr-btns button:hover{background:#444}
    .mpr-btns button.primary{background:#4caf50;border-color:#4caf50}
    .mpr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;padding:12px}
    .mpr-card{position:relative;background:#181818;border:1px solid #2c2c2c;border-radius:6px;overflow:hidden;display:flex;flex-direction:column}
    .mpr-card img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#111}
    .mpr-card .mpr-badge{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.75);color:#7CFC9A;font-weight:700;font-size:12px;
      padding:2px 7px;border-radius:10px;border:1px solid #4caf50}
    .mpr-card .mpr-title{padding:6px 8px;font-size:12px;line-height:1.3;color:#eee;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:34px}
    .mpr-card .mpr-views{padding:0 8px 8px;font-size:11px;color:#888}
    .mpr-card a{text-decoration:none;color:inherit}
    .mpr-hint{position:fixed;right:12px;bottom:12px;z-index:2147483000;background:#161616;color:#eee;border:1px solid #3a3a3a;
      border-radius:8px;padding:8px 12px;font:13px system-ui,sans-serif;cursor:pointer}
  `;

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  let panel, statusEl, barEl, sortSel, maxPagesInput, cacheInput, startBtn, stopBtn, refreshBtn;
  let container = null;       // the .view-content being replaced
  let originalHTML = '';      // original listing markup, restored in "original" mode
  let items = [];             // [{url, img, views, pages, valid}]
  let renderTimer = null;

  function buildToolbar() {
    const style = el('style', {}, css);
    document.head.appendChild(style);

    panel = el('div', { class: 'mpr-panel' });
    const head = el('div', { class: 'mpr-head' });
    head.appendChild(el('b', {}, '📏 Rank by pages'));
    const collapse = el('span', {}, '—');
    collapse.style.color = '#888';
    head.appendChild(collapse);
    const body = el('div', { class: 'mpr-body' });

    statusEl = el('div', { class: 'mpr-status' }, 'Ready.');
    const bar = el('div', { class: 'mpr-bar' });
    barEl = el('div');
    bar.appendChild(barEl);

    const sortRow = el('div', { class: 'mpr-row' });
    sortRow.appendChild(el('label', {}, 'Sort'));
    sortSel = el('select');
    for (const [v, label] of [
      ['pages_desc', 'Pages ↓ (high to low)'],
      ['pages_asc', 'Pages ↑'],
      ['views_desc', 'Views ↓'],
      ['original', 'Original order'],
    ]) {
      const opt = el('option', { value: v }, label);
      if (v === settings.sortMode) opt.selected = true;
      sortSel.appendChild(opt);
    }
    sortRow.appendChild(sortSel);

    const setRow = el('div', { class: 'mpr-row' });
    setRow.appendChild(el('label', {}, 'Scan pages'));
    maxPagesInput = el('input', { type: 'number', min: '0', value: String(settings.maxPages), title: '0 = all pages of this listing' });
    setRow.appendChild(maxPagesInput);
    const cacheRow = el('div', { class: 'mpr-row' });
    cacheRow.appendChild(el('label', {}, 'Cache days'));
    cacheInput = el('input', { type: 'number', min: '0', value: String(settings.cacheDays), title: 'Reuse saved page counts for this many days' });
    cacheRow.appendChild(cacheInput);

    const btns = el('div', { class: 'mpr-btns' });
    startBtn = el('button', { class: 'primary' }, '▶ Start / resume');
    stopBtn = el('button', {}, '■ Stop');
    refreshBtn = el('button', {}, '↻ Refresh');
    btns.append(startBtn, stopBtn, refreshBtn);

    body.append(statusEl, bar, sortRow, setRow, cacheRow, btns);
    panel.append(head, body);
    document.body.appendChild(panel);

    let open = true;
    collapse.onclick = () => {
      open = !open;
      body.style.display = open ? '' : 'none';
      collapse.textContent = open ? '—' : '▲';
    };
    head.onclick = (e) => { if (e.target !== collapse) collapse.onclick(); };

    sortSel.onchange = () => { settings.sortMode = sortSel.value; saveSettings(); renderGrid(); };
    maxPagesInput.onchange = () => {
      settings.maxPages = nonNegativeInt(maxPagesInput.value, DEFAULT_SETTINGS.maxPages, 100000);
      maxPagesInput.value = String(settings.maxPages);
      saveSettings();
    };
    cacheInput.onchange = () => {
      settings.cacheDays = nonNegativeInt(cacheInput.value, DEFAULT_SETTINGS.cacheDays, 3650);
      cacheInput.value = String(settings.cacheDays);
      saveSettings();
    };
    startBtn.onclick = () => run();
    stopBtn.onclick = () => {
      if (!activeOperation) return;
      stopAll();
      setStatus('Stopping…');
    };
    refreshBtn.onclick = async () => {
      if (!items.length || activeOperation) return;
      const operation = beginOperation();
      if (!operation) return;
      try {
        for (const it of items) delete counts[it.url];
        saveCounts();
        setStatus('Refreshing page counts…');
        const result = await countPages(items.map((i) => i.url), countProgress, operation);
        if (operation.stopped) { setStatus('Stopped.'); return; }
        applyCounts();
        renderGrid();
        setStatus(result.failed ? `Done, but ${fmt(result.failed)} counts could not be fetched.` : 'Done.');
      } catch (error) {
        setStatus(`Refresh failed: ${error?.message || 'unknown error'}`);
      } finally {
        endOperation(operation);
      }
    };
  }

  function setStatus(text) { statusEl.textContent = text; }
  function setBar(pct) { barEl.style.width = Math.max(0, Math.min(100, pct)) + '%'; }

  function scanProgress(page, total, found) {
    const t = total > 1 ? ` / ~${total}` : '';
    setStatus(`Scanning listing pages… ${page}${t} · ${fmt(found)} comics`);
    setBar(total > 1 ? (page / total) * 50 : 50);
  }

  function countProgress(done, total) {
    setStatus(`Fetching page counts… ${fmt(done)} / ${fmt(total)}`);
    setBar(50 + (total ? (done / total) * 50 : 0));
    scheduleProgressiveRender();
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                           */
  /* ------------------------------------------------------------------ */

  function applyCounts() {
    for (const it of items) {
      it.pages = countFresh(it.url);
      it.valid = it.pages !== null && it.pages > 0;
    }
  }

  function sortedItems() {
    const mode = settings.sortMode;
    if (mode === 'original') return items.map((i, idx) => ({ ...i, _idx: idx })).filter((i) => i.valid)
      .sort((a, b) => a._idx - b._idx);
    const valid = items.filter((i) => i.valid);
    if (mode === 'views_desc') return valid.sort((a, b) => b.views - a.views);
    if (mode === 'pages_asc') return valid.sort((a, b) => a.pages - b.pages || b.views - a.views);
    return valid.sort((a, b) => b.pages - a.pages || b.views - a.views);
  }

  function renderGrid() {
    if (!container) return;
    if (settings.sortMode === 'original') {
      container.innerHTML = originalHTML;
      return;
    }
    const grid = el('div', { class: 'mpr-grid' });
    for (const it of sortedItems()) {
      const card = el('div', { class: 'mpr-card' });
      const link = el('a', { href: it.url, target: '_self' });
      if (it.img) {
        link.appendChild(el('img', {
          src: it.img,
          loading: 'lazy',
          alt: it.title || it.url.split('/').pop().replace(/_/g, ' '),
        }));
      }
      const body = el('div');
      body.appendChild(el('div', { class: 'mpr-title' }, (it.title || it.url.split('/').pop()).replace(/_/g, ' ')));
      if (it.views > 0) body.appendChild(el('div', { class: 'mpr-views' }, `${fmt(it.views)} views`));
      link.appendChild(body);
      card.appendChild(link);
      card.appendChild(el('div', { class: 'mpr-badge' }, `${it.pages} p`));
      grid.appendChild(card);
    }
    if (!grid.children.length) {
      const sig = listingSignature();
      const cached = freshListing(sig);
      if (cached && cached.urls.length > 0) {
        grid.appendChild(el('div', { class: 'mpr-title' }, 'No comics with page counts found. This looks like a section browser (franchise list) — open a tag (e.g. /category/furry), section, search or /sort_comics page to rank comics.'));
      } else {
        grid.appendChild(el('div', { class: 'mpr-title' }, 'No results yet — start the scan.'));
      }
    }
    container.innerHTML = '';
    container.appendChild(grid);
  }

  /* ------------------------------------------------------------------ */
  /* pipeline                                                            */
  /* ------------------------------------------------------------------ */

  async function run() {
    if (!container || activeOperation) return;
    const operation = beginOperation();
    if (!operation) return;
    startBtn.textContent = '…';
    try {
      const sig = listingSignature();
      let urls;
      let scanComplete = true;

      const format = learnPagerFormat(document);
      if (format && format.maxPage > 300) {
        setStatus(`Large listing (~${fmt(format.maxPage + 1)} pages) — this can take a while. Limit scan depth in settings if needed.`);
      }

      const cached = settings.maxPages === 0 ? freshListing(sig) : null;
      if (cached) {
        urls = cached.urls;
        setStatus(`Using cached listing (${fmt(urls.length)} comics)`);
      } else {
        const scan = await scanListing(container, scanProgress, operation);
        urls = scan.urls;
        scanComplete = scan.complete;
        if (operation.stopped) { setStatus('Stopped.'); return; }
      }

      items = urls.map((it) => ({
        ...it,
        title: it.title || it.url.split('/').pop(),
        pages: null,
        valid: false,
      }));
      applyCounts();
      renderGrid();

      let countResult = { failed: 0 };
      const missing = items.filter((i) => countFresh(i.url) === null).length;
      if (missing > 0) {
        countResult = await countPages(urls.map((item) => item.url), countProgress, operation);
        if (operation.stopped) { setStatus('Stopped.'); return; }
        applyCounts();
      }
      renderGrid();
      const ranked = items.filter((i) => i.valid).length;
      if (!ranked) {
        setStatus('No comics found on this page — it looks like a section browser. Use a tag (e.g. /category/furry), search or /sort_comics instead.');
      } else {
        const parts = [`Done — ${fmt(ranked)} comics ranked by page count.`];
        if (!scanComplete) parts.push('Listing scan incomplete; set Scan pages to 0 and run again for the full listing.');
        if (countResult.failed) parts.push(`${fmt(countResult.failed)} counts unavailable.`);
        if (storageWarning) parts.push('Browser storage could not be fully updated.');
        setStatus(parts.join(' '));
      }
    } catch (error) {
      setStatus(operation.stopped ? 'Stopped.' : `Scan failed: ${error?.message || 'unknown error'}`);
    } finally {
      endOperation(operation);
      startBtn.textContent = '▶ Start / resume';
    }
  }

  function scheduleProgressiveRender() {
    if (renderTimer) return;
    // On very large listings progressive re-renders are too heavy — render once at the end.
    if (items.length > 8000) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      applyCounts();
      if (settings.sortMode !== 'original') renderGrid();
    }, 2500);
  }

  /* ------------------------------------------------------------------ */
  /* detail page badge                                                   */
  /* ------------------------------------------------------------------ */

  async function detailBadge() {
    const m = location.pathname.match(/^\/(comics|hentai_manga)\/([^/]+)$|^\/mp\d+$/);
    if (!m) return;
    const url = location.pathname;
    const h1 = document.querySelector('h1');
    if (!h1) return;
    let pages = countFresh(url);
    if (pages === null) {
      try { pages = countGalleryPages(parseDoc(await get(url))); } catch { return; }
      if (pages > 0) {
        counts[url] = { p: pages, at: Date.now() };
        sessionFresh.add(url);
        saveCounts();
      }
    }
    if (!pages) return;
    const badge = el('span', { style: 'margin-left:10px;font-size:13px;color:#7CFC9A;border:1px solid #4caf50;border-radius:10px;padding:1px 8px;vertical-align:middle' }, `${fmt(pages)} pages`);
    h1.appendChild(badge);
  }

  /* ------------------------------------------------------------------ */
  /* entry                                                               */
  /* ------------------------------------------------------------------ */

  function main() {
    // Detail page? (a gallery is present) -> badge only.
    const itemPath = /^\/(?:comics|hentai_manga)\/[^/]+$|^\/mp\d+$/.test(location.pathname);
    const hasGallery = document.querySelector('.juicebox-container, #juicebox-container, .pages--full, img[src*="juicebox_medium"]');
    if (hasGallery || (itemPath && document.querySelector('article.node-full'))) {
      detailBadge();
      return;
    }

    // Listing page? Find the main .view-content that holds comic links.
    const views = [...document.querySelectorAll('.view-content')];
    container = views.find((v) => extractPageItems(v).length >= 2) || null;
    if (!container) return;

    originalHTML = container.innerHTML;
    buildToolbar();
    if (settings.autoStart) run();
  }

  const testApi = {
    normalizeSettings,
    normItemUrl,
    extractPageItems,
    learnPagerFormat,
    buildPageUrl,
    currentPageNumber,
    listingSignature,
    normalizeUrls,
    countGalleryPages,
    countPages,
  };

  if (globalThis.__MPR_PAGECOUNT_TEST__) {
    globalThis.__MPR_PAGECOUNT_TEST__.api = testApi;
    return;
  }

  main();
})();
