import { recommend } from "../../../packages/local-recommender/index.js";

self.onmessage = ({ data: { items, profile } }) => {
  try {
    self.postMessage({
      results: recommend(items, profile, {
        includeSaved: false,
        limit: items.length,
      }),
    });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
