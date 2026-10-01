# Portable library core

Domain-agnostic ES modules used by Folio's portable app and extension companion.
There are no catalog, scraping, or recommendation dependencies.

A record has `id`, `title`, `authors`, `tags`, `pages` (caller-supplied image URLs),
`pageCount`, `cover`, `sourceUrl`, `status`, `page`, `collections`, `notes`,
`favorite`, `queued`, and `deleted`. URLs are validated as HTTP(S), text is bounded,
and page counts/positions are nonnegative integers.

```js
import { openRepository } from "./repository.js";
import { createPair, syncRepository, downloadTitle } from "./sync.js";
import { pairingCode, parsePairingCode } from "./crypto.js";

const library = await openRepository("my-portable-library");
await library.edit("novel:1", {
  title: "The Observatory",
  status: "reading",
  page: 4,
  pages: ["https://my-media.example/page-1.png"],
});
const pair = await createPair("https://my-relay.example");
await library.set("pair", pair);
const code = pairingCode(pair); // transfer privately to your second device
await syncRepository(library);
await downloadTitle(library, (await library.items())[0]);
await library.forget("novel:1"); // removes local pages, keeps the title
```

`parsePairingCode` validates a transferred code. `Repository.edit` uses an atomic
read/modify/write transaction; `mergeDocuments` applies field-level revisions.
`seal`/`open` use authenticated AES-GCM and bind ciphertext to a vault. Transport
and download helpers accept injected fetch functions, signals, and progress
callbacks for deterministic tests and native hosts. Media bytes stay local.

`setup.js` discovers a running computer helper and creates phone-ready pairing
codes. `findComputer` reads only network connection metadata from `/v1/setup`;
`rememberPhoneAddress` binds the phone address to the current vault. The computer
can sync through localhost while its phone code points to the same server's
Wi-Fi or configured HTTPS address. Keys and credentials are generated locally
and are never included in the helper's setup response. Normal pairing does not
require address entry. Custom local helper ports are restricted to loopback hosts.

See [the app guide](../../apps/README.md) for deployment, Android building, privacy,
limitations, and validation. Run `npm run test:portable` from the repository root.
