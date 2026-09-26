import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const profile = await mkdtemp(join(tmpdir(), "folio-smoke-"));
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
  const errors = [];
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  await context.route("https://multporn.net/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Fixture reader</title><h1>The Garden Atlas</h1><div class="pages--full">${Array.from({ length: 8 }, (_, i) => `<img alt="Page ${i + 1}" width="500" height="600" style="display:block;background:hsl(${i * 25},30%,80%)" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='600'/%3E">`).join("")}</div>`,
    }),
  );
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  // CDP can exercise the companion's closed shadow root in this disposable fixture.
  const page = await context.newPage();
  await page.goto("https://multporn.net/comics/fixture");
  await page.locator("#folio-companion").waitFor();
  const cdp = await context.newCDPSession(page);
  await cdp.send("DOM.enable");
  async function clickCompanion(id) {
    const { root } = await cdp.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    function find(n) {
      if (n.attributes?.some((v, i, a) => v === "id" && a[i + 1] === id))
        return n.nodeId;
      for (const child of [...(n.children || []), ...(n.shadowRoots || [])]) {
        const hit = find(child);
        if (hit) return hit;
      }
    }
    const nodeId = find(root);
    assert.ok(nodeId, `companion ${id}`);
    const { object } = await cdp.send("DOM.resolveNode", { nodeId });
    await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function(){this.click()}",
    });
  }
  await clickCompanion("save");
  const library = await context.newPage();
  await library.goto(`chrome-extension://${id}/library.html`);
  const card = library.locator(".card");
  await card.getByRole("heading", { name: "The Garden Atlas" }).waitFor();
  await card.locator("summary").click();
  await card.getByLabel("Page", { exact: true }).fill("4");
  await card.getByLabel("Reading status").selectOption("reading");
  await card.getByLabel("Collections", { exact: false }).fill("Weekend");
  await card.getByRole("button", { name: "Save changes" }).click();
  await library.getByText("Changes saved.", { exact: true }).waitFor();
  await library.reload();
  await card.getByRole("heading", { name: "The Garden Atlas" }).waitFor();
  await card.locator("summary").click();
  assert.equal(
    await card.getByLabel("Page", { exact: true }).inputValue(),
    "4",
  );
  assert.equal(
    await card.getByLabel("Collections", { exact: false }).inputValue(),
    "Weekend",
  );
  await card.locator("summary").click();
  assert.match(
    await card
      .getByRole("link", { name: "Continue reading", exact: true })
      .getAttribute("href"),
    /folio-page=4/,
  );
  const opened = context.waitForEvent("page");
  await card.getByRole("link", { name: "Continue reading" }).click();
  const resumed = await opened;
  await resumed.waitForLoadState();
  await resumed.waitForFunction(() => scrollY > 1500);
  await resumed.bringToFront();
  await resumed.locator(".pages--full img").nth(5).scrollIntoViewIfNeeded();
  // Poll committed storage through the extension rather than sleeping for a guessed delay.
  let persisted = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const saved = await library.evaluate(async () =>
      chrome.runtime.sendMessage({
        type: "get",
        url: "https://multporn.net/comics/fixture",
      }),
    );
    if (saved.value?.personal.page === 6) {
      persisted = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(persisted, "scroll progress committed to storage");
  await resumed.close();
  await library.bringToFront();
  await library.reload();
  await card.getByRole("heading", { name: "The Garden Atlas" }).waitFor();
  assert.equal(await card.locator("progress").getAttribute("value"), "75");
  await library.setViewportSize({ width: 1360, height: 920 });
  await mkdir("test-results", { recursive: true });
  await library.screenshot({
    path: "test-results/library-desktop.png",
    fullPage: true,
  });
  await library.setViewportSize({ width: 390, height: 844 });
  await library.screenshot({
    path: "test-results/library-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await library.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: extension save → library → edit → reload → resume; desktop/mobile layout; no page errors.",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
