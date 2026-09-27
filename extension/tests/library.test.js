import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { JSDOM } from "jsdom";
import { Library, openDatabase } from "../src/core/database.js";
import { canonicalUrl } from "../src/core/model.js";
import {
  detectTitle,
  pageTags,
  readingImages,
} from "../src/adapters/multporn.js";
const title = {
  url: "https://multporn.net/comics/fixture",
  title: "Fixture story",
  pageCount: 12,
};
const library = async () =>
  new Library(await openDatabase(crypto.randomUUID()));
test("save, update, revisit and reopen preserve personal records independently of metadata", async () => {
  const db = await library();
  await db.save(title);
  await db.update(title.url, {
    status: "finished",
    page: 12,
    collections: ["Favorites"],
  });
  await db.save({ ...title, title: "Renamed story", pageCount: 15 });
  await db.save({ ...title, pageCount: null });
  const name = db.db.name;
  db.db.close();
  const reopened = new Library(await openDatabase(name));
  const entry = await reopened.get(title.url);
  assert.equal(entry.metadata.pageCount, 15);
  assert.equal(entry.personal.page, 12);
  assert.equal(entry.personal.status, "finished");
  assert.deepEqual(entry.personal.collections, ["Favorites"]);
});
test("concurrent edits do not lose independent personal fields", async () => {
  const db = await library();
  await db.save(title);
  await Promise.all([
    db.update(title.url, { page: 7 }),
    db.update(title.url, { collections: ["Weekend"] }),
  ]);
  const entry = await db.get(title.url);
  assert.equal(entry.personal.page, 7);
  assert.deepEqual(entry.personal.collections, ["Weekend"]);
});
test("backup round trip merges without overwriting current records", async () => {
  const source = await library();
  await source.save(title);
  await source.update(title.url, { page: 8 });
  const backup = await source.export();
  const dest = await library();
  assert.equal(await dest.import(backup), 1);
  assert.equal((await dest.get(title.url)).personal.page, 8);
  await dest.update(title.url, { page: 10 });
  assert.equal(await dest.import(backup), 0);
  assert.equal((await dest.get(title.url)).personal.page, 10);
});
test("invalid backup is rejected atomically and unsafe URLs never enter storage", async () => {
  const db = await library();
  await assert.rejects(
    db.import({
      format: "folio-library",
      version: 1,
      entries: [
        { metadata: title, personal: {} },
        { metadata: { ...title, url: "javascript:alert(1)" }, personal: {} },
      ],
    }),
  );
  assert.equal((await db.list()).length, 0);
  await assert.rejects(
    db.import({ format: "folio-library", version: 99, entries: [] }),
  );
  assert.throws(() => canonicalUrl("https://evil.example/comics/story"));
  await db.save(title);
  await assert.rejects(db.update(title.url, { page: -1 }));
  assert.equal((await db.get(title.url)).personal.page, 0);
});
test("adapter distinguishes continuous, slideshow and unsupported pages", () => {
  const doc = new JSDOM(
    '<h1>Fixture</h1><div class="pages--full"><img src="1.jpg"><img src="2.jpg"></div>',
  ).window.document;
  assert.equal(detectTitle(doc, title.url).pageCount, 2);
  assert.equal(readingImages(doc).length, 2);
  const slideshow = new JSDOM(
    '<h1>Fixture</h1><div id="juicebox-container"><img src="1.jpg"></div>',
  ).window.document;
  assert.equal(readingImages(slideshow).length, 0);
  assert.equal(detectTitle(doc, "https://multporn.net/category/test"), null);
  assert.equal(
    detectTitle(new JSDOM("<h1>Section</h1>").window.document, title.url),
    null,
  );
});
test("remove deletes both metadata and personal record", async () => {
  const db = await library();
  await db.save(title);
  await db.remove(title.url);
  assert.equal(await db.get(title.url), null);
  assert.equal((await db.export()).entries.length, 0);
});

test("metadata ignores legacy badges without stripping genuine title text", () => {
  const doc = new JSDOM(
    '<h1>Chapter 43 pages<span style="color:green">43 pages</span></h1><div class="juicebox-container"><img><img><img></div>',
  ).window.document;
  const result = detectTitle(doc, title.url);
  assert.equal(result.title, "Chapter 43 pages");
  assert.equal(
    result.pageCount,
    null,
    "rendered slideshow images are not the total",
  );
});
test("reader repair and automatic progress preserve finished status and collections", async () => {
  const db = await library();
  await db.save({ ...title, title: "Fixture story 12 pages", pageCount: null });
  await db.update(title.url, {
    page: 12,
    status: "finished",
    collections: ["Keep"],
  });
  await db.save(title);
  await db.progress(title.url, 1, true);
  let entry = await db.get(title.url);
  assert.equal(entry.metadata.title, "Fixture story");
  assert.equal(entry.metadata.pageCount, 12);
  assert.equal(entry.personal.page, 12);
  assert.equal(entry.personal.status, "finished");
  assert.deepEqual(entry.personal.collections, ["Keep"]);
  await db.progress(title.url, 3, false);
  entry = await db.get(title.url);
  assert.equal(entry.personal.page, 3);
  assert.equal(entry.personal.status, "reading");
});

