// Bridge between Folio's library records and the standalone local recommender.
// This module owns the mapping and nothing else: ranking, profile shape, and
// persistence validation all stay inside packages/local-recommender.
import {
  createProfile,
  createProfileStore,
  recommend,
  withExplore,
  withFeedback,
} from "../../../packages/local-recommender/index.js";

export const STORAGE_KEY = "folio:recommender";

// The library UI imports both through this module so the package stays the only
// place that knows how ranking works.
export { createExploreSlider } from "../../../packages/local-recommender/slider.js";

// Storage is optional: without a working localStorage the engine still ranks,
// it just cannot remember the slider position or explicit feedback.
const memory = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
  };
};

// Reading a title to the end, or part-way, is a positive signal; dropping it is
// a dismissal. Status flags stay authoritative — this only adds engagement.
export function inferredFeedback(personal) {
  if (personal.status === "finished") return 1;
  if (personal.status === "reading" && personal.page > 0) return 1;
  return null;
}

/** One library record as the recommender sees it. Metadata itself is never scored. */
export function signals(entry) {
  return {
    item: {
      id: entry.metadata.id,
      title: entry.metadata.title,
      tags: entry.metadata.tags || [],
      authors: String(entry.metadata.author || "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      saved: true,
      liked: entry.personal.favorite === true,
      dismissed: entry.personal.status === "dropped",
    },
    feedback: inferredFeedback(entry.personal),
  };
}

/**
 * Ranks the current library. Inferred signals are recomputed from the library on
 * every update; only the explore position and explicit choices are persisted, so
 * a title that changes status never keeps a stale inferred weight.
 */
export function createRecommendationEngine({
  storage,
  key = STORAGE_KEY,
  rank = (items, profile) =>
    recommend(items, profile, { includeSaved: true, limit: items.length }),
} = {}) {
  const store = createProfileStore(storage || memory(), key);
  let entries = [];
  let explicit = store.load();
  let results = new Map();
  let revision = 0;
  function rebuild() {
    const current = ++revision;
    const mapped = entries.map(signals);
    const chosen = new Map(
      explicit.observations.map((observation) => [
        observation.id,
        observation.feedback,
      ]),
    );
    const profile = createProfile(
      mapped.map((entry) => entry.item),
      { explore: explicit.explore },
    );
    const inferred = new Map(
      mapped.map(({ item, feedback }) => [item.id, feedback]),
    );
    // Apply snapshots in one pass instead of revalidating and copying the whole
    // profile for every engaged title. The ranker validates the final profile.
    profile.observations = profile.observations.map((observation) => ({
      ...observation,
      feedback: chosen.has(observation.id)
        ? chosen.get(observation.id)
        : inferred.get(observation.id),
    }));
    const finish = (ranked) => {
      const next = new Map(
        ranked.map(({ item, score, explanations }) => [
          item.id,
          { score, explanations },
        ]),
      );
      if (current === revision) results = next;
      return next;
    };
    const ranked = rank(
      mapped.map((entry) => entry.item),
      profile,
    );
    return ranked instanceof Promise ? ranked.then(finish) : finish(ranked);
  }
  return {
    /** Rebuild the profile and the ranking for the supplied library records. */
    update(next) {
      entries = (next || []).filter((entry) => entry?.metadata?.id);
      return rebuild();
    },
    results: () => results,
    rating: (id) =>
      explicit.observations.find((observation) => observation.id === id)
        ?.feedback ?? null,
    explore: () => explicit.explore,
    setExplore(value) {
      explicit = store.save(withExplore(explicit, value));
      return rebuild();
    },
    /** value is 1, -1, or null to drop the explicit choice and restore inference. */
    rate(entry, value) {
      if (value === null)
        explicit = store.save({
          ...explicit,
          observations: explicit.observations.filter(
            (observation) => observation.id !== entry.metadata.id,
          ),
        });
      else
        explicit = store.save(
          withFeedback(explicit, signals(entry).item, value),
        );
      return rebuild();
    },
  };
}
