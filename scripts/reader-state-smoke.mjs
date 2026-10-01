import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH || "/usr/bin/brave",
  headless: true,
});
const context = await browser.newContext();
const source = "https://multporn.net/comics/reader-state-fixture";
let release;
const ready = new Promise((resolve) => {
  release = resolve;
});
try {
  // Exercise the built reader with a minimal storage boundary and only local,
  // synthetic responses. All requests are intercepted; none reach a live site.
  await context.addInitScript(() => {
    window.chrome = {
      runtime: { sendMessage: async () => ({ ok: true, value: null }) },
    };
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "https://reader.test") {
      const file = url.pathname.slice(1);
      if (["reader.html", "reader.js", "reader.css"].includes(file)) {
        return route.fulfill({
          contentType: file.endsWith("js")
            ? "text/javascript"
            : file.endsWith("css")
              ? "text/css"
              : "text/html",
          body: await readFile(new URL(`../dist/${file}`, import.meta.url)),
        });
      }
    }
    if (route.request().url() === source) {
      await ready;
      return route.fulfill({
        contentType: "text/html",
        body: '<h1>The Observatory</h1><div class="pages--full"><img src="/sites/default/files/fixture-1.png"><img src="/sites/default/files/fixture-2.png"></div>',
      });
    }
    if (url.pathname.startsWith("/sites/default/files/fixture-")) {
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="teal"/></svg>',
      });
    }
    return route.fulfill({ status: 503, body: "Synthetic source failure" });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `https://reader.test/reader.html?url=${encodeURIComponent(source)}`,
  );
  assert.equal(await page.locator("#loading").isVisible(), true);
  assert.equal(
    await page.locator("#error").isVisible(),
    false,
    "error panel must be hidden while loading",
  );
  assert.equal(await page.locator("#reader").isVisible(), false);
  release();
  await page.waitForFunction(
    () => document.querySelector("#position").textContent === "Page 1 of 2",
  );
  assert.equal(
    await page.locator("#loading").isVisible(),
    false,
    "loading panel must disappear on success",
  );
  assert.equal(await page.locator("#error").isVisible(), false);
  assert.equal(await page.locator("#reader").isVisible(), true);
  await page.waitForFunction(
    () => document.querySelector(".page")?.naturalWidth > 0,
  );
  const imageBox = await page.locator(".page").boundingBox();
  assert.ok(
    imageBox.y < 200,
    "page must not sit below a full-screen hidden loading panel",
  );
  await page.getByRole("button", { name: "Next page" }).click();
  assert.equal(await page.locator("#position").textContent(), "Page 2 of 2");
  await page.getByLabel("Mode").selectOption("continuous");
  assert.equal(await page.locator(".page").count(), 2);
  await page.goto(
    `https://reader.test/reader.html?url=${encodeURIComponent("https://multporn.net/comics/missing-fixture")}`,
  );
  await page.waitForFunction(() =>
    document.querySelector("#error-message").textContent.includes("503"),
  );
  assert.equal(
    await page.locator("#loading").isVisible(),
    false,
    "loading panel must disappear on failure",
  );
  assert.equal(await page.locator("#reader").isVisible(), false);
  assert.equal(await page.locator("#error").isVisible(), true);
  await page.goto("https://reader.test/reader.html");
  await page
    .getByText("Missing or unsupported source URL", { exact: true })
    .waitFor();
  assert.equal(await page.locator("#loading").isVisible(), false);
  assert.equal(await page.locator("#source-fallback").isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: reader loading, ready, HTTP-error, and invalid-URL states are mutually exclusive; page images are visible; navigation works.",
  );
} finally {
  release();
  await browser.close();
}
