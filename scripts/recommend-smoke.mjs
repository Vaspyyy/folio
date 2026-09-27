import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
    context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/library.html`);
  await page
    .getByRole("heading", { name: "A shelf full of possibilities." })
    .waitFor();

  await page.evaluate(async () => {
    const send = async (message) => {
      const response = await chrome.runtime.sendMessage(message);
      if (!response.ok) throw new Error(response.error);
      return response.value;
    };
    const library = [
      {
        url: "https://multporn.net/comics/read-space",
        title: "The Garden Atlas",
        tags: ["furry", "space"],
        author: "Alex North",
        pageCount: 100,
      },
      {
        url: "https://multporn.net/comics/dropped-mystery",
        title: "The Last Observatory",
        tags: ["mystery"],
        pageCount: 80,
      },
    ];
    for (const metadata of library) await send({ type: "save", metadata });
    await send({
      type: "update",
      url: library[0].url,
      patch: { status: "finished", page: 100, favorite: true },
    });
    await send({
      type: "update",
      url: library[1].url,
      patch: { status: "dropped", page: 3 },
    });

    await send({
      type: "observeCatalog",
      authoritative: true,
      items: [
        {
          url: "https://multporn.net/comics/new-space",
          title: "The Quiet Hours",
          tags: ["furry", "space"],
          author: "Alex North",
          pageCount: 70,
        },
        {
          url: "https://multporn.net/comics/new-romance",
          title: "Beyond the Blue",
          tags: ["romance"],
          author: "Sam West",
          pageCount: 90,
        },
        {
          url: "https://multporn.net/comics/new-furry",
          title: "Other Skies",
          tags: ["furry"],
          pageCount: 55,
        },
      ],
    });
  });

  await page.reload();
  await page.locator(".card").first().waitFor();
  assert.equal(await page.locator(".card").count(), 2, "All titles is the library");

  const forYou = page.getByRole("button", { name: /For you/ });
  assert.match(await forYou.innerText(), /For you\s*3/);
  await forYou.click();
  await page.getByRole("button", { name: "The Quiet Hours", exact: true }).waitFor();
  const titles = () => page.locator(".card .title-button").allInnerTexts();
  assert.deepEqual(await titles(), [
    "The Quiet Hours",
    "Other Skies",
    "Beyond the Blue",
  ]);
  assert.ok(!(await titles()).includes("The Garden Atlas"));

  const blue = page.locator(".card", { hasText: "Beyond the Blue" });
  const more = blue.getByRole("button", { name: /^More like this/ });
  await more.click();
  await page.getByText("Preference saved.", { exact: true }).waitFor();
  assert.equal(await more.getAttribute("aria-pressed"), "true");

  await blue.getByRole("button", { name: "Save to library" }).click();
  await page.getByText("Saved to your library.", { exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll(".card .title-button")].some(
        (node) => node.textContent === "Beyond the Blue",
      ),
  );
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("folio:recommender")),
  );
  assert.ok(
    persisted.observations.some(
      (observation) =>
        observation.id === "https://multporn.net/comics/new-romance" &&
        observation.feedback === 1,
    ),
    "saving a recommendation keeps explicit taste history",
  );

  const other = page.locator(".card", { hasText: "Other Skies" });
  await other.getByRole("button", { name: "Hide" }).click();
  await page.getByText("Recommendation hidden.", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".card", { hasText: "Other Skies" }).count(),
    0,
  );

  const explore = page.locator("#explore input[type=range]");
  await explore.evaluate((input) => {
    input.value = "90";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelector("#ranking-status").textContent === "",
  );
  assert.equal(await explore.inputValue(), "90");
  await page.reload();
  await page.getByRole("button", { name: /For you/ }).click();
  await page.waitForFunction(
    () => document.querySelector("#ranking-status").textContent === "",
  );
  assert.equal(
    await page.locator("#explore input[type=range]").inputValue(),
    "90",
  );

  // Large passive catalog: recommendations remain off the UI thread.
  await page.evaluate(async () => {
    const send = async (items) => {
      const response = await chrome.runtime.sendMessage({
        type: "observeCatalog",
        authoritative: true,
        items,
      });
      if (!response.ok) throw new Error(response.error);
    };
    const items = Array.from({ length: 600 }, (_, i) => ({
      url: `https://multporn.net/comics/scale-candidate-${i}`,
      title: `Science Book ${i}`,
      tags: ["fiction", `genre-${i % 12}`, `topic-${i % 25}`],
      author: `Author ${i % 40}`,
      pageCount: 100 + (i % 50),
    }));
    for (let i = 0; i < items.length; i += 200)
      await send(items.slice(i, i + 200));
  });
  await page.reload();
  const workerCreated = page.waitForEvent("worker");
  await page.getByRole("button", { name: /For you/ }).click();
  await workerCreated;
  await page.waitForFunction(
    () =>
      document.querySelector("#ranking-status").textContent === "" &&
      document.querySelectorAll(".card").length >= 600,
  );

  const nextWorker = page.waitForEvent("worker");
  const responsiveness = await page.evaluate(async () => {
    const input = document.querySelector("#explore input");
    const start = performance.now();
    for (const value of [10, 50, 95]) {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    return performance.now() - start;
  });
  await nextWorker;
  assert.ok(
    responsiveness < 1000,
    `Slider input blocked the UI for ${responsiveness}ms`,
  );
  await page.waitForFunction(
    () => document.querySelector("#ranking-status").textContent === "",
  );
  assert.equal(
    await page.locator("#explore input[type=range]").inputValue(),
    "95",
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS: unsaved discovery, feedback/save/dismiss persistence, 600-candidate worker ranking; UI yielded in ${Math.round(responsiveness)}ms.`,
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
