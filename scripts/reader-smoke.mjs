import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const live = process.argv.includes("--live");
const profile = await mkdtemp(join(tmpdir(), "folio-reader-"));
const extension = resolve("dist");
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.BROWSER_PATH || "/usr/bin/brave",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
async function until(read, predicate, description) {
  for (let i = 0; i < 120; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
try {
  const url = live
    ? "https://multporn.net/comics/funny_bunny"
    : "https://multporn.net/comics/fixture";
  // Never load artwork or third-party trackers during the live technical probe.
  await context.route("**/*", (route) => {
    const req = route.request();
    if (req.url().startsWith("chrome-extension://")) return route.continue();
    if (live) {
      if (
        new URL(req.url()).hostname !== "multporn.net" ||
        ["image", "media", "font"].includes(req.resourceType())
      )
        return route.abort();
      return route.continue();
    }
    if (req.isNavigationRequest())
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>Reader fixture</title><h1>Fixture title<span>43 pages</span></h1><div class="juicebox-container"></div><script>
      setTimeout(()=>{let index=1;window.jcgal={getImageCount:()=>43,getImageIndex:()=>index,showImage:page=>setTimeout(()=>index=page,80)}},1200);
    </script>`,
      });
    return route.abort();
  });
  let worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const library = await context.newPage();
  await library.goto(`chrome-extension://${id}/library.html`);
  const send = (type, payload = {}) =>
    library.evaluate(
      async ({ type, payload }) => {
        const response = await chrome.runtime.sendMessage({ type, ...payload });
        if (!response.ok) throw new Error(response.error);
        return response.value;
      },
      { type, payload },
    );
  await send("save", {
    metadata: { url, title: "Old title 43 pages", pageCount: null },
  });
  await send("update", {
    url,
    patch: { page: 12, status: "finished", collections: ["Favorites"] },
  });
  const reader = await context.newPage();
  await reader.goto(url + "#folio-page=12", { waitUntil: "domcontentloaded" });
  await reader.locator("#folio-companion").waitFor();
  await until(
    () =>
      reader.evaluate(() => {
        try {
          return window.jcgal?.getImageIndex?.();
        } catch {
          return null;
        }
      }),
    (x) => x === 12,
    "resume to saved image",
  );
  const entry = await until(
    () => send("get", { url }),
    (x) =>
      x.metadata.pageCount > 0 && x.metadata.title !== "Old title 43 pages",
    "metadata repair",
  );
  assert.equal(entry.personal.page, 12);
  assert.equal(entry.personal.status, "finished");
  assert.deepEqual(entry.personal.collections, ["Favorites"]);
  if (!live) {
    assert.equal(entry.metadata.title, "Fixture title");
    assert.equal(entry.metadata.pageCount, 43);
  }
  await send("update", { url, patch: { status: "reading" } });
  await reader.evaluate(() => window.jcgal.showImage(13));
  await until(
    () => send("get", { url }),
    (x) => x.personal.page === 13,
    "automatic reader progress",
  );
  await reader.close();
  const reopened = await context.newPage();
  await reopened.goto(url + "#folio-page=13", {
    waitUntil: "domcontentloaded",
  });
  await until(
    () =>
      reopened.evaluate(() => {
        try {
          return window.jcgal?.getImageIndex?.();
        } catch {
          return null;
        }
      }),
    (x) => x === 13,
    "reopened persisted page",
  );
  if (live) {
    await library.bringToFront();
    await library.reload();
    await library.locator(".card .book-link").click();
    const drawer = library.getByRole("dialog");
    await drawer
      .getByRole("button", { name: "Refresh details", exact: true })
      .click();
    await library
      .getByText("Source details refreshed.", { exact: true })
      .waitFor();
    const refreshed = await send("get", { url });
    assert.equal(refreshed.metadata.pageCount, entry.metadata.pageCount);
    assert.ok(refreshed.metadata.author);
    assert.ok(refreshed.metadata.covers.length);
    console.log(
      "LIVE PASS: source HTML snapshot count, author, and cover candidates.",
    );
  }
  console.log(
    `${live ? "LIVE" : "FIXTURE"} PASS: metadata repaired (${entry.metadata.pageCount} pages), saved status/collections preserved, API resume, page-change persistence, reopen.`,
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
