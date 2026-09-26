import { createProfile, validateProfile } from "./profile.js";

/** Explicitly inject localStorage or a synchronous getItem/setItem/removeItem adapter. */
export function createProfileStore(
  storage,
  key = "local-recommender.profile.v1",
) {
  if (
    !storage ||
    ["getItem", "setItem", "removeItem"].some(
      (method) => typeof storage[method] !== "function",
    )
  )
    throw new TypeError("A local storage adapter is required");
  if (typeof key !== "string" || !key.trim())
    throw new TypeError("A storage key is required");
  return {
    load() {
      const raw = storage.getItem(key);
      return raw === null ? createProfile() : validateProfile(JSON.parse(raw));
    },
    save(profile) {
      // Validate before touching storage. Corruption and write failures are surfaced.
      const clean = validateProfile(profile);
      storage.setItem(key, JSON.stringify(clean));
      return clean;
    },
    clear() {
      storage.removeItem(key);
    },
  };
}
