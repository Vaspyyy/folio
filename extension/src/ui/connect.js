import { openRepository } from "../../../packages/portable-core/repository.js";
import { createPair } from "../../../packages/portable-core/sync.js";
import {
  parsePairingCode,
  pairingCode,
  endpoint,
} from "../../../packages/portable-core/crypto.js";
import { request } from "../client.js";
const $ = (id) => document.getElementById(id);
const repo = await openRepository();
const status = (message) => ($("status").textContent = message);
const run =
  (fn) =>
  (...args) =>
    Promise.resolve(fn(...args)).catch((e) => status(e.message));
async function permission(origin) {
  const allowed = await chrome.permissions.request({
    origins: [endpoint(origin) + "/*"],
  });
  if (!allowed) throw new Error("Allow access to your relay to enable sync");
}
async function render() {
  const pair = await repo.get("pair");
  $("paired").hidden = !pair;
  $("pair-code").value = pair ? pairingCode(pair) : "";
  $("create").disabled = !!pair;
  $("join").disabled = !!pair;
  status(
    pair ? "Paired. Choose Sync now to send your library." : "Ready to pair.",
  );
}
async function sync() {
  status("Syncing your private library…");
  await request("mobileSync");
  status("Your saved library is in sync.");
}
$("create").onclick = run(async () => {
  await permission($("relay").value);
  const pair = await createPair($("relay").value);
  await repo.set("pair", pair);
  await render();
  await sync();
});
$("join").onclick = run(async () => {
  const pair = parsePairingCode($("join-code").value);
  await permission(pair.relay);
  await repo.set("pair", pair);
  await render();
  await sync();
});
$("copy").onclick = run(async () => {
  await navigator.clipboard.writeText($("pair-code").value);
  status("Pairing code copied.");
});
$("sync").onclick = run(sync);
$("disconnect").onclick = run(async () => {
  if (!confirm("Disconnect this computer? Your saved library will stay here."))
    return;
  await repo.set("pair", null);
  await render();
});
await render();
