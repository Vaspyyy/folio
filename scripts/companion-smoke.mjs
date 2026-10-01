import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRelay } from "../apps/relay/server.mjs";
import { createPair } from "../packages/portable-core/sync.js";
import { pairingCode } from "../packages/portable-core/crypto.js";
const dir = await mkdtemp(join(tmpdir(), "folio-companion-"));
const server = await createRelay({
  dataDir: join(dir, "relay"),
  webDir: resolve("build/portable"),
  port: 0,
});
const origin = "http://127.0.0.1:" + server.address().port;
const pair = await createPair(origin);
const context = await chromium.launchPersistentContext(join(dir, "profile"), {
  executablePath: process.env.BROWSER_PATH || "/usr/bin/brave",
  headless: true,
  args: [
    `--disable-extensions-except=${resolve("dist")}`,
    `--load-extension=${resolve("dist")}`,
  ],
});
const mobileBrowser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH || "/usr/bin/brave",
  headless: true,
});
const phone = await mobileBrowser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const source = "https://multporn.net/comics/paired-science-fixture";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
const errors = [];
try {
  for (const c of [context, phone])
    await c.route("https://multporn.net/**", (route) => {
      if (
        route.request().resourceType() === "image" ||
        route.request().url().includes("/sites/default/files/")
      )
        return route.fulfill({
          contentType: "image/png",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: png,
        });
      if (route.request().url() === source)
        return route.fulfill({
          contentType: "text/html",
          body: '<h1>The Paired Observatory</h1><div class="pages--full"><img src="/sites/default/files/paired-1.png"><img src="/sites/default/files/paired-2.png"><img src="/sites/default/files/paired-3.png"></div>',
        });
      return route.fulfill({ status: 404, body: "No synthetic page" });
    });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const connect = await context.newPage();
  connect.on("pageerror", (e) => errors.push(e.message));
  await connect.goto(`chrome-extension://${id}/connect.html`);
  await connect.evaluate(
    async ({ url, code }) => {
      const saved = await chrome.runtime.sendMessage({
        type: "save",
        metadata: { url, title: "The Paired Observatory", pageCount: 3 },
      });
      if (!saved.ok) throw new Error(saved.error);
      await chrome.runtime.sendMessage({
        type: "update",
        url,
        patch: {
          status: "reading",
          page: 1,
          notes: "From the computer",
          collections: ["Science"],
        },
      });
      // Simulate approving only the optional relay-origin permission prompt. Network
      // traffic still uses the real extension's background sync and the real relay.
      chrome.permissions.request = async () => true;
      document.querySelector("#join-code").value = code;
    },
    { url: source, code: pairingCode(pair) },
  );
  await connect
    .getByRole("button", { name: "Pair this computer", exact: true })
    .click();
  await connect
    .getByText("Your saved library is in sync.", { exact: true })
    .waitFor();
  const reader = await context.newPage();
  reader.on("pageerror", (e) => errors.push(e.message));
  await reader.goto(
    `chrome-extension://${id}/reader.html?url=${encodeURIComponent(source)}`,
  );
  await reader.getByText("Page 1 of 3", { exact: true }).waitFor();
  await connect.evaluate(async (url) => {
    const result = await chrome.runtime.sendMessage({
      type: "mobilePages",
      url,
      pages: [1, 2, 3].map(
        (i) => `https://multporn.net/sites/default/files/paired-${i}.png`,
      ),
    });
    if (!result.ok) throw new Error(result.error);
  }, source);
  await connect
    .getByRole("button", { name: "Send library / Sync now", exact: true })
    .click();
  await connect
    .getByText("Your saved library is in sync.", { exact: true })
    .waitFor();
  const app = await phone.newPage();
  app.on("pageerror", (e) => errors.push(e.message));
  await app.goto(origin);
  await app.getByRole("button", { name: "Devices", exact: true }).click();
  await app.getByLabel("Pairing code", { exact: true }).fill(pairingCode(pair));
  await app
    .getByRole("button", { name: "Pair this device", exact: true })
    .click();
  await app.getByText("Your library is paired.", { exact: true }).waitFor();
  await app.getByRole("button", { name: "Library", exact: true }).click();
  await app
    .getByRole("button", { name: "Details for The Paired Observatory" })
    .click();
  assert.equal(
    await app.getByLabel("Private notes", { exact: true }).inputValue(),
    "From the computer",
  );
  await app.getByRole("button", { name: "Keep offline", exact: true }).click();
  await app
    .getByText("This title is available offline.", { exact: true })
    .waitFor();
  await app.getByRole("button", { name: "Close details" }).click();
  await app
    .locator(".card")
    .getByRole("button", { name: "Continue reading ↗", exact: true })
    .click();
  await app.locator("#next").click();
  await app
    .locator("#reader-position")
    .filter({ hasText: "Page 2 of 3" })
    .waitFor();
  await app.getByRole("button", { name: "Back to library" }).click();
  await app.getByRole("button", { name: "Devices", exact: true }).click();
  await app.getByRole("button", { name: "Sync now", exact: true }).click();
  await app.getByText("Your library is up to date.", { exact: true }).waitFor();
  await connect
    .getByRole("button", { name: "Send library / Sync now", exact: true })
    .click();
  await connect
    .getByText("Your saved library is in sync.", { exact: true })
    .waitFor();
  const record = await connect.evaluate(
    async (url) =>
      (await chrome.runtime.sendMessage({ type: "get", url })).value,
    source,
  );
  assert.equal(record.personal.page, 2);
  assert.deepEqual(record.personal.collections, ["Science"]);
  assert.equal(record.personal.notes, "From the computer");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real extension pairs with mobile client, shares saved titles/page lists, downloads selected pages, and receives phone progress.",
  );
} finally {
  await context.close();
  await mobileBrowser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
}
