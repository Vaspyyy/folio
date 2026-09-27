import { canonicalUrl } from "../core/model.js";
import {
  detectTitle,
  snapshotMetadata,
} from "../adapters/multporn.js";

async function fetchRoot(url, signal) {
  const canonical = canonicalUrl(url);
  const response = await fetch(canonical, {
    signal: AbortSignal.any([
      signal || new AbortController().signal,
      AbortSignal.timeout(15000),
    ]),
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok) {
    const error = new Error(
      response.status === 429
        ? "Source rate limit reached; try again later"
        : `Source returned HTTP ${response.status}`,
    );
    error.rateLimited = response.status === 429;
    throw error;
  }
  const html = await response.text();
  if (html.length > 8_000_000) throw new Error("Source page is too large");
  const template = document.createElement("template");
  template.innerHTML = html;
  return { root: template.content, canonical };
}

export async function fetchMetadata(url, signal) {
  const { root, canonical } = await fetchRoot(url, signal);
  return snapshotMetadata(root, canonical);
}

// Discovery only needs trustworthy title metadata. Unlike an update check, it
// does not require a recoverable total page count before tags/authors are useful.
export async function fetchDiscoveryMetadata(url, signal) {
  const { root, canonical } = await fetchRoot(url, signal);
  const metadata = detectTitle(root, canonical);
  if (!metadata)
    throw new Error("This page does not expose supported title metadata");
  return metadata;
}
