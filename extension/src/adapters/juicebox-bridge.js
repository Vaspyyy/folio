// Runs in the site's MAIN world. Only reader state/navigation crosses this boundary;
// no extension APIs, library data, arbitrary methods, URLs, or script evaluation.
const CHANNEL = "folio:juicebox:v1";
window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const m = event.data;
  if (
    m?.channel !== CHANNEL ||
    m.direction !== "request" ||
    typeof m.id !== "string" ||
    m.id.length > 100
  )
    return;
  if (!["state", "resume"].includes(m.action)) return;
  let state = null;
  try {
    const gallery = window.jcgal;
    const total = Number(gallery?.getImageCount?.());
    if (Number.isInteger(total) && total > 0 && total <= 1000000) {
      if (
        m.action === "resume" &&
        Number.isInteger(m.page) &&
        m.page >= 1 &&
        m.page <= total
      ) {
        gallery.showImage(m.page);
        for (
          let attempt = 0;
          attempt < 30 && Number(gallery.getImageIndex()) !== m.page;
          attempt++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      const page = Number(gallery.getImageIndex());
      if (Number.isInteger(page) && page >= 1 && page <= total)
        state = { page, total };
    }
  } catch {
    /* The gallery may still be initializing. */
  }
  window.postMessage(
    { channel: CHANNEL, direction: "response", id: m.id, state },
    location.origin,
  );
});