test("cover metadata is restricted to source artwork and survives backup and metadata refresh", async () => {
  const { coverUrl } = await import("../src/core/model.js");
  assert.equal(coverUrl("javascript:alert(1)"), null);
  assert.equal(coverUrl("https://tracker.example/cover.png"), null);
  assert.equal(coverUrl("https://multporn.net/account"), null);
  const url = "https://multporn.net/sites/default/files/cover.jpg";
  const doc = new JSDOM(
    `<meta property="og:image" content="${url}"><h1>Fixture</h1><div class="juicebox-container"></div>`,
  ).window.document;
  assert.equal(detectTitle(doc, title.url).coverUrl, url);
  const db = await library();
  await db.save({ ...title, coverUrl: url });
  await db.save(title);
  assert.equal((await db.get(title.url)).metadata.coverUrl, url);
  const other = await library();
  await other.import(await db.export());
  assert.equal((await other.get(title.url)).metadata.coverUrl, url);
});
test("presentation handles unknown lengths, finished titles and out-of-range bookmarks", async () => {
  const { readingProgress, continueReading } =
    await import("../src/ui/presentation.js");
  const entry = (status, page, total, updatedAt = 1) => ({
    metadata: { pageCount: total },
    personal: { status, page, updatedAt },
  });
  assert.deepEqual(readingProgress(entry("reading", 20, null)), {
    percent: null,
    label: "Page 20 · total unknown",
  });
  assert.equal(readingProgress(entry("finished", 0, 50)).percent, 100);
  assert.equal(readingProgress(entry("reading", 60, 50)).percent, 100);
  const items = [
    entry("finished", 20, 20, 99),
    entry("reading", 0, 50, 2),
    entry("reading", 5, 50, 4),
    entry("planned", 0, 10, 3),
  ];
  assert.deepEqual(continueReading(items), [items[2], items[1]]);
});

