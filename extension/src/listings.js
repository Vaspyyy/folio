import { extractListingItems } from "./adapters/multporn.js";
import { request } from "./client.js";
export function installListingControls() {
  let timer,
    busy = false;
  const labels = {
    planned: "Want to read",
    reading: "Reading",
    finished: "Finished",
    dropped: "Dropped",
  };
  async function scan() {
    if (busy) return;
    busy = true;
    try {
      const items = extractListingItems(document, location.href);
      if (items.length)
        await request("observeCatalog", {
          items: items.map(({ mount, ...metadata }) => metadata),
          authoritative: false,
        });
      const statuses = new Map();
      for (let i = 0; i < items.length; i += 100)
        for (const record of await request("listingStatus", {
          urls: items.slice(i, i + 100).map((x) => x.url),
        }))
          statuses.set(record.url, record.status);
      for (const item of items) {
        let host = item.mount.querySelector(":scope > .folio-listing-control");
        if (host) {
          host._folioUpdate?.(statuses.get(item.url));
          continue;
        }
        host = document.createElement("span");
        host.className = "folio-listing-control";
        const shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML =
          "<style>:host{display:block;margin:7px 0}button{font:12px system-ui;background:#e6eadb;color:#234333;border:1px solid #9cac90;padding:7px 10px;border-radius:6px;cursor:pointer}button:disabled{cursor:default;opacity:.8}</style>";
        const button = document.createElement("button");
        button.type = "button";
        shadow.append(button);
        const update = (status) => {
          button.textContent = status
            ? `Saved · ${labels[status]}`
            : "+ Save to Folio";
          button.disabled = !!status;
        };
        host._folioUpdate = update;
        update(statuses.get(item.url));
        button.onclick = async (event) => {
          event.preventDefault();
          event.stopPropagation();
          button.disabled = true;
          try {
            const { mount, ...metadata } = item;
            const saved = await request("saveListing", { metadata });
            update(saved.status);
          } catch (error) {
            button.disabled = false;
            button.textContent = "Retry saving";
            button.title = error.message;
          }
        };
        item.mount.append(host);
      }
    } catch {
      /* A reload may be needed after an extension update. */
    } finally {
      busy = false;
    }
  }
  new MutationObserver((records) => {
    if (
      !records.some((r) =>
        [...r.addedNodes].some(
          (n) => n.nodeType === 1 && !n.matches?.(".folio-listing-control"),
        ),
      )
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(scan, 300);
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("focus", scan);
  scan();
}
