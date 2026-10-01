const pending = new Map();
window.folioImageResult = (id, data, error) => {
  const job = pending.get(id);
  if (!job) return;
  pending.delete(id);
  job.cleanup();
  if (error) {
    job.reject(new Error(error));
    return;
  }
  try {
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    job.resolve(
      new Response(new Blob([bytes], { type: data.type }), { status: 200 }),
    );
  } catch (e) {
    job.reject(e);
  }
};
export function imageFetch(url, options = {}) {
  if (!window.FolioImages) return fetch(url, options);
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const abort = () => {
      pending.delete(id);
      window.FolioImages.cancel(id);
      reject(options.signal.reason);
    };
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    pending.set(id, { resolve, reject, cleanup });
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      window.FolioImages.fetch(id, url);
    } catch (e) {
      pending.delete(id);
      cleanup();
      reject(e);
    }
  });
}
