import { test } from "node:test";
import assert from "node:assert/strict";
import { metadata, personal } from "../src/core/model.js";
import {
  STORAGE_KEY,
  createRecommendationEngine,
  inferredFeedback,
  signals,
} from "../src/core/recommender.js";

const store = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
  };
};
const url = (slug) => `https://multporn.net/comics/${slug}`;
const entry = (slug, tags, options = {}) => ({
  metadata: metadata({
    url: url(slug),
    title: slug,
    tags,
    author: options.author,
  }),
  personal: {
    id: url(slug),
    ...personal({
      status: options.status,
      page: options.page,
      favorite: options.favorite,
    }),
  },
});
const candidate = (slug, tags, options = {}) => ({
  ...metadata({
    url: url(slug),
    title: slug,
    tags,
    author: options.author,
    pageCount: options.pageCount,
  }),
  firstSeenAt: 1,
  lastSeenAt: 2,
  detailObservedAt: 2,
});
const order = (results) => [...results.keys()];

test("library state becomes profile evidence while only unsaved catalog titles are candidates", () => {
  const engine = createRecommendationEngine({ storage: store() });
  const seed = entry("read-space", ["space", "furry"], {
    status: "finished",
    page: 30,
    author: "Alex North",
  });
  const close = candidate("new-space", ["space", "furry"], {
    author: "Alex North",
  });
  const far = candidate("new-fantasy", ["fantasy"]);
  const results = engine.update([seed], [far, close]);
  assert.equal(results.size, 2);
  assert.ok(!results.has(seed.metadata.id));
  assert.equal(order(results)[0], close.id);
  assert.equal(signals(seed).item.saved, true);
  assert.equal(signals(seed).item.engagement, 1);
  assert.equal(inferredFeedback(seed.personal), 1);
});

test("explicit preference history survives the source title leaving the library", () => {
  const storage = store();
  const seed = entry("seed", ["space", "furry"], {
    status: "finished",
    page: 20,
  });
  const close = candidate("close", ["space", "furry"]);
  const far = candidate("far", ["history"]);
  const engine = createRecommendationEngine({ storage });
  engine.update([seed], [close, far]);
  engine.rate(seed.metadata, 1);

  const reopened = createRecommendationEngine({ storage });
  const results = reopened.update([], [far, close]);
  assert.equal(reopened.rating(seed.metadata.id), 1);
  assert.equal(order(results)[0], close.id);
  assert.equal(
    JSON.parse(storage.getItem(STORAGE_KEY)).observations[0].saved,
    false,
    "explicit history is not tied to current library membership",
  );
});

test("explicit candidate feedback persists across save-like candidate removal", () => {
  const storage = store();
  const target = candidate("target", ["fantasy"]);
  const sibling = candidate("sibling", ["fantasy"]);
  const engine = createRecommendationEngine({ storage });
  engine.update([], [target, sibling]);
  engine.rate(target, 1);
  assert.equal(engine.rating(target.id), 1);

  const reopened = createRecommendationEngine({ storage });
  reopened.update(
    [entry("target", ["fantasy"], { status: "planned" })],
    [target, sibling],
  );
  assert.ok(!reopened.results().has(target.id), "saved title is no longer a candidate");
  assert.equal(reopened.rating(target.id), 1, "explicit preference is retained");
});

test("dismissal is a hard candidate exclusion and can be restored", () => {
  const engine = createRecommendationEngine({ storage: store() });
  const a = candidate("a", ["space"]);
  const b = candidate("b", ["fantasy"]);
  engine.update([], [a, b]);
  engine.dismiss(a.id);
  assert.equal(engine.isDismissed(a.id), true);
  assert.ok(!engine.results().has(a.id));
  engine.setExplore(1);
  assert.ok(!engine.results().has(a.id));
  engine.restore(a.id);
  assert.equal(engine.isDismissed(a.id), false);
  assert.ok(engine.results().has(a.id));
});

test("explicit choices survive reload and clearing removes only that choice", () => {
  const storage = store();
  const target = candidate("target", ["fantasy"]);
  const engine = createRecommendationEngine({ storage });
  engine.update([], [target]);
  engine.rate(target, -1);
  const reopened = createRecommendationEngine({ storage });
  reopened.update([], [target]);
  assert.equal(reopened.rating(target.id), -1);
  reopened.rate(target, null);
  assert.equal(createRecommendationEngine({ storage }).rating(target.id), null);
});

test("a broken, future, or unwritable profile surfaces instead of resetting silently", () => {
  const broken = store();
  broken.setItem(STORAGE_KEY, "{not json");
  assert.throws(
    () => createRecommendationEngine({ storage: broken }),
    SyntaxError,
  );
  const future = store();
  future.setItem(STORAGE_KEY, JSON.stringify({ version: 99 }));
  assert.throws(
    () => createRecommendationEngine({ storage: future }),
    /Unsupported or invalid preference profile/,
  );
  const blocked = store();
  blocked.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  const blockedEngine = createRecommendationEngine({ storage: blocked });
  blockedEngine.update([], [candidate("a", ["space"])]);
  assert.throws(
    () => blockedEngine.rate(candidate("a", ["space"]), 1),
    /Quota/,
  );
  assert.equal(blockedEngine.rating(url("a")), null);
});

test("async ranking cannot replace newer candidate results with an obsolete response", async () => {
  const jobs = [];
  const engine = createRecommendationEngine({
    rank: (items, profile) =>
      new Promise((resolve) => jobs.push({ items, profile, resolve })),
  });
  const old = engine.update([], [candidate("old", ["fiction"])]);
  const latest = engine.update(
    [entry("seed", ["fantasy"], { status: "finished" })],
    [candidate("new", ["fantasy"])],
  );
  assert.equal(jobs[1].profile.observations[0].engagement, 1);
  assert.equal(jobs[1].profile.observations[0].feedback, null);
  jobs[1].resolve([
    { item: jobs[1].items[0], score: 1, explanations: ["New"] },
  ]);
  await latest;
  jobs[0].resolve([
    { item: jobs[0].items[0], score: 0, explanations: ["Old"] },
  ]);
  await old;
  assert.deepEqual([...engine.results().keys()], [url("new")]);
});

test("600 unsaved candidates rank within a generous local budget", () => {
  const library = [
    entry("seed", ["fiction", "genre-1", "topic-1"], {
      status: "finished",
      favorite: true,
      author: "Author 1",
    }),
  ];
  const candidates = Array.from({ length: 600 }, (_, i) =>
    candidate(
      `book-${i}`,
      ["fiction", `genre-${i % 12}`, `topic-${i % 25}`],
      { author: `Author ${i % 40}` },
    ),
  );
  const engine = createRecommendationEngine();
  const start = performance.now();
  assert.equal(engine.update(library, candidates).size, 600);
  assert.ok(
    performance.now() - start < 2000,
    "600 candidates should remain practical even without the UI worker",
  );
});
