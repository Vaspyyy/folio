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
const order = (results) => [...results.keys()];

test("library records map onto recommender items and carry the inferred signals", () => {
  const reading = signals(
    entry("reading-title", ["Space", "Furry"], {
      status: "reading",
      page: 4,
      favorite: true,
      author: "Alex North, Sam West",
    }),
  );
  assert.deepEqual(reading.item, {
    id: url("reading-title"),
    title: "reading-title",
    tags: ["Space", "Furry"],
    authors: ["Alex North", "Sam West"],
    saved: true,
    liked: true,
    dismissed: false,
  });
  assert.equal(reading.feedback, 1);
  assert.equal(inferredFeedback({ status: "finished", page: 0 }), 1);
  assert.equal(inferredFeedback({ status: "reading", page: 0 }), null);
  assert.equal(inferredFeedback({ status: "dropped", page: 9 }), null);
  assert.equal(
    signals(entry("dropped-title", ["Space"], { status: "dropped" })).item
      .dismissed,
    true,
  );
});

test("ranking covers the library, explains each position, and drops dismissed titles", () => {
  const engine = createRecommendationEngine({ storage: store() });
  const finished = entry("known-long", ["space", "furry"], {
    status: "finished",
    page: 40,
  });
  const dropped = entry("dropped", ["space"], { status: "dropped" });
  const entries = [
    finished,
    entry("known-short", ["space", "furry"]),
    entry("known-weak", ["space"]),
    entry("f1", ["fantasy"]),
    entry("f2", ["fantasy"]),
    dropped,
  ];
  const results = engine.update(entries);
  assert.equal(results.size, 5, "a dismissed title is not recommended");
  assert.ok(!results.has(dropped.metadata.id));
  assert.equal(
    order(results)[0],
    finished.metadata.id,
    "the title with the strongest engagement leads",
  );
  for (const result of results.values()) {
    assert.ok(Number.isFinite(result.score));
    assert.equal(typeof result.explanations[0], "string");
    assert.ok(result.explanations[0].length > 0);
  }
  const again = createRecommendationEngine({ storage: store() });
  assert.deepEqual(order(again.update(entries)), order(results));
});

test("explore trades tag affinity for variety and remembers where it was left", () => {
  const storage = store();
  const engine = createRecommendationEngine({ storage });
  const entries = [
    entry("known", ["space", "furry"], { status: "finished", page: 40 }),
    entry("familiar", ["space", "furry"]),
    entry("adventurous", ["pirates", "steampunk"]),
  ];
  assert.equal(engine.explore(), 0.25);
  let results = engine.update(entries);
  const comfortable = order(results);
  const comfortableScore = results.get(url("known")).score;
  assert.equal(comfortable[0], url("known"));
  assert.equal(
    comfortable[1],
    url("familiar"),
    "the similar title follows at the default position",
  );
  engine.setExplore(0.9);
  results = engine.results();
  assert.equal(order(results)[0], url("known"));
  assert.equal(
    order(results)[1],
    url("adventurous"),
    "exploring promotes the dissimilar title instead",
  );
  assert.ok(
    results.get(url("known")).score < comfortableScore,
    "affinity is damped as explore rises",
  );
  const reopened = createRecommendationEngine({ storage });
  assert.equal(reopened.explore(), 0.9);
  assert.deepEqual(order(reopened.update(entries)), order(results));
  assert.throws(() => engine.setExplore(2), RangeError);
});

test("explicit feedback moves scores, reaches shared tags, and can be cleared", () => {
  const engine = createRecommendationEngine({ storage: store() });
  const entries = [
    entry("a", ["space"]),
    entry("b", ["space"]),
    entry("c", ["fantasy"]),
    entry("d", ["fantasy"]),
  ];
  const baseline = new Map(engine.update(entries));
  const target = entries[2];
  assert.equal(engine.rating(target.metadata.id), null);
  engine.rate(target, 1);
  assert.equal(engine.rating(target.metadata.id), 1);
  assert.ok(
    engine.results().get(target.metadata.id).score >
      baseline.get(target.metadata.id).score,
    "a positive choice raises the title",
  );
  engine.rate(target, -1);
  assert.ok(
    engine.results().get(target.metadata.id).score <
      baseline.get(target.metadata.id).score,
  );
  assert.ok(
    engine.results().get(url("d")).score < baseline.get(url("d")).score,
    "negative evidence reaches a sibling sharing the tag",
  );
  assert.ok(
    engine.results().has(target.metadata.id),
    "a dislike lowers the score, it is not an exclusion",
  );
  engine.rate(target, null);
  assert.equal(engine.rating(target.metadata.id), null);
  assert.equal(
    engine.results().get(target.metadata.id).score,
    baseline.get(target.metadata.id).score,
    "clearing restores the inferred ranking exactly",
  );
});

test("explicit choices survive a reload and outrank the inferred flags", () => {
  const storage = store();
  const target = entry("target", ["fantasy"]);
  const entries = [entry("space", ["space"]), target];
  const engine = createRecommendationEngine({ storage });
  engine.update(entries);
  engine.rate(target, 1);
  const scored = engine.results().get(target.metadata.id).score;
  const reopened = createRecommendationEngine({ storage });
  assert.equal(reopened.rating(target.metadata.id), 1);
  reopened.update(entries);
  assert.equal(reopened.results().get(target.metadata.id).score, scored);
  reopened.rate(target, null);
  assert.equal(reopened.rating(target.metadata.id), null);
  assert.equal(
    createRecommendationEngine({ storage }).rating(target.metadata.id),
    null,
    "clearing is persisted too",
  );
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
  blockedEngine.update([entry("a", ["space"])]);
  assert.throws(() => blockedEngine.rate(entry("a", ["space"]), 1), /Quota/);
  assert.equal(
    blockedEngine.rating(url("a")),
    null,
    "a failed write leaves the in-memory profile unchanged",
  );
  const offline = createRecommendationEngine();
  assert.equal(
    offline.update([entry("a", ["space"]), entry("b", ["space"])]).size,
    2,
  );
  assert.equal(offline.update([]).size, 0);
});

test("metadata is never a scoring feature", () => {
  const engine = createRecommendationEngine({ storage: store() });
  const results = engine.update([
    entry("space-title", ["space"]),
    entry("other-title", ["space"]),
  ]);
  const explanation = results.get(url("space-title")).explanations.join(" ");
  assert.match(explanation, /space/);
  assert.doesNotMatch(explanation, /other-title/);
});

test("records without usable metadata are skipped", () => {
  const engine = createRecommendationEngine({ storage: store() });
  assert.deepEqual(
    order(
      engine.update([{ metadata: null }, undefined, entry("a", ["space"])]),
    ),
    [url("a")],
  );
});
