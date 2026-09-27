// Bridge between Folio's personal library, passive source catalog and the
// standalone local recommender. The package remains source-agnostic.
import {
  createProfile,
  createProfileStore,
  recommend,
  withExplore,
  withExclusions,
  withFeedback,
} from "../../../packages/local-recommender/index.js";

export const STORAGE_KEY = "folio:recommender";
export { createExploreSlider } from "../../../packages/local-recommender/slider.js";

const memory = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
  };
};

// Kept as a small exported helper for tests and host code. It is engagement,
// not explicit preference feedback.
export function inferredFeedback(personal) {
  if (personal.status === "finished") return 1;
  if (personal.status === "reading" && personal.page > 0) return 1;
  return null;
}

const authors = (value) =>
  String(value || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

export function signals(entry) {
  const engagement = inferredFeedback(entry.personal);
  return {
    item: {
      id: entry.metadata.id,
      title: entry.metadata.title,
      tags: entry.metadata.tags || [],
      authors: authors(entry.metadata.author),
      saved: true,
      liked: entry.personal.favorite === true,
      dismissed: entry.personal.status === "dropped",
      engagement: engagement ?? 0,
    },
    feedback: engagement,
  };
}

export function candidateItem(metadata) {
  return {
    id: metadata.id,
    title: metadata.title,
    tags: metadata.tags || [],
    authors: authors(metadata.author),
    saved: false,
    liked: false,
    dismissed: false,
    engagement: 0,
  };
}

function explicitOnly(profile) {
  // Saved/dismissed are current application state, not permanent explicit
  // preference. Persist only the feature snapshot plus feedback.
  return {
    ...profile,
    observations: profile.observations.map((observation) => ({
      ...observation,
      saved: false,
      liked: false,
      dismissed: false,
      engagement: 0,
    })),
  };
}

export function createRecommendationEngine({
  storage,
  key = STORAGE_KEY,
  rank = (items, profile) =>
    recommend(items, profile, { includeSaved: false, limit: items.length }),
} = {}) {
  const store = createProfileStore(storage || memory(), key);
  let library = [];
  let catalog = [];
  let explicit = explicitOnly(store.load());
  let results = new Map();
  let revision = 0;

  function buildProfile() {
    const current = createProfile(
      library.map((entry) => signals(entry).item),
      {
        explore: explicit.explore,
        exclusions: explicit.exclusions,
      },
    );
    const byId = new Map(
      current.observations.map((observation) => [observation.id, observation]),
    );
    const candidateSnapshots = new Map(
      catalog.map((metadata) => [metadata.id, candidateItem(metadata)]),
    );
    for (const choice of explicit.observations) {
      // Refresh the stored feature snapshot from current library/catalog
      // metadata when possible, but keep the explicit feedback itself.
      const snapshot =
        byId.get(choice.id) || candidateSnapshots.get(choice.id) || choice;
      byId.set(choice.id, {
        ...snapshot,
        feedback: choice.feedback,
      });
    }
    return {
      ...current,
      observations: [...byId.values()],
    };
  }

  function candidatePool() {
    const saved = new Set(library.map((entry) => entry.metadata.id));
    return catalog
      .filter((metadata) => metadata?.id && !saved.has(metadata.id))
      .map(candidateItem);
  }

  function rebuild() {
    const currentRevision = ++revision;
    const items = candidatePool();
    const profile = buildProfile();
    const finish = (ranked) => {
      const next = new Map(
        ranked.map(({ item, score, explanations }) => [
          item.id,
          { score, explanations },
        ]),
      );
      if (currentRevision === revision) results = next;
      return next;
    };
    const ranked = rank(items, profile);
    return ranked instanceof Promise ? ranked.then(finish) : finish(ranked);
  }

  const persist = (next) => {
    explicit = explicitOnly(store.save(explicitOnly(next)));
    return explicit;
  };

  return {
    update(nextLibrary, nextCatalog = []) {
      library = (nextLibrary || []).filter((entry) => entry?.metadata?.id);
      catalog = (nextCatalog || []).filter((entry) => entry?.id);
      return rebuild();
    },
    results: () => results,
    rating: (id) =>
      explicit.observations.find((observation) => observation.id === id)
        ?.feedback ?? null,
    explore: () => explicit.explore,
    isDismissed: (id) => explicit.exclusions.ids.includes(id),
    setExplore(value) {
      persist(withExplore(explicit, value));
      return rebuild();
    },
    rate(value, feedback) {
      const item = value?.metadata
        ? value.personal
          ? signals(value).item
          : candidateItem(value.metadata)
        : candidateItem(value);
      if (feedback === null) {
        persist({
          ...explicit,
          observations: explicit.observations.filter(
            (observation) => observation.id !== item.id,
          ),
        });
      } else {
        persist(withFeedback(explicit, item, feedback));
      }
      return rebuild();
    },
    dismiss(id) {
      const ids = [...new Set([...explicit.exclusions.ids, id])];
      persist(
        withExclusions(explicit, {
          ...explicit.exclusions,
          ids,
        }),
      );
      return rebuild();
    },
    restore(id) {
      persist(
        withExclusions(explicit, {
          ...explicit.exclusions,
          ids: explicit.exclusions.ids.filter((value) => value !== id),
        }),
      );
      return rebuild();
    },
  };
}
