import { validateDocument } from "./model.js";
export function base64(bytes) {
  let s = "";
  for (const v of bytes) s += String.fromCharCode(v);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unbase64(value) {
  if (
    typeof value !== "string" ||
    !value ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length > 12000000
  )
    throw new Error("Invalid encoded data");
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
export const newKey = () => base64(crypto.getRandomValues(new Uint8Array(32)));
export function endpoint(value) {
  const u = new URL(value);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw new Error("Enter the relay origin, such as https://sync.example.com");
  return u.origin;
}
export function validatePair(value) {
  if (
    value?.version !== 1 ||
    !/^[a-f0-9]{32}$/.test(value.vault) ||
    !value.token ||
    unbase64(value.token).length !== 32 ||
    unbase64(value.key).length !== 32
  )
    throw new Error("Invalid pairing code");
  return {
    version: 1,
    relay: endpoint(value.relay),
    vault: value.vault,
    token: value.token,
    key: value.key,
  };
}
export const pairingCode = (value) =>
  "folio1." +
  base64(new TextEncoder().encode(JSON.stringify(validatePair(value))));
export function parsePairingCode(value) {
  if (!value.trim().startsWith("folio1."))
    throw new Error("Paste a Folio pairing code");
  return validatePair(
    JSON.parse(new TextDecoder().decode(unbase64(value.trim().slice(7)))),
  );
}
const keyFor = (key) =>
  crypto.subtle.importKey("raw", unbase64(key), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
export async function seal(doc, pair) {
  const p = validatePair(pair),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode("folio:v1:" + p.vault),
    },
    await keyFor(p.key),
    new TextEncoder().encode(JSON.stringify(validateDocument(doc))),
  );
  return {
    version: 1,
    iv: base64(iv),
    data: base64(new Uint8Array(encrypted)),
  };
}
export async function open(packet, pair) {
  const p = validatePair(pair);
  if (packet?.version !== 1 || unbase64(packet.iv).length !== 12)
    throw new Error("Invalid encrypted library");
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unbase64(packet.iv),
      additionalData: new TextEncoder().encode("folio:v1:" + p.vault),
    },
    await keyFor(p.key),
    unbase64(packet.data),
  );
  return validateDocument(JSON.parse(new TextDecoder().decode(plain)));
}
