import { canonicalUrl } from "../core/model.js";
import { snapshotMetadata } from "../adapters/multporn.js";
export async function fetchMetadata(url, signal) {
  const response = await fetch(canonicalUrl(url), {
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
  return snapshotMetadata(template.content, url);
}
