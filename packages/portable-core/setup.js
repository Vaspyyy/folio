import { endpoint, pairingCode } from "./crypto.js";

export const COMPUTER_HELPER = "http://127.0.0.1:8787";
export function computerHelperOrigin(value = COMPUTER_HELPER) {
  const origin = endpoint(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname))
    throw new Error("The computer helper must use a local computer address");
  return origin;
}
export async function findComputer(origin = COMPUTER_HELPER, fetcher = fetch) {
  const address = endpoint(origin);
  let info;
  try {
    const response = await fetcher(address + "/v1/setup", {
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Helper unavailable");
    info = await response.json();
  } catch {
    throw new Error(
      "The Folio computer helper isn't running yet. Follow the setup steps below, then try Connect this computer again.",
    );
  }
  if (
    info?.product !== "folio-computer" ||
    info.version !== 1 ||
    !Array.isArray(info.phoneOrigins)
  )
    throw new Error("Update the Folio computer helper, then try again.");
  const addresses = info.phoneOrigins.map(endpoint);
  if (!addresses.length)
    throw new Error(
      "This helper cannot be reached by a phone yet. Connect your computer to Wi-Fi, stop the existing helper, and start npm run sync:computer. Or configure an HTTPS sync server in Advanced.",
    );
  return { computerOrigin: address, phoneOrigin: addresses[0] };
}
export async function rememberPhoneAddress(repo, pair, origin = null) {
  await repo.set(
    "phoneAddress",
    origin ? { vault: pair.vault, origin: endpoint(origin) } : null,
  );
}
export async function phonePairingCode(repo, pair) {
  const address = await repo.get("phoneAddress");
  return pairingCode(
    address?.vault === pair.vault ? { ...pair, relay: address.origin } : pair,
  );
}
