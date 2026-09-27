import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const profile = await mkdtemp(join(tmpdir(), "folio-autonomous-"));
const extension = resolve("dist");
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.BROWSER_PATH || "/usr/bin/brave",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});

const listing = (items, pager = "") => `<!doctype html>
  <div class="view-content">
    ${items
      .map(
        ([slug, title]) => `
      <div class="views-row">
        <div class="views-field-title">
          <a href="/comics/${slug}">${title}</a>
        </div>
        <div class="views-field-field-preview">
          <a href="/comics/${slug}"><img src="/sites/default/files/${slug}-cover.jpg"></a>
        </div>
      </div>`,
      )
      .join("")}
  </div>
  ${pager}`;

const detail = (slug, title, author, tags) => `<!doctype html>
  <meta property="og:image" content="https://multporn.net/sites/default/files/${slug}-cover.jpg">
  <h1>${title}</h1>
  <div class="field-name-field-author"><a>${author}</a></div>
  <div class="field-name-field-tags">
    ${tags.map((tag) => `<a href="/category/${tag}">${tag}</a>`).join("")}
  </div>
  <div class="pages--full">
    <img src="/sites/default/files/${slug}-1.jpg">
    <img src="/sites/default/files/${slug}-2.jpg">
    <img src="/sites/default/files/${slug}-3.jpg">
  </div>`;

try {
  const errors = [];
  let rootRequests = 0;
  await context.route("https://multporn.net/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() === "image") {
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="700" height="1000"><rect width="700" height="1000" fill="#243b33"/><text x="60" y="120" font-size="48" fill="#dce5c5">Folio page</text></svg>',
      });
    }
    if (url.pathname === "/") {
      rootRequests++;
      if (url.searchParams.get("page") === "1")
        return route.fulfill({
          contentType: "text/html",
          body: listing([["auto-history", "The Archive Road"]]),
        });
      return route.fulfill({
        contentType: "text/html",
        body: listing(
          [
            ["auto-space", "The Quiet Orbit"],
            ["auto-fantasy", "Glass Kingdom"],
          ],
          '<a href="/?page=1">Next</a>',
        ),
      });
    }
    if (url.pathname === "/comics/auto-space")
      return route.fulfill({
        contentType: "text/html",
        body: detail(
          "auto-space",
          "The Quiet Orbit",
          "Alex North",
          ["Space", "Furry"],
        ),
      });
    if (url.pathname === "/comics/auto-fantasy")
      return route.fulfill({
        contentType: "text/html",
        body: detail(
          "auto-fantasy",
          "Glass Kingdom",
          "Sam West",
          ["Fantasy", "Magic"],
        ),
      });
    if (url.pathname === "/comics/auto-history")
      return route.fulfill({
        contentType: "text/html",
        body: detail(
          "auto-history",
          "The Archive Road",
          "Dana Grey",
          ["History"],
        ),
      });
    return route.fulfill({ status: 404, body: "missing fixture" });
  });

  const worker =
    context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const library = await context.newPage();
  library.on("pageerror", (error) => errors.push(error.message));
  await library.goto(`chrome-extension://${id}/library.html`);

  const send = (type, payload = {}) =>
    library.evaluate(
      async ({ type, payload }) => {
        const response = await chrome.runtime.sendMessage({ type, ...payload });
        if (!response?.ok) throw new Error(response?.error || "request failed");
        return response.value;
      },
      { type, payload },
    );

  const state = await send("runDiscovery", { manual: true });
  assert.equal(state.running, false);
  assert.ok(state.lastSuccessAt);
  assert.equal(state.stats.discovered, 3);
  assert.ok(state.stats.enriched >= 2);
  assert.ok(rootRequests >= 2);

  const catalog = await send("catalog", { limit: 20 });
  assert.equal(catalog.length, 3);
  const space = catalog.find((item) => item.title === "The Quiet Orbit");
  assert.ok(space);
  assert.equal(space.author, "Alex North");
  assert.deepEqual(space.tags, ["Space", "Furry"]);
  assert.equal(space.pageCount, 3);
  assert.ok(space.detailObservedAt);

  await send("save", { metadata: space });
  const reader = await context.newPage();
  reader.on("pageerror", (error) => errors.push(error.message));
  await reader.goto(
    `chrome-extension://${id}/reader.html?url=${encodeURIComponent(space.url)}`,
  );
  await reader.getByText("The Quiet Orbit", { exact: true }).waitFor();
  assert.equal(await reader.locator(".page").count(), 1);
  assert.equal(await reader.locator("#position").textContent(), "Page 1 of 3");
  assert.match(reader.url(), /^chrome-extension:/);

  await reader.getByRole("button", { name: "Next page" }).click();
  await reader.getByText("Page 2 of 3", { exact: true }).waitFor();
  const saved = await send("get", { url: space.url });
  assert.equal(saved.personal.page, 2);
  assert.equal(saved.personal.status, "reading");

  await reader.getByLabel("Mode").selectOption("continuous");
  assert.equal(await reader.locator(".page").count(), 3);
  await reader.keyboard.press("Home");
  await reader.getByText("Page 1 of 3", { exact: true }).waitFor();

  const unsaved = catalog.find((item) => item.title === "Glass Kingdom");
  const preview = await context.newPage();
  await preview.goto(
    `chrome-extension://${id}/reader.html?url=${encodeURIComponent(unsaved.url)}`,
  );
  await preview.getByText("Glass Kingdom", { exact: true }).waitFor();
  const save = preview.getByRole("button", { name: "Save to library" });
  assert.equal(await save.getAttribute("aria-pressed"), "false");
  await save.click();
  assert.equal((await send("get", { url: unsaved.url })).metadata.title, "Glass Kingdom");

  await library.reload();
  await library
    .locator("#special-nav")
    .getByRole("button", { name: /For you/ })
    .click();
  await library.getByRole("button", { name: "Refresh discovery" }).waitFor();
  const status = await library.locator("#discovery-status").textContent();
  assert.match(status, /Last refreshed|Discovery runs|complete/i);

  assert.deepEqual(errors, []);
  console.log(
    "PASS: background discovery populates/enriches the catalog; native reader loads source pages, persists progress, supports continuous mode, and saves unsaved previews.",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
