import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  createProfile,
  withFeedback,
  withExplore,
  withExclusions,
  recommend,
  createProfileStore,
} from "../index.js";
import { createExploreSlider } from "../slider.js";

const book = (id, tags = [], extra = {}) => ({
  id,
  title: id,
  authors: [],
  tags,
  saved: false,
  liked: false,
  dismissed: false,
  ...extra,
});
const seed = book("The Distant Observatory", ["science fiction", "space"], {
  saved: true,
  liked: true,
  authors: ["Alex North"],
});
const familiar = book(
  "Return to the Observatory",
  ["science fiction", "space"],
  { authors: ["Alex North"] },
);
const fantasy = book("The Glass Kingdom", ["fantasy", "magic"], {
  authors: ["Sam West"],
});
const programming = book("Practical Programming", ["programming", "education"]);
const mystery = book("The Missing Clock", ["mystery", "detective"]);
const ids = (results) => results.map((v) => v.item.id);
const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test("Familiar prioritizes established tags; Explore admits unfamiliar candidates", () => {
  const profile = createProfile([seed]);
  const candidates = [fantasy, familiar, programming];
  assert.equal(
    recommend(candidates, profile, { explore: 0 })[0].item.id,
    familiar.id,
  );
  assert.notEqual(
    recommend(candidates, profile, { explore: 1 })[0].item.id,
    familiar.id,
  );
  const result = recommend(candidates, profile, { explore: 1 }).find(
    (v) => v.item.id === familiar.id,
  );
  assert.ok(result.components.tagAffinity > 0);
  assert.ok(result.components.combinationAffinity > 0);
  assert.ok(result.components.authorAffinity > 0);
});

test("repeated saved tags outweigh incidental tags without needing explicit likes", () => {
  const profile = createProfile([
    book("Orbital Cities", ["science fiction"], { saved: true }),
    book("Distant Worlds", ["science fiction"], { saved: true }),
    book("The Lantern", ["fantasy"], { saved: true }),
  ]);
  const result = recommend(
    [book("A", ["fantasy"]), book("Z", ["science fiction"])],
    profile,
    { explore: 0 },
  );
  assert.deepEqual(ids(result), ["Z", "A"]);
});

test("pair affinity distinguishes learned combinations with identical marginal affinities", () => {
  const profile = createProfile([
    book("Science Mystery", ["science fiction", "mystery"], { liked: true }),
    book("Fantasy History", ["fantasy", "history"], { liked: true }),
  ]);
  const result = recommend(
    [
      book("A unseen pairing", ["science fiction", "history"]),
      book("Z familiar pairing", ["science fiction", "mystery"]),
    ],
    profile,
    { explore: 0 },
  );
  assert.equal(result[0].item.id, "Z familiar pairing");
  assert.equal(
    result[0].components.tagAffinity,
    result[1].components.tagAffinity,
  );
  assert.ok(
    result[0].components.combinationAffinity >
      result[1].components.combinationAffinity,
  );
  assert.ok(
    result[0].explanations.some((v) => v.startsWith("Tag combination")),
  );
});

test("author affinity works independently of tags", () => {
  const profile = createProfile([seed]);
  const result = recommend(
    [
      book("A unknown", [], { authors: ["Other Author"] }),
      book("Z known", [], { authors: ["Alex North"] }),
    ],
    profile,
    { explore: 0 },
  );
  assert.equal(result[0].item.id, "Z known");
  assert.ok(result[0].explanations.some((v) => v.startsWith("Author")));
});

test("explicit feedback is replaceable, reversible, and outweighs saved inference", () => {
  const base = createProfile([seed]);
  const before = JSON.stringify(base);
  const negative = withFeedback(base, seed, -1);
  const candidates = [familiar, fantasy];
  assert.equal(
    recommend(candidates, negative, { explore: 0 })[0].item.id,
    fantasy.id,
  );
  const positive = withFeedback(negative, seed, 1);
  assert.equal(positive.observations.length, 1);
  assert.equal(
    recommend(candidates, positive, { explore: 0 })[0].item.id,
    familiar.id,
  );
  assert.deepEqual(
    recommend(candidates, withFeedback(positive, seed, null)),
    recommend(candidates, base),
  );
  assert.equal(JSON.stringify(base), before);
  assert.equal(
    recommend(candidates, withFeedback(base, seed, 0), { explore: 0 })[0]
      .components.positiveAffinity,
    0,
  );
});

test("negative feedback remains effective at maximum exploration, even for untagged items", () => {
  const disliked = book("A disliked");
  const profile = withFeedback(createProfile(), disliked, -1);
  const results = recommend([disliked, book("Z neutral")], profile, {
    explore: 1,
  });
  assert.deepEqual(ids(results), ["Z neutral", "A disliked"]);
  assert.ok(
    results[1].explanations.some((v) => v.includes("negative feedback")),
  );
  const tagsProfile = withFeedback(createProfile(), programming, -1);
  assert.equal(
    recommend([book("A similar", ["programming"]), mystery], tagsProfile, {
      explore: 1,
    })[0].item.id,
    mystery.id,
  );
});

