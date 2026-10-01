import { newKey, seal, open, validatePair, endpoint } from "./crypto.js";
import { mergeDocuments } from "./model.js";
export async function createPair(relay, fetcher = fetch) {
  const origin = endpoint(relay);
  const response = await fetcher(origin + "/v1/vaults", {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "Could not create a private library (" + response.status + ")",
    );
  const value = await response.json();
  return validatePair({
    version: 1,
    relay: origin,
    vault: value.vault,
    token: value.token,
    key: newKey(),
  });
}
export async function syncRepository(repo, { fetcher = fetch, signal } = {}) {
  const pair = validatePair(await repo.get("pair"));
  const url = pair.relay + "/v1/vaults/" + pair.vault;
  const headers = { Authorization: "Bearer " + pair.token };
  const requestSignal = () =>
    signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000);
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetcher(url, {
      headers,
      credentials: "omit",
      redirect: "error",
      signal: requestSignal(),
    });
    if (!response.ok)
      throw new Error(
        "Sync could not read your library (" + response.status + ")",
      );
    const remote = await response.json();
    if (!Number.isSafeInteger(remote.revision) || remote.revision < 0)
      throw new Error("Invalid sync revision");
    const remoteDocument = remote.packet
      ? await open(remote.packet, pair)
      : null;
    if (remoteDocument) await repo.merge(remoteDocument);
    const local = await repo.document();
    if (
      remoteDocument &&
      JSON.stringify(local) === JSON.stringify(remoteDocument)
    ) {
      await repo.set("lastSync", Date.now());
      return local;
    }
    const packet = await seal(local, pair);
    const saved = await fetcher(url, {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "If-Match": String(remote.revision),
      },
      body: JSON.stringify(packet),
      credentials: "omit",
      redirect: "error",
      signal: requestSignal(),
    });
    if (saved.status === 409) continue;
    if (!saved.ok)
      throw new Error(
        "Sync could not save your library (" + saved.status + ")",
      );
    await repo.set("lastSync", Date.now());
    return local;
  }
  throw new Error("Another device is syncing. Try again shortly.");
}
export async function downloadTitle(
  repo,
  item,
  { fetcher = fetch, signal, onProgress = () => {} } = {},
) {
  if (!item.pages?.length)
    throw new Error(
      "Open this saved title on your computer once to share its page list, or import page images",
    );
  const blobs = [];
  let bytes = 0;
  for (let i = 0; i < item.pages.length; i++) {
    signal?.throwIfAborted();
    const response = await fetcher(item.pages[i], {
      credentials: "omit",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error("Page " + (i + 1) + " returned HTTP " + response.status);
    const blob = await response.blob();
    bytes += blob.size;
    if (
      !blob.type.startsWith("image/") ||
      blob.type === "image/svg+xml" ||
      blob.size > 25 * 1024 * 1024 ||
      bytes > 512 * 1024 * 1024
    )
      throw new Error("Download exceeds the supported image or storage limits");
    blobs.push(blob);
    onProgress(i + 1, item.pages.length);
  }
  signal?.throwIfAborted();
  return repo.keep(item.id, blobs);
}
