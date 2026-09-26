import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const profile = await mkdtemp(join(tmpdir(), "folio-shelf-"));
const extension = resolve("dist");
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.BROWSER_PATH || "/usr/bin/brave",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
try {
  let covers = 0;
  const errors = [];
  await context.route("https://multporn.net/**", (route) => {
    covers++;
    if (route.request().url().endsWith("broken.jpg"))
      return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#465e70"/><circle cx="290" cy="170" r="100" fill="#d6c391"/><path d="M0 510L220 180L400 520V600H0Z" fill="#243e40"/><path d="M0 540L130 350L300 600H0Z" fill="#6f8673"/></svg>',
    });
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(`chrome-extension://${id}/library.html`);
  await page
    .getByRole("heading", { name: "A shelf full of possibilities." })
    .waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/bookshelf-empty.png",
    fullPage: true,
  });
  const fixtures = [
    ["The Garden Atlas", 128, "reading", 42, "Weekend reads"],
    ["Letters from the Moon", 86, "reading", 17, "Favorites"],
    ["A Season in Amber", 64, "reading", 53, "Weekend reads"],
    ["The Quiet Hours", 96, "finished", 96, "Favorites"],
    ["Beyond the Blue", null, "planned", 0, ""],
    ["The Last Observatory", 140, "dropped", 30, ""],
  ];
  await page.evaluate(async (fixtures) => {
    for (let i = fixtures.length - 1; i >= 0; i--) {
      const [title, total, status, bookmark, collection] = fixtures[i],
        url = `https://multporn.net/comics/fixture-${i}`;
      await chrome.runtime.sendMessage({
        type: "save",
        metadata: {
          url,
          title,
          pageCount: total,
          coverUrl: `https://multporn.net/sites/default/files/${i === 5 ? "broken" : "cover-" + i}.jpg`,
        },
      });
      await chrome.runtime.sendMessage({
        type: "update",
        url,
        patch: {
          status,
          page: bookmark,
          collections: collection ? [collection] : [],
        },
      });
    }
  }, fixtures);
  await page.reload();
  await page.locator(".card").last().waitFor();
  assert.equal(await page.locator(".card").count(), 6);
  assert.equal(await page.locator(".editor[open]").count(), 0);
  assert.equal(await page.locator("#continue-content article").count(), 3);
  assert.equal(covers, 0);
  assert.equal(
    await page.locator(".featured h3").textContent(),
    "The Garden Atlas",
  );
  const finished = page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name: "The Quiet Hours" }) });
  assert.equal(await finished.locator("progress").getAttribute("value"), "100");
  assert.match(
    await finished
      .getByRole("link", { name: "Read again", exact: true })
      .getAttribute("href"),
    /folio-page=1/,
  );
  await page.screenshot({
    path: "test-results/bookshelf-desktop.png",
    fullPage: true,
  });
  const first = page.locator(".card").first();
  await first.locator("summary").click();
  await first
    .getByLabel("Collections", { exact: false })
    .fill("Favorites, Saved for later");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  assert.equal(
    await first.getByLabel("Collections", { exact: false }).inputValue(),
    "Favorites, Saved for later",
  );
  await first.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Changes saved.", { exact: true }).waitFor();
  assert.equal(await page.locator(".editor[open]").count(), 0);
  await page.getByLabel("Find a title").fill("Quiet");
  assert.equal(await page.locator(".card").count(), 1);
  assert.equal(await page.locator("#continue-section").isVisible(), false);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("switch", { name: "Cover artwork" }).click();
  await page.locator(".card img").first().waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".card img")].every((i) => i.complete),
  );
  assert.ok(covers > 0);
  assert.equal(await page.locator(".card").last().locator("img").count(), 0);
  await page.screenshot({
    path: "test-results/bookshelf-artwork.png",
    fullPage: true,
  });
  await page.reload();
  assert.equal(
    await page
      .getByRole("switch", { name: "Cover artwork" })
      .getAttribute("aria-checked"),
    "true",
  );
  await page.getByRole("switch", { name: "Cover artwork" }).click();
  assert.equal(await page.locator(".book-art img").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/bookshelf-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.locator(".card").first().locator("summary").click();
  const box = await page.locator(".editor[open] form").boundingBox();
  assert.ok(
    box.x >= 0 && box.x + box.width <= 390,
    "mobile editor stays on screen",
  );
  await page.screenshot({
    path: "test-results/bookshelf-mobile-edit.png",
    fullPage: true,
  });
  await page.locator(".editor[open] summary").press("Escape");
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `No overflow at ${width}px`,
    );
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".book-art")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: bookshelf, continue section, progress, editing, filters, optional artwork, fallback, persistent preference, mobile layout.",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