test("dismissal filters both incoming flags and stored state; disliked is not dismissed", () => {
  const dismissed = { ...fantasy, dismissed: true };
  const profile = withFeedback(createProfile([dismissed]), mystery, -1);
  assert.deepEqual(
    ids(
      recommend(
        [fantasy, mystery, { ...programming, dismissed: true }],
        profile,
      ),
    ),
    [mystery.id],
  );
  const restored = withFeedback(
    profile,
    { ...fantasy, dismissed: false },
    null,
  );
  assert.ok(ids(recommend([fantasy], restored)).includes(fantasy.id));
});

test("all exclusions are hard filters at both slider endpoints", () => {
  const candidates = [
    familiar,
    fantasy,
    programming,
    mystery,
    book("Forbidden combination", ["history", "magic"]),
    book("Allowed single tag", ["history"]),
  ];
  const profile = withExclusions(createProfile(), {
    ids: [programming.id],
    tags: ["MYSTERY"],
    authors: [" Alex North "],
    tagCombinations: [
      ["magic", "fantasy"],
      ["magic", "history"],
    ],
  });
  for (const explore of [0, 1])
    assert.deepEqual(ids(recommend(candidates, profile, { explore })), [
      "Allowed single tag",
    ]);
});

test("Explore spreads the slate across categories instead of repeating near duplicates", () => {
  const candidates = [
    book("A fantasy one", ["fantasy"], { authors: ["Taylor"] }),
    book("B fantasy two", ["fantasy"], { authors: ["Taylor"] }),
    programming,
    mystery,
  ];
  const profile = createProfile();
  assert.deepEqual(
    ids(recommend(candidates, profile, { explore: 0, limit: 2 })),
    ["A fantasy one", "B fantasy two"],
  );
  const varied = recommend(candidates, profile, { explore: 1 });
  assert.equal(varied.at(-1).item.id, "B fantasy two");
  assert.ok(varied.at(-1).components.diversityPenalty > 0);
  assert.ok(varied.at(-1).explanations.some((v) => v.includes("variety")));
});

test("scores are auditable, explanations exist for every result, and metadata stays opaque", () => {
  const candidate = {
    ...familiar,
    metadata: { category: "arbitrary", nested: [1, 2] },
  };
  const input = [candidate, fantasy, programming, mystery];
  const snapshot = structuredClone(input);
  const result = recommend(input, createProfile([seed]), { explore: 0.5 });
  for (const row of result) {
    const c = row.components;
    assert.equal(row.score, c.baseScore - c.diversityPenalty);
    assert.ok(row.explanations.length);
    assert.ok(Number.isFinite(row.score));
  }
  assert.deepEqual(input, snapshot);
  assert.equal(
    result.find((v) => v.item.id === candidate.id).item.metadata,
    candidate.metadata,
  );
  assert.deepEqual(
    recommend([book("Plain")], createProfile())[0].explanations,
    [
      "No matching preference signals yet; this is an unpersonalized candidate.",
    ],
  );
});

test("normalization deduplicates tags and authors; feature keys cannot collide", () => {
  const clean = createProfile([seed]);
  const noisy = createProfile([
    {
      ...seed,
      tags: [" SPACE ", "space", "SCIENCE FICTION"],
      authors: [" ALEX NORTH ", "Alex North"],
    },
  ]);
  assert.deepEqual(recommend([familiar], noisy), recommend([familiar], clean));
  const special = book("Prototype names", ["__proto__", "constructor", "a+b"]);
  const result = recommend(
    [book("Candidate", special.tags)],
    createProfile([{ ...special, liked: true }]),
  );
  assert.ok(result[0].components.tagAffinity > 0);
});

test("stable ordering is independent of input and observation order; limits form a prefix", () => {
  const candidates = [fantasy, familiar, programming, mystery];
  const seeds = [seed, { ...programming, liked: true }];
  const result = recommend(candidates, createProfile(seeds), { explore: 0.6 });
  assert.deepEqual(
    recommend([...candidates].reverse(), createProfile([...seeds].reverse()), {
      explore: 0.6,
    }),
    result,
  );
  assert.deepEqual(
    recommend(candidates, createProfile(seeds), { explore: 0.6, limit: 2 }),
    result.slice(0, 2),
  );
  assert.deepEqual(recommend([], createProfile()), []);
  assert.deepEqual(recommend(candidates, createProfile(), { limit: 0 }), []);
});

test("saved items are excluded by default, with an explicit override", () => {
  assert.deepEqual(recommend([seed], createProfile()), []);
  assert.deepEqual(
    recommend([{ ...seed, saved: false }], createProfile([seed])),
    [],
  );
  assert.equal(
    recommend([seed], createProfile([seed]), { includeSaved: true }).length,
    1,
  );
});

