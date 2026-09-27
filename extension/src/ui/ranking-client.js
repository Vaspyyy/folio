// Terminate superseded work instead of queuing obsolete slider positions.
export function createWorkerRanker(
  createWorker = () =>
    new Worker(new URL("./ranking-worker.js", import.meta.url), {
      type: "module",
    }),
) {
  let cancel;
  return (items, profile) => {
    cancel?.();
    return new Promise((resolve, reject) => {
      const worker = createWorker();
      let settled = false;
      const finish = (error, results) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        cancel = undefined;
        if (error) reject(error);
        else resolve(results);
      };
      cancel = () =>
        finish(new DOMException("Ranking superseded", "AbortError"));
      worker.onmessage = ({ data }) =>
        finish(data.error ? new Error(data.error) : null, data.results);
      worker.onerror = (event) => {
        event.preventDefault();
        finish(new Error(event.message || "Ranking worker failed"));
      };
      worker.onmessageerror = () =>
        finish(new Error("Could not read ranking results"));
      try {
        worker.postMessage({ items, profile });
      } catch (error) {
        finish(error);
      }
    });
  };
}