test("v1 database migration preserves records and initializes update baselines", async () => {
  const name = crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("metadata", { keyPath: "id" });
      request.result.createObjectStore("personal", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction(["metadata", "personal"], "readwrite");
      tx.objectStore("metadata").put({ ...title, id: title.url });
      tx.objectStore("personal").put({
        id: title.url,
        status: "finished",
        page: 12,
        collections: ["Keep"],
        updatedAt: 123,
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
    request.onerror = () => reject(request.error);
  });
  const db = new Library(await openDatabase(name));
  const entry = await db.get(title.url);
  assert.equal(db.db.version, 2);
  assert.equal(entry.personal.acknowledgedCount, 12);
  assert.equal(entry.personal.status, "finished");
  assert.equal(entry.personal.updatedAt, 123);
  assert.deepEqual(entry.personal.collections, ["Keep"]);
});
test("new pages survive checks and notes edits, acknowledge separately from reading status", async () => {
  const { newPages } = await import("../src/core/model.js");
  const db = await library();
  await db.save(title);
  await db.update(title.url, {
    status: "finished",
    following: true,
    publication: "ongoing",
  });
  await db.save({ ...title, pageCount: 17 });
  let entry = await db.get(title.url);
  assert.equal(newPages(entry), 5);
  assert.equal(entry.personal.status, "finished");
  assert.equal(entry.personal.publication, "ongoing");
  await db.update(title.url, {
    status: "finished",
    collections: ["New shelf"],
  });
  assert.equal(newPages(await db.get(title.url)), 5);
  await db.save({ ...title, pageCount: 17 });
  assert.equal(newPages(await db.get(title.url)), 5);
  await db.progress(title.url, 13, false);
  assert.equal(newPages(await db.get(title.url)), 4);
  await db.acknowledge(title.url);
  entry = await db.get(title.url);
  assert.equal(newPages(entry), 0);
  assert.equal(entry.personal.page, 13);
  assert.equal(entry.personal.status, "reading");
  await db.remove(title.url);
  await assert.rejects(db.save(title, true));
  assert.equal(await db.get(title.url), null);
});
test("personal extras, history, collection order and queue order survive backup", async () => {
  const db = await library();
  await db.save(title);
  const second = { ...title, url: "https://multporn.net/comics/second" };
  await db.save(second);
  await db.update(title.url, {
    favorite: true,
    queued: true,
    following: true,
    notes: "Keep this note",
    publication: "complete",
    coverChoice: "jacket",
  });
  await db.progress(title.url, 5);
  await db.reorder([second.url, title.url], "queue");
  await db.reorder([title.url, second.url], "collection:Keep");
  await assert.rejects(db.reorder([title.url, title.url], "queue"));
  const other = await library();
  await other.import(await db.export());
  const entry = await other.get(title.url);
  assert.equal(entry.personal.notes, "Keep this note");
  assert.equal(entry.personal.favorite, true);
  assert.equal(entry.personal.queued, true);
  assert.equal(entry.personal.orders.queue, 1);
  assert.equal(entry.personal.orders["collection:Keep"], 0);
  assert.equal(entry.personal.history.at(-1).page, 5);
  assert.equal(entry.personal.coverChoice, "jacket");
  const legacy = await library();
  assert.equal(
    await legacy.import({
      format: "folio-library",
      version: 1,
      entries: [
        { metadata: title, personal: { status: "finished", page: 12 } },
      ],
    }),
    1,
  );
  assert.equal((await legacy.get(title.url)).personal.acknowledgedCount, 12);
});
test("source tags are read conservatively from a title page", () => {
  const field = new JSDOM(
    '<h1>Fixture</h1><div class="juicebox-container"></div><div class="field-name-field-tags"><a href="/category/Furry">Furry</a><a href="/category/furry">furry</a><a href="/tag/Deep_Space">Deep Space</a><a href="/comics/other-title">Another story</a><span class="field-item">Unlinked term</span></div>',
  ).window.document;
  assert.deepEqual(pageTags(field), ["Furry", "Deep Space", "Unlinked term"]);
  assert.deepEqual(detectTitle(field, title.url).tags, [
    "Furry",
    "Deep Space",
    "Unlinked term",
  ]);
  // Without a recognized field, taxonomy links are not title metadata.
  const bare = new JSDOM(
    '<h1>Fixture</h1><div class="juicebox-container"></div><nav><a href="/new">New</a><a href="/comics/other-title">Another story</a></nav><a href="/category/Old_Guard">Old Guard</a>',
  ).window.document;
  assert.deepEqual(pageTags(bare), []);
  // A link with no usable text falls back to its own term.
  const wordless = new JSDOM(
    '<div class="field-name-field-tags"><a href="/category/Deep_Space"></a></div>',
  ).window.document;
  assert.deepEqual(pageTags(wordless), ["Deep Space"]);
  assert.deepEqual(pageTags(new JSDOM("<p>Nothing</p>").window.document), []);
});
test("tag metadata excludes navigation, related content, and title-link wrappers", () => {
  const doc = new JSDOM(`
    <nav><a href="/category/fantasy">Fantasy</a></nav>
    <aside class="field-name-field-tags"><a href="/category/mystery">Mystery</a></aside>
    <article><h1>Programming Essentials</h1><div class="juicebox-container"></div>
      <div class="field-name-field-tags">
        <div class="field-item"><a href="/comics/unrelated">Unrelated Title</a></div>
        <div class="field-item"><a href="/category/science">Science</a></div>
        <div class="field-item"><a href="https://other.example/category/false">External</a></div>
        <a href="/search?next=/category/wrong">Search</a>
        <div class="field-item"><a href="/category/%ZZ">Malformed</a></div>
        <span class="field-item">Education</span>
      </div>
      <div class="related"><div class="field-name-field-tags"><a href="/category/romance">Romance</a></div></div>
    </article>
    <article><div class="field-name-field-tags"><a href="/category/history">History</a></div></article>
  `).window.document;
  assert.deepEqual(pageTags(doc), ["Science", "Education"]);
  const unknown = new JSDOM(
    '<nav><a href="/category/fantasy">Fantasy</a><a href="/category/mystery">Mystery</a></nav><article><h1>Programming Essentials</h1></article>',
  ).window.document;
  assert.deepEqual(pageTags(unknown), []);
});

test("tags are validated, capped, preserved on listing saves and included in backups", async () => {
  const { metadata } = await import("../src/core/model.js");
  const tags = Array.from({ length: 45 }, (_, i) => ` tag ${i} `);
  assert.equal(metadata({ ...title, tags }).tags.length, 40);
  assert.equal(metadata({ ...title, tags }).tags[0], "tag 0");
  assert.deepEqual(
    metadata({ ...title, tags: ["  Space  ", "Space", "", 7, "x".repeat(200)] })
      .tags,
    ["Space", "x".repeat(80)],
  );
  const db = await library();
  await db.save({ ...title, tags: ["Furry", "Space"] });
  await db.save(title); // A listing save carries no tags and must not erase them.
  assert.deepEqual((await db.get(title.url)).metadata.tags, ["Furry", "Space"]);
  const backup = await db.export();
  assert.equal(backup.version, 3);
  const other = await library();
  await other.import(backup);
  assert.deepEqual((await other.get(title.url)).metadata.tags, [
    "Furry",
    "Space",
  ]);
  const legacy = await library();
  assert.equal(
    await legacy.import({
      ...backup,
      version: 2,
      entries: [{ metadata: { ...title }, personal: {} }],
    }),
    1,
    "a version 2 backup without tags still imports",
  );
  assert.deepEqual((await legacy.get(title.url)).metadata.tags, []);
});
