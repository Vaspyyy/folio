import { networkInterfaces } from "node:os";

const localAddress = (address) => {
  const parts = address.split(".").map(Number);
  return (
    parts.length === 4 &&
    parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168))
  );
};
export function phoneOrigins({
  host,
  port,
  tls,
  publicOrigin,
  interfaces = networkInterfaces(),
}) {
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("FOLIO_PUBLIC_ORIGIN must be an HTTPS origin");
    return [url.origin];
  }
  // A loopback-only listener cannot be reached from a phone. HTTPS uses a
  // configured public name, since a trusted certificate must match that name.
  if (tls || ["localhost", "127.0.0.1", "::1"].includes(host)) return [];
  const names = Object.keys(interfaces)
    .filter(
      (name) => !/^(lo|docker|veth|br-|virbr|tun|tap|tailscale|wg)/.test(name),
    )
    .sort(
      (a, b) =>
        Number(!/^wl/.test(a)) - Number(!/^wl/.test(b)) || a.localeCompare(b),
    );
  const addresses = names
    .flatMap((name) => interfaces[name] ?? [])
    .filter(
      (entry) =>
        !entry.internal &&
        (entry.family === "IPv4" || entry.family === 4) &&
        localAddress(entry.address),
    )
    .map((entry) => entry.address)
    .filter(
      (address) => host === "0.0.0.0" || host === "::" || address === host,
    );
  return [...new Set(addresses)]
    .slice(0, 16)
    .map((address) => `http://${address}:${port}`);
}
