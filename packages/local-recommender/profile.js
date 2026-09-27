export const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function strings(values, name, normalize = true) {
  if (
    !Array.isArray(values) ||
    values.some((v) => typeof v !== "string" || !v.trim())
  )
    throw new TypeError(`${name} must be an array of nonempty strings`);
  return [
    ...new Set(
      values.map((v) =>
        normalize ? v.trim().normalize("NFKC").toLowerCase() : v,
      ),
    ),
  ].sort(compare);
}

export function exploration(value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new RangeError("explore must be a number between 0 and 1");
  return value;
}

export function record(item) {
  if (
    !item ||
    typeof item.id !== "string" ||
    !item.id.trim() ||
    typeof item.title !== "string"
  )
    throw new TypeError(
      "Items require a nonempty string id and a string title",
    );
  for (const key of ["saved", "liked", "dismissed"])
    if (item[key] !== undefined && typeof item[key] !== "boolean")
      throw new TypeError(`${key} must be boolean`);
  if (
    item.engagement !== undefined &&
    (typeof item.engagement !== "number" ||
      !Number.isFinite(item.engagement) ||
      item.engagement < 0 ||
      item.engagement > 1)
  )
    throw new TypeError("engagement must be a number between 0 and 1");
  return {
    id: item.id,
    tags: strings(item.tags ?? [], "tags"),
    authors: strings(item.authors ?? [], "authors"),
    saved: item.saved === true,
    liked: item.liked === true,
    dismissed: item.dismissed === true,
    engagement: item.engagement ?? 0,
  };
}

function exclusions(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid exclusions");
  const tagCombinations = value.tagCombinations ?? [];
  if (!Array.isArray(tagCombinations))
    throw new TypeError("Invalid tag combinations");
  return {
    ids: strings(value.ids ?? [], "excluded ids", false),
    tags: strings(value.tags ?? [], "excluded tags"),
    authors: strings(value.authors ?? [], "excluded authors"),
    tagCombinations: tagCombinations.map((pair) => {
      const tags = strings(pair, "excluded tag combination");
      if (tags.length < 2)
        throw new TypeError(
          "Excluded combinations require at least two distinct tags",
        );
      return tags;
    }),
  };
}

export function validateProfile(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.observations))
    throw new TypeError("Unsupported or invalid preference profile");
  const ids = new Set();
  const observations = value.observations
    .map((entry) => {
      const result = record({ ...entry, title: "" });
      if (ids.has(result.id)) throw new TypeError("Duplicate observation id");
      ids.add(result.id);
      const feedback = entry.feedback ?? null;
      if (![null, -1, 0, 1].includes(feedback))
        throw new TypeError("Feedback must be -1, 0, 1, or null");
      return { ...result, feedback };
    })
    .sort((a, b) => compare(a.id, b.id));
  return {
    version: 1,
    explore: exploration(value.explore),
    exclusions: exclusions(value.exclusions),
    observations,
  };
}

export function createProfile(items = [], options = {}) {
  return validateProfile({
    version: 1,
    explore: options.explore ?? 0.25,
    exclusions: options.exclusions,
    observations: items.map(record),
  });
}

// Explicit feedback overrides inferred saved/liked weights; null restores inference.
export function withFeedback(profile, item, feedback) {
  const next = validateProfile(profile);
  const observation = { ...record(item), feedback };
  next.observations = next.observations.filter((v) => v.id !== observation.id);
  next.observations.push(observation);
  return validateProfile(next);
}

export function withExplore(profile, explore) {
  return validateProfile({ ...profile, explore });
}

export function withExclusions(profile, rules) {
  return validateProfile({ ...profile, exclusions: exclusions(rules) });
}

export function weight(observation) {
  // Explicit choices are strongest. Favorites outrank inferred reading
  // engagement, which in turn outranks the weak signal of merely saving.
  if (observation.dismissed) return -4;
  if (observation.feedback !== null) return observation.feedback * 4;
  if (observation.liked) return 3;
  if (observation.engagement > 0) return 1 + observation.engagement;
  return observation.saved ? 1 : 0;
}
