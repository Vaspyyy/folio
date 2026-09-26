import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const profile = await mkdtemp(join(tmpdir(), "folio-workspace-")),
  extension = resolve("dist");
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.BROWSER_PATH || "/usr/bin/brave",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
const url = "https://multporn.net/comics/atlas";
let version = 10,
  failure = false,
  slow = false;
const snapshot = () =>
  `<!doctype html><meta property="og:image" content="https://multporn.net/sites/default/files/cover.jpg"><h1>The Garden Atlas</h1><div class="field-name-field-author"><a>A. Gardener</a></div><div class="field-name-body"><div class="field-item">A journey through an imaginary garden.</div></div><div class="juicebox-container"><noscript>${Array.from({ length: version }, (_, i) => `<p class="jb-image"><img src="https://multporn.net/sites/default/files/page-${i}.jpg"></p>`).join("")}</noscript></div>`;
async function until(read, predicate, label) {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out: " + label);
}
try {
  const errors = [];
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  await context.route("https://multporn.net/**", async (route) => {
    const req = route.request(),
      pathname = new URL(req.url()).pathname;
    if (pathname === "/new")
      return route.fulfill({
        contentType: "text/html",
        body: '<div class="view-content"><div class="views-row"><div class="views-field-title"><a href="/comics/atlas">The Garden Atlas</a></div></div></div>',
      });
    if (req.resourceType() === "image")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="#527965"/></svg>',
      });
    if (slow) await new Promise((r) => setTimeout(r, 1500));
    return route
      .fulfill({
        status: failure ? 503 : 200,
        contentType: "text/html",
        body: failure ? "Unavailable" : snapshot(),
      })
      .catch(() => {});
  });
  const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker")),
    id = new URL(worker.url()).host;
  const listing = await context.newPage();
  await listing.goto("https://multporn.net/new");
  await listing.getByRole("button", { name: "+ Save to Folio" }).click();
  await listing.getByRole("button", { name: "Saved · Want to read" }).waitFor();
  // Infinite-scroll listing additions acquire their own controls.
  await listing.evaluate(() => {
    const row = document.createElement("div");
    row.className = "views-row";
    row.innerHTML =
      '<div class="views-field-title"><a href="/comics/second">Letters from the Moon</a></div>';
    document.querySelector(".view-content").append(row);
  });
  await listing.getByRole("button", { name: "+ Save to Folio" }).click();
  await until(
    () => listing.getByRole("button", { name: "Saved · Want to read" }).count(),
    (x) => x === 2,
    "dynamic listing saved",
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`chrome-extension://${id}/library.html`);
  const send = (type, payload = {}) =>
    page.evaluate(
      async ({ type, payload }) => {
        const r = await chrome.runtime.sendMessage({ type, ...payload });
        if (!r.ok) throw new Error(r.error);
        return r.value;
      },
      { type, payload },
    );
  const card = () =>
    page
      .locator(".card")
      .filter({
        has: page.getByRole("heading", {
          name: "The Garden Atlas",
          exact: true,
        }),
      });
  await card()
    .getByRole("button", { name: "Details for The Garden Atlas" })
    .click();
  const drawer = page.getByRole("dialog");
  await drawer
    .getByRole("button", { name: "Refresh details", exact: true })
    .click();
  await drawer.getByText("A. Gardener", { exact: true }).waitFor();
  assert.equal((await send("get", { url })).metadata.pageCount, 10);
  await drawer.getByLabel("Favorite", { exact: true }).check();
  await drawer.getByLabel("Pin to Read next", { exact: true }).check();
  await drawer.getByLabel("Follow new pages", { exact: true }).check();
  await drawer.getByLabel("Publication status").selectOption("ongoing");
  await drawer.getByLabel("Collections", { exact: false }).fill("Garden shelf");
  await drawer.getByLabel("Private notes").fill("Return to this world.");
  await drawer.getByLabel("Cover for this title").selectOption("jacket");
  await drawer.getByRole("button", { name: "Save personal details" }).click();
  let saved = await send("get", { url });
  assert.equal(saved.personal.notes, "Return to this world.");
  assert.equal(saved.personal.queued, true);
  assert.equal(saved.personal.coverChoice, "jacket");
  await send("update", { url, patch: { status: "finished" } });
  version = 13;
  await page
    .locator("#special-nav")
    .getByRole("button", { name: /Updates/ })
    .click();
  await page.getByRole("button", { name: "Check for updates" }).click();
  await until(
    () => page.locator("#update-status").textContent(),
    (x) => x.startsWith("Checked"),
    "update check",
  );
  saved = await send("get", { url });
  assert.equal(saved.metadata.pageCount, 13);
  assert.equal(saved.personal.status, "finished");
  assert.equal(saved.personal.publication, "ongoing");
  await page.getByRole("button", { name: "Read 3 new pages" }).waitFor();
  // Capture the extension tabs API boundary; browser-created tabs can escape routing
  // before Playwright attaches. The fixture suite must never visit a real source page.
  await page.evaluate(() => {
    chrome.tabs.create = async (options) => {
      window.__folioOpened = options.url;
      return { id: 1 };
    };
  });
  await page.getByRole("button", { name: "Read 3 new pages" }).click();
  const target = await until(
    () => page.evaluate(() => window.__folioOpened),
    (x) => !!x,
    "new-page navigation",
  );
  assert.match(target, /#folio-page=11$/);
  const reader = await context.newPage();
  await reader.goto(target);
  assert.match(reader.url(), /#folio-page=11$/);
  await reader.close();
  await page.bringToFront();
  assert.equal((await send("get", { url })).personal.page, 11);
  // Failure keeps the last known metadata and displays a per-title error.
  failure = true;
  await page.getByRole("button", { name: "Check for updates" }).click();
  await until(
    () => page.locator("#update-status").textContent(),
    (x) => x.includes("1 failed"),
    "failed check",
  );
  assert.equal((await send("get", { url })).metadata.pageCount, 13);
  failure = false;
  slow = true;
  await page.getByRole("button", { name: "Check for updates" }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await until(
    () => page.locator("#update-status").textContent(),
    (x) => x.startsWith("Stopped"),
    "stopped check",
  );
  slow = false;
  await send("update", {
    url: "https://multporn.net/comics/second",
    patch: { queued: true, collections: ["Garden shelf"] },
  });
  await page.reload();
  await page
    .locator("#special-nav")
    .getByRole("button", { name: /Read next/ })
    .click();
  const before = await page.locator(".card").first().getAttribute("data-url");
  await page
    .locator(".card")
    .first()
    .getByRole("button", { name: /Move later/ })
    .click();
  await until(
    () => page.locator(".card").first().getAttribute("data-url"),
    (x) => x !== before,
    "queue order changed",
  );
  const first = await page.locator(".card").first().getAttribute("data-url");
  await page.reload();
  await page
    .locator("#special-nav")
    .getByRole("button", { name: /Read next/ })
    .click();
  assert.equal(
    await page.locator(".card").first().getAttribute("data-url"),
    first,
  );
  await page
    .locator("#collection-nav")
    .getByRole("button", { name: "Garden shelf", exact: true })
    .click();
  await page
    .locator("#collection-mosaic")
    .getByRole("heading", { name: "Garden shelf" })
    .waitFor();
  assert.equal(await page.locator("#collection-mosaic .book-art").count(), 2);
  await page.locator(".card").first().dragTo(page.locator(".card").last());
  await until(
    () => send("get", { url }),
    (x) => Number.isFinite(x.personal.orders["collection:Garden shelf"]),
    "drag order stored",
  );
  await page.locator("#appearance summary").click();
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.getByLabel("Shelf density").selectOption("compact");
  await page.locator("#appearance summary").click();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/workspace-dark.png",
    fullPage: true,
  });
  await card()
    .getByRole("button", { name: "Details for The Garden Atlas" })
    .click();
  assert.equal(
    await drawer.getByLabel("Private notes").inputValue(),
    "Return to this world.",
  );
  assert.equal(
    await drawer.getByLabel("Cover for this title").inputValue(),
    "jacket",
  );
  await drawer.getByRole("heading", { name: "Your reading history" }).waitFor();
  await page.screenshot({
    path: "test-results/workspace-drawer.png",
    fullPage: true,
  });
  await drawer.getByRole("button", { name: "Close title details" }).click();
  await page.getByRole("button", { name: "Hide library" }).click();
  assert.equal(await page.locator(".shelf-section").isVisible(), false);
  assert.equal(await page.locator(".book-art img").count(), 0);
  await page.reload();
  await page
    .getByRole("heading", { name: "Your shelf is tucked away." })
    .waitFor();
  assert.equal(await page.locator(".shelf-section").isVisible(), false);
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  await page
    .getByRole("button", { name: "Reveal library", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: listing saves, drawer metadata/notes/cover, updates/new-page resume/failure/cancel, collection mosaic/drag ordering, queue persistence, dark/compact/privacy/mobile.",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
