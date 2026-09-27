# Local recommender

Standalone, dependency-free ES modules for arbitrary caller-supplied media records.
The package does not import the host application's models or database. Ranking is
pure; storage and the optional DOM control are separate modules. Metadata is opaque
and never used for scoring. There are no network calls or automatic data collection.

## Interface

```js
import {
  createProfile,
  withFeedback,
  withExplore,
  withExclusions,
  recommend,
  createProfileStore,
} from "./index.js";
import { createExploreSlider } from "./slider.js";

const saved = {
  id: "observatory",
  title: "The Distant Observatory",
  authors: ["Alex North"],
  tags: ["science fiction", "space"],
  saved: true,
  liked: true,
  dismissed: false,
};
const candidates = [
  {
    id: "kingdom",
    title: "The Glass Kingdom",
    authors: ["Sam West"],
    tags: ["fantasy", "magic"],
    saved: false,
    liked: false,
    dismissed: false,
  },
  {
    id: "orbit",
    title: "Orbital Cities",
    authors: ["Alex North"],
    tags: ["science fiction", "space"],
    saved: false,
    liked: false,
    dismissed: false,
  },
];

let profile = createProfile([saved]);
profile = withFeedback(profile, candidates[0], 1); // -1 dislike, 0 neutral
profile = withExclusions(profile, { tags: ["mystery"] });
const results = recommend(candidates, profile, { limit: 10 });
// [{ item, score, components, explanations: string[] }]

// Optional browser persistence: explicitly supplied, never accessed on import.
const store = createProfileStore(window.localStorage, "my-app.preferences");
store.save(profile);
profile = store.load();
const slider = createExploreSlider({
  document,
  value: profile.explore,
  onChange(explore) {
    profile = store.save(withExplore(profile, explore));
    const updatedResults = recommend(candidates, profile);
    // Render updatedResults with the application's own UI.
  },
});
document.body.append(slider.element);
// slider.setValue(0.5) updates the control without triggering onChange.
// slider.destroy() removes the control and its listener.
```

Items require unique, nonempty string `id` and string `title`. `authors` and `tags`
default to empty arrays; `saved`, `liked`, and `dismissed` default to false. Optional
`engagement` is a number from 0 through 1 for inferred host activity such as reading.
Optional `metadata` is returned unchanged with the original item. Tags/authors are trimmed,
Unicode NFKC normalized, lowercased, deduplicated, and sorted. IDs remain exact and
case-sensitive. Unknown vocabulary is valid; no synonyms or domain assumptions exist.

`createProfile(items, { explore, exclusions })` snapshots caller-provided signals.
Candidate flags do not silently train the profile. `withFeedback(profile, item, value)`
upserts a fresh item snapshot and replaces previous feedback, without double-counting.
Use `null` to restore inferred feedback, `0` to explicitly neutralize it. To refresh
flags/tags for an observation, upsert the current item and its existing feedback.
Setting `dismissed: false` in that update undoes a stored dismissal. Helpers return
new profiles and never mutate inputs. Rebuilding with `createProfile` starts over;
load a persisted profile when retaining explicit feedback.

Saved items are omitted by default (override with `includeSaved: true`). Dismissal
in either the candidate or stored snapshot always filters the item. A dislike lowers
scores but is not an exclusion. `withExclusions` replaces the rules with arrays of
`ids`, `tags`, `authors`, and `tagCombinations` (each an array of two or more tags).
Any matching ID/tag/author excludes an item; a combination excludes it only when
all its tags are present. Exclusions and dismissals apply at every slider position.

## Scoring and explanations

- Signal strength is ordered intentionally: saved = +1, inferred engagement = +1..+2,
  liked/favorite = +3, and explicit feedback = -4/0/+4. Explicit feedback overrides
  inferred state; dismissal is a hard filter.
- Each tag, unordered tag pair, and author accumulates signed weights. Affinity is
  `sum(weights) / (sum(abs(weights)) + 2)`, providing bounded values and smoothing
  sparse evidence. All unordered pairs are learned, not larger combinations.
- Mean feature affinities contribute 60% tags, 25% pairs, 15% authors. Positive and
  negative parts are computed separately so exploration cannot erase negative evidence.
- Novelty is the fraction of candidate tags/authors absent from nonzero training
  signals. Untagged/unauthored items get no novelty bonus. Unknown features are not
  automatically assumed to be interesting; this is a transparent heuristic.
- At exploration `e` (0 through 1), base score is
  `(1 - .65e) * positiveAffinity - 1.2 * negativeAffinity + directFeedback + .55e * novelty`.
  Direct explicit item feedback adds +.3 or -.75 (neutral/absent = 0).
- Greedy selection subtracts `.45e * maximumSimilarityToEarlierSelections`.
  Similarity is `.8 * tagJaccard + .2 * authorJaccard`. This diversifies the selected
  list as Explore increases. Equal scores use exact ID ordering, not randomness or locale.

Each result contains the raw three affinity means, weighted positive/negative totals,
novelty, direct-feedback contribution, base score, diversity penalty, and final score.
Explanations summarize strongest matching/conflicting features and applicable novelty
and diversity effects. They are plain text: render using `textContent`, not HTML.
Scores are relative ranking values, not calibrated probabilities. Diversity penalties
depend on earlier selections; different candidate sets may produce different scores.
Empty profiles return deterministic candidates with an honest cold-start explanation.

## Storage and limits

Profiles have schema version 1 and contain only normalized feature snapshots, flags,
feedback, exclusions, and slider position; titles and metadata are not persisted.
`createProfileStore` accepts a synchronous `getItem`/`setItem`/`removeItem` interface.
Missing storage returns an empty profile. Invalid JSON, unsupported versions, quota
errors, and blocked storage throw to the caller; they never trigger a silent reset.
`save` validates before writing. `clear` removes only this profile's storage key.
The host should show failures and decide recovery. Storage is local, unencrypted, and
last-writer-wins across tabs; cross-tab merging is the host's responsibility.

The algorithm targets modest local collections. Pair learning is quadratic in tags per
item; greedy diversity selection caches each candidate’s maximum similarity and
compares only the newest selection on each iteration. It performs O(N × K)
similarity comparisons for N candidates and K requested results, plus sorting.
Hosts with large collections should run ranking in a worker.
No model downloads, dependencies, clocks, or random seeds are needed by the runtime.
The slider uses a native, labeled, keyboard-accessible range input, with an output and
accessible value text; style its returned `element` in the host UI.

Run deterministic neutral-fixture tests from the repository root:

```sh
npm run test:recommender
npm run check
```

Folio uses this package with two distinct inputs: its personal library becomes profile
observations, while a separate local catalog supplies unsaved candidates. Explicit
feedback snapshots are persisted independently of current library membership, so a
later save/remove transition does not erase taste history. Ranking runs in a worker;
the package itself remains unaware of Folio's source, database, and UI.

Hosts should keep inferred engagement separate from explicit feedback, keep dismissals
as hard exclusions, and preserve candidate/profile separation if they want Explore's
novelty term to be meaningful.
