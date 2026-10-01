import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRelay } from "../apps/relay/server.mjs";
const directory = await mkdtemp(join(tmpdir(), "folio-pocket-smoke-"));
const relay = await createRelay({
  dataDir: join(directory, "relay"),
  webDir: resolve("build/portable"),
  port: 0,
});
const origin = "http://127.0.0.1:" + relay.address().port;
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH || "/usr/bin/brave",
  headless: true,
});
const desktop = await browser.newContext(),
  phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
const errors = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
try {
  await mkdir("test-results", { recursive: true });
  const pc = await desktop.newPage(),
    mobile = await phone.newPage();
  for (const p of [pc, mobile])
    p.on("pageerror", (e) => errors.push(e.message));
  await pc.goto(origin);
  await pc.getByRole("dialog", { name: "Your stories, everywhere." }).waitFor();
  assert.equal(await pc.locator("#tutorial-back").isDisabled(), true);
  await pc.getByRole("button", { name: "Next chapter →" }).click();
  await pc
    .getByRole("heading", { name: "Bring your library along." })
    .waitFor();
  await pc.getByText("How do I get a relay address?", { exact: true }).click();
  assert.ok(
    await pc
      .locator("#tutorial-relay-help")
      .textContent()
      .then((text) => text.includes("FOLIO_HOST=0.0.0.0")),
  );
  await pc.getByRole("button", { name: "Back", exact: true }).click();
  await pc
    .getByRole("heading", { name: "Your stories, everywhere.", exact: true })
    .waitFor();
  for (let i = 0; i < 3; i++)
    await pc.getByRole("button", { name: "Next chapter →" }).click();
  await pc
    .getByRole("button", { name: "Use on this device", exact: true })
    .click();
  await pc.locator("#tutorial").waitFor({ state: "hidden" });
  await pc.reload();
  await pc.getByRole("heading", { name: "A world within reach." }).waitFor();
  assert.equal(
    await pc.locator("#tutorial").isVisible(),
    false,
    "tutorial completion persists on this device",
  );
  await pc.getByRole("button", { name: "Devices", exact: true }).click();
  await pc
    .getByRole("button", { name: "Getting started", exact: true })
    .click();
  await pc.getByRole("dialog", { name: "Your stories, everywhere." }).waitFor();
  await pc.keyboard.press("Escape");
  await pc.locator("#tutorial").waitFor({ state: "hidden" });
  await pc.getByRole("button", { name: "Library", exact: true }).click();
  await pc.getByRole("button", { name: "＋ Add a title", exact: true }).click();
  await pc.getByLabel("Title", { exact: true }).fill("The Observatory");
  await pc
    .getByLabel("Collections", { exact: true })
    .fill("Science fiction, Weekend reads");
  await pc
    .getByLabel("Private notes", { exact: true })
    .fill("Bring this on the train.");
  await pc.getByRole("button", { name: "Save changes", exact: true }).click();
  await pc.getByText("Changes saved.", { exact: true }).waitFor();
  await pc.getByRole("button", { name: "Details for The Observatory" }).click();
  const files = [];
  for (let i = 1; i <= 3; i++) {
    const file = join(directory, `page-${i}.png`);
    await writeFile(file, png);
    files.push(file);
  }
  await pc.locator("#page-files").setInputFiles(files);
  await pc.getByText("Page images imported.", { exact: true }).waitFor();
  await pc.getByRole("button", { name: "Close details" }).click();
  await pc
    .getByRole("button", { name: "Start reading ↗", exact: true })
    .click();
  await pc
    .locator("#reader-position")
    .filter({ hasText: "Page 1 of 3" })
    .waitFor();
  await pc.locator("#next").click();
  await pc
    .locator("#reader-position")
    .filter({ hasText: "Page 2 of 3" })
    .waitFor();
  await pc.getByRole("button", { name: "Back to library" }).click();
  await pc.getByRole("button", { name: "Devices", exact: true }).click();
  await pc.getByLabel("Relay address", { exact: true }).fill(origin);
  await pc
    .getByRole("button", { name: "Create private library", exact: true })
    .click();
  await pc.getByText("Your library is paired.", { exact: true }).waitFor();
  const code = await pc.locator("#pair-code").inputValue();
  await mobile.goto(origin);
  await mobile
    .getByRole("dialog", { name: "Your stories, everywhere." })
    .waitFor();
  await mobile.screenshot({
    path: "test-results/folio-pocket-tutorial.png",
    fullPage: true,
  });
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "tutorial fits the phone viewport",
  );
  for (let i = 0; i < 3; i++)
    await mobile.getByRole("button", { name: "Next chapter →" }).click();
  await mobile
    .getByRole("button", { name: "Pair my library", exact: true })
    .click();
  await mobile.locator("#tutorial").waitFor({ state: "hidden" });
  assert.equal(
    await mobile
      .locator("#pair-input")
      .evaluate((e) => e === document.activeElement),
    true,
  );

  await mobile.getByLabel("Pairing code", { exact: true }).fill(code);
  await mobile
    .getByRole("button", { name: "Pair this device", exact: true })
    .click();
  await mobile.getByText("Your library is paired.", { exact: true }).waitFor();
  await mobile.getByRole("button", { name: "Library", exact: true }).click();
  await mobile
    .getByRole("button", { name: "Details for The Observatory" })
    .click();
  assert.equal(
    await mobile.getByLabel("Page", { exact: true }).inputValue(),
    "2",
  );
  assert.equal(
    await mobile.getByLabel("Private notes", { exact: true }).inputValue(),
    "Bring this on the train.",
  );
  assert.equal(
    await mobile
      .locator("#download-info")
      .textContent()
      .then((s) => s.includes("on this device")),
    false,
    "page bytes are not sent through sync",
  );
  await mobile.locator("#page-files").setInputFiles(files);
  await mobile.getByText("Page images imported.", { exact: true }).waitFor();
  await mobile.getByRole("button", { name: "Close details" }).click();
  await mobile.screenshot({
    path: "test-results/folio-pocket-library.png",
    fullPage: true,
  });
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "mobile layout must fit",
  );
  await mobile
    .locator(".card")
    .getByRole("button", { name: "Continue reading ↗", exact: true })
    .click();
  await mobile
    .locator("#reader-position")
    .filter({ hasText: "Page 2 of 3" })
    .waitFor();
  await mobile.locator("#next").click();
  await mobile
    .locator("#reader-position")
    .filter({ hasText: "Page 3 of 3" })
    .waitFor();
  await mobile.getByRole("button", { name: "Back to library" }).click();
  await mobile.getByRole("button", { name: "Devices", exact: true }).click();
  await mobile.getByRole("button", { name: "Sync now", exact: true }).click();
  await mobile
    .getByText("Your library is up to date.", { exact: true })
    .waitFor();
  await pc.getByRole("button", { name: "Sync now", exact: true }).click();
  await pc.getByText("Your library is up to date.", { exact: true }).waitFor();
  await pc.getByRole("button", { name: "Library", exact: true }).click();
  await pc.getByRole("button", { name: "Details for The Observatory" }).click();
  assert.equal(await pc.getByLabel("Page", { exact: true }).inputValue(), "3");
  await pc.getByRole("button", { name: "Close details" }).click();
  // Read a downloaded title after a reload with all networking disabled.
  await mobile.getByRole("button", { name: "Library", exact: true }).click();
  await mobile.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await phone.setOffline(true);
  await mobile.reload();
  await mobile
    .getByRole("button", { name: "Details for The Observatory" })
    .waitFor();
  await mobile.getByRole("button", { name: "Offline", exact: true }).click();
  await mobile
    .locator(".card")
    .getByRole("button", { name: "Continue reading ↗", exact: true })
    .click();
  await mobile
    .locator("#reader-position")
    .filter({ hasText: "Page 3 of 3" })
    .waitFor();
  await mobile.waitForFunction(
    () => document.querySelector("#reader-stage img")?.naturalWidth > 0,
  );
  await mobile.locator("#previous").click();
  await mobile
    .locator("#reader-position")
    .filter({ hasText: "Page 2 of 3" })
    .waitFor();
  await mobile.locator("#reader-tools").click();
  await mobile.getByLabel("Mode", { exact: true }).selectOption("continuous");
  assert.equal(await mobile.locator("#reader-stage img").count(), 3);
  await mobile.screenshot({
    path: "test-results/folio-pocket-reader.png",
    fullPage: true,
  });
  await mobile.getByRole("button", { name: "Back to library" }).click();
  await mobile
    .getByRole("button", { name: "Hide library", exact: true })
    .click();
  await mobile.locator("#privacy-screen").waitFor();
  assert.equal(await mobile.locator("#privacy-screen").isVisible(), true);
  assert.equal(
    await mobile
      .getByRole("button", { name: "Details for The Observatory" })
      .count(),
    0,
  );
  await mobile.locator("#reveal").click();
  await mobile
    .getByRole("button", { name: "Details for The Observatory" })
    .click();
  await mobile
    .getByRole("button", { name: "Remove download", exact: true })
    .click();
  await mobile
    .getByText("Download removed. Your library entry is kept.", { exact: true })
    .waitFor();
  await mobile.getByRole("button", { name: "Close details" }).click();
  await mobile.getByRole("button", { name: "Library", exact: true }).click();
  assert.equal(
    await mobile
      .getByRole("button", { name: "Details for The Observatory" })
      .count(),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: first-start tutorial, replay/back/dismissal and persistent completion, paired desktop/phone library, private progress and notes sync, page import, reading after offline reload, continuous mode, privacy, and independent download removal.",
  );
} finally {
  await browser.close();
  relay.closeAllConnections();
  await new Promise((r) => relay.close(r));
  await rm(directory, { recursive: true, force: true });
}
