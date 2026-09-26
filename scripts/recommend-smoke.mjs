import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const profile = await mkdtemp(join(tmpdir(), "folio-recommend-"));
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
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/library.html`);
  await page
    .getByRole("heading", { name: "A shelf full of possibilities." })
    .waitFor();
  const fixtures = [
    ["The Garden Atlas", ["furry", "space"], "reading", 40, false],
    ["The Quiet Hours", ["furry", "space"], "planned", 0, false],
    ["Beyond the Blue", ["romance"], "planned", 0, false],
    ["The Last Observatory", ["furry"], "dropped", 3, false],
  ];
  await page.evaluate(async (fixtures) => {
    for (let i = fixtures.length - 1; i >= 0; i--) {
      const [title, tags, status, bookmark] = fixtures[i],
        url = `https://multporn.net/comics/fixture-${i}`;
      await chrome.runtime.sendMessage({
        type: "save",
        metadata: { url, title, pageCount: 100 + i, tags },
      });
      await chrome.runtime.sendMessage({
        type: "update",
        url,
        patch: { status, page: bookmark },
      });
    }
  }, fixtures);
  await page.reload();
  await page.locator(".card").first().waitFor();
  assert.equal(
    await page.locator(".card").count(),
    4,
    "All titles lists every record",
  );

  const forYou = page.getByRole("button", { name: /For you/ });
  assert.match(
    await forYou.innerText(),
    /For you\s*3/,
    "dismissed titles are not recommended",
  );
  await forYou.click();
  await page.locator(".card").first().waitFor();
  const titles = () => page.locator(".card .title-button").allInnerTexts();
  assert.equal(await page.locator(".card").count(), 3);
  assert.equal(await page.locator("#shelf-name").innerText(), "For you");
  assert.deepEqual(await titles(), [
    "The Garden Atlas",
    "The Quiet Hours",
    "Beyond the Blue",
  ]);
  const why = page.locator(".card").first().locator(".why-text");
  assert.match(
    await why.innerText(),
    /Tag|Author|explicitly liked|preference/i,
  );
  for (const card of await page.locator(".card").all())
    assert.equal(await card.locator(".rate").count(), 2);

  // The explore control mirrors the stored slider position and restyles the shelf.
  const explore = page.locator("#explore input[type=range]");
  assert.equal(await explore.inputValue(), "25");
  assert.match(
    await page.locator("#explore output").innerText(),
    /25% Explore/,
  );

  // Explicit feedback reranks immediately, survives a reload, and toggles off again.
  const blue = page.locator(".card", { hasText: "Beyond the Blue" }),
    more = blue.getByRole("button", { name: /^More like this/ }),
    less = blue.getByRole("button", { name: /^Less like this/ });
  assert.equal(await more.getAttribute("aria-pressed"), "false");
  await more.click();
  await page.getByText("Preference saved.", { exact: true }).waitFor();
  assert.equal(await more.getAttribute("aria-pressed"), "true");
  assert.deepEqual(await titles(), [
    "The Garden Atlas",
    "Beyond the Blue",
    "The Quiet Hours",
  ]);
  await page.screenshot({
    path: "test-results/for-you.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: /For you/ }).click();
  await page.locator(".card").first().waitFor();
  assert.deepEqual(
    await titles(),
    ["The Garden Atlas", "Beyond the Blue", "The Quiet Hours"],
    "the explicit choice was persisted",
  );
  assert.equal(
    await page
      .locator(".card", { hasText: "Beyond the Blue" })
      .getByRole("button", { name: /^More like this/ })
      .getAttribute("aria-pressed"),
    "true",
  );

  // A non-default slider position is stored with the same profile.
  await explore.evaluate((input) => {
    input.value = "90";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.match(
    await page.locator("#explore output").innerText(),
    /90% Explore/,
  );
  assert.equal(await page.locator(".card").count(), 3);
  await page.reload();
  await page.getByRole("button", { name: /For you/ }).click();
  await page.locator(".card").first().waitFor();
  assert.equal(
    await page.locator("#explore input[type=range]").inputValue(),
    "90",
  );

  // A dislike sinks the title, and clearing restores the inferred ranking.
  await less.click();
  await page.getByText("Preference saved.", { exact: true }).waitFor();
  assert.deepEqual(await titles(), [
    "The Garden Atlas",
    "The Quiet Hours",
    "Beyond the Blue",
  ]);
  await less.click();
  await page.getByText("Preference cleared.", { exact: true }).waitFor();
  assert.equal(await less.getAttribute("aria-pressed"), "false");
  assert.deepEqual(await titles(), [
    "The Garden Atlas",
    "Beyond the Blue",
    "The Quiet Hours",
  ]);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: For you ranks the library, explains positions, persists feedback and the explore position; dismissed titles stay out; no page errors.",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
