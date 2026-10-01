import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyDocument,
  editDocument,
  mergeDocuments,
  itemsOf,
  normalizeItem,
} from "../model.js";
import {
  seal,
  open,
  newKey,
  pairingCode,
  parsePairingCode,
} from "../crypto.js";
import { openRepository } from "../repository.js";
import { syncRepository, createPair, downloadTitle } from "../sync.js";
import { createRelay } from "../../../apps/relay/server.mjs";
import { Library, openDatabase } from "../../../extension/src/core/database.js";
import {
  syncMobile,
  shareSavedPages,
} from "../../../extension/src/portable/bridge.js";
const A = "a".repeat(32),
  B = "b".repeat(32);
const item = {
  id: "novel:observatory",
  title: "The Observatory",
  authors: ["Alex North"],
  tags: ["science fiction"],
  page: 1,
  pageCount: 3,
  status: "reading",
  notes: "",
};
const repository = () => openRepository("portable-test-" + crypto.randomUUID());
const pair = {
  version: 1,
  relay: "http://127.0.0.1:8787",
  vault: "c".repeat(32),
  token: newKey(),
  key: newKey(),
};

test("field merges converge, retain independent edits, and resolve concurrent progress deterministically", () => {
  const initial = editDocument(emptyDocument(), A, item.id, item);
  const left = editDocument(initial, A, item.id, { page: 2 });
  const right = editDocument(initial, B, item.id, {
    notes: "A good chapter",
    page: 3,
  });
  const merged = mergeDocuments(left, right);
  assert.deepEqual(merged, mergeDocuments(right, left));
  assert.equal(itemsOf(merged)[0].page, 3);
  assert.equal(itemsOf(merged)[0].notes, "A good chapter");
  assert.deepEqual(mergeDocuments(merged, merged), merged);
  assert.deepEqual(
    mergeDocuments(mergeDocuments(initial, left), right),
    merged,
  );
});
test("deletion propagates without erasing history and an explicit later edit can restore a title", () => {
  const initial = editDocument(emptyDocument(), A, item.id, item);
  const deleted = editDocument(initial, A, item.id, { deleted: true });
  assert.equal(itemsOf(mergeDocuments(initial, deleted)).length, 0);
  const restored = editDocument(deleted, B, item.id, { deleted: false });
  assert.equal(itemsOf(mergeDocuments(deleted, restored)).length, 1);
});
test("record validation rejects script URLs and invalid progress; arbitrary IDs do not affect prototypes", () => {
  assert.throws(() =>
    normalizeItem({ ...item, pages: ["javascript:alert(1)"] }),
  );
  assert.throws(() => normalizeItem({ ...item, page: -1 }));
  const doc = editDocument(emptyDocument(), A, "__proto__", {
    title: "Safe title",
  });
  assert.equal(itemsOf(doc)[0].title, "Safe title");
  assert.equal({}.title, undefined);
});
test("encrypted snapshots authenticate their contents, key and vault; pairing round-trips", async () => {
  const doc = editDocument(emptyDocument(), A, item.id, item);
  const packet = await seal(doc, pair);
  assert.deepEqual(await open(packet, pair), doc);
  assert.equal(JSON.stringify(packet).includes(item.title), false);
  assert.equal(JSON.stringify(packet).includes("science fiction"), false);
  const second = await seal(doc, pair);
  assert.notEqual(packet.iv, second.iv);
  await assert.rejects(open(packet, { ...pair, key: newKey() }));
  await assert.rejects(open(packet, { ...pair, vault: "d".repeat(32) }));
  const data =
    packet.data.slice(0, 10) +
    (packet.data[10] === "A" ? "B" : "A") +
    packet.data.slice(11);
  await assert.rejects(open({ ...packet, data }, pair));
  assert.deepEqual(parsePairingCode(pairingCode(pair)), pair);
  assert.throws(() => parsePairingCode("bad"));
});
test("local storage survives reopening, keeps page order, and removes downloads independently", async () => {
  const repo = await repository();
  await repo.edit(item.id, item);
  const blobs = [
    new Blob(["first"], { type: "image/png" }),
    new Blob(["second"], { type: "image/png" }),
  ];
  await repo.keep(item.id, blobs);
  const name = repo.db.name;
  repo.db.close();
  const reopened = await openRepository(name);
  assert.equal((await reopened.items())[0].title, item.title);
  assert.equal(await (await reopened.assets(item.id))[0].text(), "first");
  assert.equal((await reopened.downloads())[0].bytes, 11);
  await reopened.forget(item.id);
  assert.equal((await reopened.assets(item.id)).length, 0);
  assert.equal((await reopened.items()).length, 1);
  reopened.db.close();
});
test("concurrent local edits do not lose notes or reading progress", async () => {
  const repo = await repository();
  await repo.edit(item.id, item);
  await Promise.all([
    repo.edit(item.id, { notes: "Keep this" }),
    repo.edit(item.id, { page: 2 }),
  ]);
  const actual = (await repo.items())[0];
  assert.equal(actual.notes, "Keep this");
  assert.equal(actual.page, 2);
  repo.db.close();
});
test("cancelled or failed downloads keep the previous complete copy", async () => {
  const repo = await repository();
  await repo.keep(item.id, [new Blob(["original"], { type: "image/png" })]);
  const controller = new AbortController();
  const title = {
    ...item,
    pages: ["https://images.example/1", "https://images.example/2"],
  };
  let requests = 0;
  await assert.rejects(
    downloadTitle(repo, title, {
      signal: controller.signal,
      fetcher: async () => {
        requests++;
        return new Response(new Blob(["new"], { type: "image/png" }));
      },
      onProgress: () => controller.abort(),
    }),
    { name: "AbortError" },
  );
  assert.equal(requests, 1);
  assert.equal(await (await repo.assets(item.id))[0].text(), "original");
  await assert.rejects(
    downloadTitle(repo, title, {
      fetcher: async () => new Response("missing", { status: 404 }),
    }),
    /404/,
  );
  assert.equal(await (await repo.assets(item.id))[0].text(), "original");
  repo.db.close();
});
test("relay sync pairs devices, preserves concurrent edits, and stores only encrypted metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "folio-relay-test-"));
  const server = await createRelay({ dataDir: dir, port: 0 });
  const relay = "http://127.0.0.1:" + server.address().port;
  const desktop = await repository(),
    phone = await repository();
  try {
    const pairing = await createPair(relay);
    await desktop.set("pair", pairing);
    await phone.set("pair", parsePairingCode(pairingCode(pairing)));
    await desktop.edit(item.id, item);
    await syncRepository(desktop);
    await syncRepository(phone);
    assert.equal((await phone.items())[0].title, item.title);
    await phone.edit(item.id, { page: 3 });
    await desktop.edit(item.id, { notes: "From the computer" });
    await Promise.all([syncRepository(desktop), syncRepository(phone)]);
    await syncRepository(desktop);
    await syncRepository(phone);
    assert.equal((await desktop.items())[0].page, 3);
    assert.equal((await phone.items())[0].notes, "From the computer");
    const stored = await readFile(
      join(
        dir,
        (await readdir(dir)).find((v) => v.endsWith(".json")),
      ),
      "utf8",
    );
    for (const secret of [
      item.title,
      item.id,
      "From the computer",
      pairing.key,
      pairing.token,
    ])
      assert.equal(stored.includes(secret), false);
    const unauthorized = await fetch(relay + "/v1/vaults/" + pairing.vault);
    assert.equal(unauthorized.status, 401);
    const badOrigin = await fetch(relay + "/v1/vaults", {
      method: "POST",
      headers: { Origin: "https://unrelated.example" },
    });
    assert.equal(badOrigin.status, 403);
    const headers = {
      Authorization: "Bearer " + pairing.token,
      "Content-Type": "application/json",
      "If-Match": "0",
    };
    const stale = await fetch(relay + "/v1/vaults/" + pairing.vault, {
      method: "PUT",
      headers,
      body: JSON.stringify(await seal(await phone.document(), pairing)),
    });
    assert.equal(stale.status, 409);
  } finally {
    desktop.db.close();
    phone.db.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
test("extension companion sends only saved records and applies phone progress without losing library-only settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "folio-bridge-test-"));
  const server = await createRelay({ dataDir: dir, port: 0 });
  const library = new Library(
    await openDatabase("bridge-" + crypto.randomUUID()),
  );
  const repo = await openRepository();
  const phone = await repository();
  const url = "https://multporn.net/comics/portable-fixture";
  try {
    const pairing = await createPair(
      "http://127.0.0.1:" + server.address().port,
    );
    await repo.set("pair", pairing);
    await phone.set("pair", pairing);
    await library.save({ url, title: item.title, pageCount: 3 });
    await library.update(url, {
      status: "reading",
      page: 1,
      collections: ["Weekend"],
      following: true,
      notes: "Original",
    });
    await syncMobile(library);
    await syncRepository(phone);
    assert.equal((await phone.items()).length, 1);
    assert.equal((await phone.items())[0].page, 1);
    await phone.edit(url, { page: 2, notes: "From phone" });
    await syncRepository(phone);
    await syncMobile(library);
    const entry = await library.get(url);
    assert.equal(entry.personal.page, 2);
    assert.equal(entry.personal.notes, "From phone");
    assert.equal(entry.personal.following, true);
    // Hold a real relay response while the desktop user makes newer edits.
    await phone.edit(url, {
      page: 3,
      notes: "Older phone note",
      collections: ["Phone shelf"],
    });
    await syncRepository(phone);
    let release, entered;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const reached = new Promise((resolve) => {
      entered = resolve;
    });
    let held = false;
    const pending = syncMobile(library, {
      fetcher: async (url, options) => {
        const response = await fetch(url, options);
        if (!held && !options.method) {
          held = true;
          entered();
          await gate;
        }
        return response;
      },
    });
    await reached;
    await library.update(url, { page: 1, notes: "New desktop note" });
    release();
    await pending;
    const protectedEntry = await library.get(url);
    assert.equal(protectedEntry.personal.page, 1);
    assert.equal(protectedEntry.personal.notes, "New desktop note");
    assert.deepEqual(protectedEntry.personal.collections, ["Phone shelf"]);
    await syncRepository(phone);
    assert.equal((await phone.items())[0].notes, "New desktop note");
    assert.equal((await phone.items())[0].page, 1);
    await shareSavedPages(library, url, ["https://images.example/1.png"]);
    await syncMobile(library);
    await syncRepository(phone);
    assert.deepEqual((await phone.items())[0].pages, [
      "https://images.example/1.png",
    ]);
    await assert.rejects(
      shareSavedPages(library, "https://multporn.net/comics/unsaved", [
        "https://images.example/1.png",
      ]),
      /Save this title/,
    );
    await library.remove(url);
    await syncMobile(library);
    await syncRepository(phone);
    assert.equal((await phone.items()).length, 0);
  } finally {
    repo.db.close();
    phone.db.close();
    library.db.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});

test("computer sync prepares only missing saved page lists in bounded batches, isolates failures, and retries on demand", async () => {
  const dir = await mkdtemp(join(tmpdir(), "folio-pages-test-"));
  const server = await createRelay({ dataDir: dir, port: 0 });
  const library = new Library(
    await openDatabase("pages-" + crypto.randomUUID()),
  );
  const repo = await openRepository(),
    phone = await repository();
  const urls = ["observatory", "mystery", "fantasy", "programming"].map(
    (name) => "https://multporn.net/comics/neutral-" + name,
  );
  const pageUrls = [
    "https://images.example/first.png",
    "https://images.example/second.png",
  ];
  try {
    const pairing = await createPair(
      "http://127.0.0.1:" + server.address().port,
    );
    await repo.set("pair", pairing);
    await phone.set("pair", pairing);
    for (const url of urls.slice().reverse()) {
      await library.save({
        url,
        title: "Neutral book " + url.split("-").pop(),
        pageCount: 2,
      });
      await library.update(url, { notes: "Keep this note", page: 1 });
    }
    await shareSavedPages(library, urls[3], pageUrls);
    await library.observeCatalog([
      {
        url: "https://multporn.net/comics/neutral-unsaved",
        title: "An unsaved novel",
      },
    ]);
    const requested = [];
    let broken = true;
    const pageProvider = async (url) => {
      requested.push(url);
      if (url === urls[1] && broken) throw new Error("Source unavailable");
      return pageUrls;
    };
    const first = await syncMobile(library, { pageProvider });
    assert.equal(requested.length, 2, "at most two source reads per sync");
    assert.equal(first.pagesFailed, 1);
    assert.equal(first.pagesPending, 2);
    await syncRepository(phone);
    assert.equal((await phone.items()).length, 4);
    assert.equal(
      (await phone.items()).find((i) => i.id === urls[1]).notes,
      "Keep this note",
    );
    assert.deepEqual(
      (await phone.items()).find((i) => i.id === urls[3]).pages,
      pageUrls,
    );
    const remaining = urls.filter(
      (url) => url !== urls[3] && !requested.includes(url),
    );
    requested.length = 0;
    await syncMobile(library, { pageProvider });
    assert.deepEqual(
      requested,
      remaining,
      "failed titles back off; batch continues past them",
    );
    requested.length = 0;
    broken = false;
    const final = await syncMobile(library, { pageProvider, retryPages: true });
    assert.deepEqual(
      requested,
      [urls[1]],
      "manual retry does not re-fetch known pages or unsaved titles",
    );
    assert.equal(final.pagesPending, 0);
    await syncRepository(phone);
    for (const actual of await phone.items()) {
      assert.deepEqual(actual.pages, pageUrls);
      assert.equal(actual.page, 1);
      assert.equal(actual.notes, "Keep this note");
    }
  } finally {
    repo.db.close();
    phone.db.close();
    library.db.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
