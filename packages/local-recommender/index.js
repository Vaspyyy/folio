import {
  compare,
  exploration,
  record,
  validateProfile,
  weight,
} from "./profile.js";
export {
  createProfile,
  withFeedback,
  withExplore,
  withExclusions,
} from "./profile.js";
export { createProfileStore } from "./storage.js";

const pairs = (tags) =>
  tags.flatMap((tag, i) =>
    tags.slice(i + 1).map((other) => JSON.stringify([tag, other])),
  );
const mean = (values) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

function learn(observations) {
  const tables = { tags: new Map(), pairs: new Map(), authors: new Map() };
  for (const observation of observations) {
    const w = weight(observation);
    if (!w) continue;
    for (const [kind, features] of Object.entries({
      tags: observation.tags,
      pairs: pairs(observation.tags),
      authors: observation.authors,
    })) {
      for (const feature of features) {
        const stats = tables[kind].get(feature) ?? { sum: 0, mass: 0 };
        stats.sum += w;
        stats.mass += Math.abs(w);
        tables[kind].set(feature, stats);
      }
    }
  }
  return tables;
}

function affinity(features, table) {
  return features.map((feature) => {
    const stats = table.get(feature);
    return { feature, value: stats ? stats.sum / (stats.mass + 2) : 0 };
  });
}

function excluded(item, rules) {
  return (
    rules.ids.includes(item.id) ||
    item.tags.some((tag) => rules.tags.includes(tag)) ||
    item.authors.some((author) => rules.authors.includes(author)) ||
    rules.tagCombinations.some((tags) =>
      tags.every((tag) => item.tags.includes(tag)),
    )
  );
}

function jaccard(a, b) {
  const union = new Set([...a, ...b]);
  return union.size
    ? a.filter((value) => b.includes(value)).length / union.size
    : 0;
}

function similarity(a, b) {
  return 0.8 * jaccard(a.tags, b.tags) + 0.2 * jaccard(a.authors, b.authors);
}

function explain(details, components, explore) {
  const reasons = [];
  for (const [kind, features] of Object.entries(details)) {
    const label =
      kind === "pairs"
        ? "Tag combination"
        : kind === "authors"
          ? "Author"
          : "Tag";
    for (const { feature, value } of features
      .filter((v) => v.value !== 0)
      .sort(
        (a, b) =>
          Math.abs(b.value) - Math.abs(a.value) ||
          compare(a.feature, b.feature),
      )
      .slice(0, 2)) {
      const name = kind === "pairs" ? JSON.parse(feature).join(" + ") : feature;
      reasons.push(
        `${label} “${name}” ${value > 0 ? "matches your positive preferences" : "has negative feedback in your profile"}.`,
      );
    }
  }
  if (components.directFeedback > 0)
    reasons.push("You explicitly liked this item.");
  if (components.directFeedback < 0)
    reasons.push("Your negative feedback lowers this item's score.");
  if (components.novelty > 0 && explore > 0)
    reasons.push(
      "Explore boosts features not previously seen in your preference signals.",
    );
  if (components.diversityPenalty > 0)
    reasons.push(
      "Similarity to earlier recommendations lowers this item's position to add variety.",
    );
  if (!reasons.length)
    reasons.push(
      "No matching preference signals yet; this is an unpersonalized candidate.",
    );
  return reasons;
}

/** Rank caller-supplied items. No input mutation, I/O, randomness, or clocks. */
export function recommend(items, profile, options = {}) {
  const preferences = validateProfile(profile);
  const explore = exploration(options.explore ?? preferences.explore);
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 0)
    throw new RangeError("limit must be a nonnegative integer");
  if (
    options.includeSaved !== undefined &&
    typeof options.includeSaved !== "boolean"
  )
    throw new TypeError("includeSaved must be boolean");
  const tables = learn(preferences.observations);
  const observations = new Map(preferences.observations.map((v) => [v.id, v]));
  const ids = new Set();
  const pool = [];
  for (const item of items) {
    const normalized = record(item);
    if (ids.has(normalized.id)) throw new TypeError("Duplicate candidate id");
    ids.add(normalized.id);
    const observation = observations.get(normalized.id);
    if (
      normalized.dismissed ||
      observation?.dismissed ||
      excluded(normalized, preferences.exclusions)
    )
      continue;
    if (!options.includeSaved && (normalized.saved || observation?.saved))
      continue;
    const details = {
      tags: affinity(normalized.tags, tables.tags),
      pairs: affinity(pairs(normalized.tags), tables.pairs),
      authors: affinity(normalized.authors, tables.authors),
    };
    const components = {
      tagAffinity: 0,
      combinationAffinity: 0,
      authorAffinity: 0,
      positiveAffinity: 0,
      negativeAffinity: 0,
    };
    for (const [kind, coefficient, key] of [
      ["tags", 0.6, "tagAffinity"],
      ["pairs", 0.25, "combinationAffinity"],
      ["authors", 0.15, "authorAffinity"],
    ]) {
      const values = details[kind].map((v) => v.value);
      components[key] = mean(values);
      components.positiveAffinity +=
        coefficient * mean(values.map((v) => Math.max(0, v)));
      components.negativeAffinity +=
        coefficient * mean(values.map((v) => Math.max(0, -v)));
    }
    const features = [
      ...normalized.tags.map((v) => tables.tags.has(v)),
      ...normalized.authors.map((v) => tables.authors.has(v)),
    ];
    components.novelty = mean(features.map((known) => (known ? 0 : 1)));
    components.directFeedback = observation?.feedback
      ? observation.feedback * (observation.feedback > 0 ? 0.3 : 0.75)
      : 0;
    components.baseScore =
      (1 - 0.65 * explore) * components.positiveAffinity -
      1.2 * components.negativeAffinity +
      components.directFeedback +
      0.55 * explore * components.novelty;
    pool.push({ item, normalized, details, components });
  }
  // Greedy maximum-marginal-relevance selection. Tie-breaking is locale-independent.
  const selected = [];
  const result = [];
  while (pool.length && result.length < limit) {
    for (const candidate of pool) {
      candidate.components.diversityPenalty =
        0.45 *
        explore *
        Math.max(
          0,
          ...selected.map((other) => similarity(candidate.normalized, other)),
        );
      candidate.score =
        candidate.components.baseScore - candidate.components.diversityPenalty;
    }
    pool.sort((a, b) => b.score - a.score || compare(a.item.id, b.item.id));
    const winner = pool.shift();
    selected.push(winner.normalized);
    result.push({
      item: winner.item,
      score: winner.score,
      components: { ...winner.components },
      explanations: explain(winner.details, winner.components, explore),
    });
  }
  return result;
}
