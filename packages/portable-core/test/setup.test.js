import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { phoneOrigins } from "../../../apps/relay/network.js";
import { createRelay } from "../../../apps/relay/server.mjs";
import {
  computerHelperOrigin,
  findComputer,
  rememberPhoneAddress,
  phonePairingCode,
} from "../setup.js";
import { openRepository } from "../repository.js";
import { newKey, parsePairingCode } from "../crypto.js";

const interfaces = {
  en0: [{ family: "IPv4", internal: false, address: "192.168.1.8" }],
  wlan0: [{ family: "IPv4", internal: false, address: "192.168.1.9" }],
  docker0: [{ family: "IPv4", internal: false, address: "172.17.0.1" }],
  lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
  public: [{ family: "IPv4", internal: false, address: "203.0.113.2" }],
};
test("computer helper advertises Wi-Fi first, omits virtual/public addresses, and never advertises a loopback-only listener", () => {
  assert.deepEqual(phoneOrigins({ host: "0.0.0.0", port: 1234, interfaces }), [
    "http://192.168.1.9:1234",
    "http://192.168.1.8:1234",
  ]);
  assert.deepEqual(
    phoneOrigins({ host: "127.0.0.1", port: 1234, interfaces }),
    [],
  );
  assert.deepEqual(
    phoneOrigins({ host: "192.168.1.8", port: 1234, interfaces }),
    ["http://192.168.1.8:1234"],
  );
  assert.deepEqual(
    phoneOrigins({ host: "0.0.0.0", port: 443, tls: true, interfaces }),
    [],
  );
  assert.deepEqual(
    phoneOrigins({
      host: "0.0.0.0",
      publicOrigin: "https://sync.example.com",
      interfaces,
    }),
    ["https://sync.example.com"],
  );
  assert.throws(() =>
    phoneOrigins({ publicOrigin: "https://sync.example.com/path" }),
  );
});
test("custom helper ports stay local to the computer", () => {
  assert.equal(
    computerHelperOrigin("http://127.0.0.1:4321"),
    "http://127.0.0.1:4321",
  );
  assert.throws(
    () => computerHelperOrigin("https://remote.example.com"),
    /local computer address/,
  );
});
test("missing, outdated and phone-unreachable helpers produce actionable setup errors", async () => {
  await assert.rejects(
    findComputer(undefined, async () => {
      throw new Error("Failed to fetch");
    }),
    /helper isn't running/,
  );
  await assert.rejects(
    findComputer(undefined, async () =>
      Response.json({ product: "other", version: 1, phoneOrigins: [] }),
    ),
    /Update the Folio/,
  );
  await assert.rejects(
    findComputer(undefined, async () =>
      Response.json({
        product: "folio-computer",
        version: 1,
        phoneOrigins: [],
      }),
    ),
    /Connect your computer to Wi-Fi/,
  );
  await assert.rejects(
    findComputer(undefined, async () =>
      Response.json({
        product: "folio-computer",
        version: 1,
        phoneOrigins: ["javascript:alert(1)"],
      }),
    ),
  );
});
test("phone pairing codes preserve credentials while replacing computer-local connection addresses; stale addresses cannot cross vaults", async () => {
  const repo = await openRepository("setup-" + crypto.randomUUID());
  const pair = {
    version: 1,
    relay: "http://127.0.0.1:8787",
    vault: "a".repeat(32),
    key: newKey(),
    token: newKey(),
  };
  try {
    await rememberPhoneAddress(repo, pair, "http://192.168.1.9:8787");
    assert.deepEqual(parsePairingCode(await phonePairingCode(repo, pair)), {
      ...pair,
      relay: "http://192.168.1.9:8787",
    });
    assert.equal(pair.relay, "http://127.0.0.1:8787");
    const different = {
      ...pair,
      vault: "b".repeat(32),
      relay: "https://sync.example.com",
    };
    assert.deepEqual(
      parsePairingCode(await phonePairingCode(repo, different)),
      different,
    );
    await rememberPhoneAddress(repo, pair);
    assert.deepEqual(
      parsePairingCode(await phonePairingCode(repo, pair)),
      pair,
    );
  } finally {
    repo.db.close();
  }
});
test("real helper setup uses its actual listening port, exposes no credentials and obeys origin checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "folio-setup-"));
  const server = await createRelay({
    host: "0.0.0.0",
    port: 0,
    dataDir: dir,
    interfaces,
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    const info = await findComputer(origin);
    assert.equal(
      info.phoneOrigin,
      "http://192.168.1.9:" + server.address().port,
    );
    const response = await fetch(origin + "/v1/setup");
    const raw = await response.json();
    assert.deepEqual(Object.keys(raw).sort(), [
      "phoneOrigins",
      "product",
      "version",
    ]);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(
      (
        await fetch(origin + "/v1/setup", {
          headers: { Origin: "https://unrelated.example" },
        })
      ).status,
      403,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
