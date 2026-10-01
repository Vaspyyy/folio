import { openRepository } from "../../../packages/portable-core/repository.js";
import { createPair } from "../../../packages/portable-core/sync.js";
import {
  parsePairingCode,
  endpoint,
} from "../../../packages/portable-core/crypto.js";
import {
  computerHelperOrigin,
  findComputer,
  rememberPhoneAddress,
  phonePairingCode,
} from "../../../packages/portable-core/setup.js";
import { request } from "../client.js";
const $ = (id) => document.getElementById(id);
const repo = await openRepository();
const helper = computerHelperOrigin(
  new URLSearchParams(location.search).get("computer") ?? undefined,
);
const status = (message) => ($("status").textContent = message);
const run =
  (fn) =>
  (...args) =>
    Promise.resolve(fn(...args)).catch((e) => status(e.message));
async function permission(origin) {
  const allowed = await chrome.permissions.request({
    origins: [endpoint(origin) + "/*"],
  });
  if (!allowed) throw new Error("Allow Folio to connect to the sync helper");
}
async function render() {
  const pair = await repo.get("pair");
  $("paired").hidden = !pair;
  $("unpaired").hidden = !!pair;
  $("pair-code").value = pair ? await phonePairingCode(repo, pair) : "";
  $("create").disabled = !!pair;
  $("join").disabled = !!pair;
  status(
    pair ? "Paired. Choose Sync now to send your library." : "Ready to pair.",
  );
}
async function sync() {
  status("Syncing your library and preparing reading pages…");
  const result = await request("mobileSync");
  status(
    result.pagesPending
      ? `Your library is in sync. ${result.pagesPending} titles still need reading pages. ${result.pagesFailed ? `Some pages could not be prepared: ${result.pageError}. Try Sync now again or open the title in your computer reader.` : "Keep the browser and helper running; preparation continues automatically."}`
      : "Your saved library is in sync.",
  );
}
$("connect-computer").onclick = run(async () => {
  $("connect-computer").disabled = true;
  status("Looking for Folio on this computer…");
  try {
    await permission(helper);
    const setup = await findComputer(helper);
    const pair = await createPair(setup.computerOrigin);
    await rememberPhoneAddress(repo, pair, setup.phoneOrigin);
    await repo.set("pair", pair);
    await render();
    await sync();
  } catch (error) {
    $("computer-help").open = true;
    throw error;
  } finally {
    $("connect-computer").disabled = false;
  }
});
$("create").onclick = run(async () => {
  await permission($("relay").value);
  const pair = await createPair($("relay").value);
  await rememberPhoneAddress(repo, pair);
  await repo.set("pair", pair);
  await render();
  await sync();
});
$("join").onclick = run(async () => {
  const pair = parsePairingCode($("join-code").value);
  await permission(pair.relay);
  await rememberPhoneAddress(repo, pair);
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