test("storage round-trips all preferences and reproduces ranking after reopening", () => {
  const storage = memoryStorage();
  const store = createProfileStore(storage);
  let profile = withExplore(
    withFeedback(createProfile([seed]), programming, -1),
    0.7,
  );
  profile = withExclusions(profile, { tags: ["mystery"] });
  store.save(profile);
  const loaded = createProfileStore(storage).load();
  assert.deepEqual(loaded, profile);
  assert.deepEqual(
    recommend([familiar, fantasy, programming, mystery], loaded),
    recommend([familiar, fantasy, programming, mystery], profile),
  );
  assert.equal(
    createProfileStore(storage, "other").load().observations.length,
    0,
  );
  store.clear();
  assert.deepEqual(store.load(), createProfile());
});

test("storage surfaces corrupt, future, and failed writes without erasing existing data", () => {
  const storage = memoryStorage();
  const store = createProfileStore(storage, "test");
  for (const value of [
    "{broken",
    JSON.stringify({ version: 99, observations: [] }),
  ]) {
    storage.setItem("test", value);
    assert.throws(() => store.load());
    assert.equal(storage.getItem("test"), value);
  }
  store.save(createProfile());
  const before = storage.getItem("test");
  assert.throws(() => store.save({ version: 99 }));
  assert.equal(storage.getItem("test"), before);
  const failing = createProfileStore({
    ...storage,
    setItem() {
      throw new Error("quota");
    },
  });
  assert.throws(() => failing.save(createProfile()), /quota/);
});

test("invalid input is rejected explicitly", () => {
  for (const explore of [NaN, Infinity, -1, 1.1, "0.5"])
    assert.throws(() => withExplore(createProfile(), explore));
  assert.throws(
    () => recommend([fantasy, fantasy], createProfile()),
    /Duplicate/,
  );
  assert.throws(() => createProfile([seed, seed]), /Duplicate/);
  assert.throws(() => createProfile([book("", [])]));
  assert.throws(() => createProfile([book("Invalid", [1])]));
  assert.throws(() => createProfile([book("Invalid", [], { liked: "true" })]));
  assert.throws(() => withFeedback(createProfile(), seed, 2));
  assert.throws(() =>
    withExclusions(createProfile(), { tagCombinations: [["fantasy"]] }),
  );
  assert.throws(() => recommend([], createProfile(), { limit: -1 }));
  assert.throws(() => recommend([], createProfile(), { includeSaved: "yes" }));
});

test("slider emits normalized values, updates accessible labels, persists, and can be removed", () => {
  const dom = new JSDOM("<main></main>");
  const document = dom.window.document;
  const store = createProfileStore(memoryStorage());
  let profile = store.load();
  let changes = 0;
  const slider = createExploreSlider({
    document,
    value: profile.explore,
    onChange(value) {
      changes++;
      profile = store.save(withExplore(profile, value));
    },
  });
  document.querySelector("main").append(slider.element);
  assert.equal(slider.input.type, "range");
  assert.equal(slider.input.getAttribute("aria-label"), "Familiar to Explore");
  slider.input.value = "80";
  slider.input.dispatchEvent(new dom.window.Event("input"));
  assert.equal(profile.explore, 0.8);
  assert.equal(store.load().explore, 0.8);
  assert.match(slider.input.getAttribute("aria-valuetext"), /80% Explore/);
  slider.setValue(0);
  assert.equal(slider.input.value, "0");
  assert.equal(changes, 1);
  slider.setValue(1);
  assert.equal(
    slider.element.querySelector("output").textContent,
    "100% Explore",
  );
  assert.throws(() => slider.setValue(2));
  slider.destroy();
  slider.input.dispatchEvent(new dom.window.Event("input"));
  assert.equal(changes, 1);
  assert.equal(document.querySelector("main").children.length, 0);
  dom.window.close();
});

test("incremental diversity matches a full-prefix reference scan", () => {
  const items = Array.from({ length: 36 }, (_, i) =>
    book(`book-${i}`, ["fiction", `genre-${i % 7}`, `topic-${i % 5}`], {
      authors: [`Author ${i % 4}`],
    }),
  );
  const profile = createProfile([
    { ...seed, tags: ["fiction", "genre-1"], liked: true },
  ]);
  const jaccard = (a, b) =>
    a.filter((v) => b.includes(v)).length / new Set([...a, ...b]).size;
  for (const explore of [0, 0.25, 0.9, 1]) {
    const pool = items.map((item) => ({
      item,
      base: recommend([item], profile, { explore })[0].components.baseScore,
    }));
    const expected = [];
    while (pool.length) {
      for (const candidate of pool) {
        const max = Math.max(
          0,
          ...expected.map(
            ({ item }) =>
              0.8 * jaccard(candidate.item.tags, item.tags) +
              0.2 * jaccard(candidate.item.authors, item.authors),
          ),
        );
        candidate.score = candidate.base - 0.45 * explore * max;
      }
      pool.sort(
        (a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : 1),
      );
      expected.push(pool.shift());
    }
    const actual = recommend(items, profile, { explore, limit: items.length });
    assert.deepEqual(
      ids(actual),
      expected.map(({ item }) => item.id),
    );
    for (let i = 0; i < actual.length; i++)
      assert.ok(Math.abs(actual[i].score - expected[i].score) < 1e-12);
  }
});
