# Folio Pocket: first standalone milestone

Folio now has a portable library and reader packaged as an Android application,
with the browser extension as a paired computer companion. Library metadata,
reading position, status, favorites, collections, notes, and the reading queue
sync through an encrypted relay. Selected page images are stored independently
on each device for offline reading.

The runtime is shared between Android's bundled WebView and the desktop browser
client. It has no dependencies on the extension's source adapters or recommender.
The extension sends only personally saved titles. No new source is implemented.

## Run the computer companion and relay

From the repository root, using Node 22+:

```sh
npm ci
npm run start:portable
```

Open `http://127.0.0.1:8787` for the portable desktop interface. The same server
hosts the encrypted sync API. Its private data directory defaults to
`.folio-relay/`, which is ignored by Git. Protect and back up this directory.

The default server binds to this computer only. For a phone to reach it, run it
on an address reachable by that phone. For local debug testing on the same Wi-Fi:

```sh
FOLIO_HOST=0.0.0.0 npm run start:portable
```

Use the computer's LAN address, for example `http://192.168.1.20:8787`, in the
pairing form. Keep the desktop browser interface on localhost: Web Crypto requires
a secure origin. The debug APK permits HTTP development connections. A release
APK requires HTTPS, as does normal cross-network use.

For HTTPS, use a trusted certificate, either in a reverse proxy or directly:

```sh
FOLIO_HOST=0.0.0.0 \
FOLIO_PUBLIC_ORIGIN=https://sync.example.com \
FOLIO_TLS_CERT=/path/to/certificate.pem \
FOLIO_TLS_KEY=/path/to/private-key.pem \
FOLIO_DATA=/path/to/private/relay-data \
node apps/relay/server.mjs
```

`FOLIO_PORT` selects a different port. Set `FOLIO_PUBLIC_ORIGIN` to the public
HTTPS origin when using a reverse proxy or serving the desktop client publicly.
Never commit the private key or relay data.
Deployment, a public hosted service, and certificate provisioning are not included
in this milestone. The relay must remain reachable for cross-device syncing;
reading downloaded titles and making local edits work while it is unavailable.

## Build and install Android

Requires Java 17 and an Android SDK with platform 35. The Gradle wrapper pins
Gradle 8.10.2 with its distribution checksum and Android Gradle Plugin 8.7.3.

```sh
npm run build:android
adb install -r build/android/Folio-debug.apk
```

Set `ANDROID_HOME` if the SDK is not at `~/Android/Sdk`. `FOLIO_GRADLE` can point to
an existing compatible Gradle executable; otherwise the included wrapper is used.
Android Studio can also open `apps/android` after `npm run build:portable`.

The generated APK is `build/android/Folio-debug.apk`. This is a debug-signed
installation artifact, not a store release. Build outputs are ignored by Git.
The app requires Android 8+ and an up-to-date Android System WebView supporting
Web Crypto, IndexedDB, and current AbortSignal APIs.

All interface assets ship inside the APK and open through a restricted local
HTTPS origin. External navigation opens in the system browser. File selection
uses Android's document picker; the app requests Internet access, not blanket
storage access. Page downloads use a bounded native image transport on Android,
so image hosts need not grant browser CORS access. Release builds prohibit
cleartext traffic; WebView debugging is enabled only in debug builds.

## First startup

The Android and standalone browser apps show a four-chapter tutorial on first
startup. It covers local use, pairing and relay setup, selected offline downloads,
and reading controls. Choose **Pair my library** to open Devices or **Use on this
device** to start locally. Completion and skipping are remembered on that device.
Reopen the tutorial from **Devices → Getting started**. No pairing or network
connection is required to read the guide.

## Pair and read

1. Rebuild and reload the extension (`npm run build`, then Reload in the browser's
   extension management page). Open **Your devices** from the library sidebar.
2. Enter the reachable relay address and choose **Create private library**. Allow
   the browser's access request for that specific relay origin.
3. Copy the pairing code. In Android, open **Devices**, paste it, and choose
   **Pair this device**. The code contains the encryption key and relay credential;
   share it only with your own devices and retain it if you need to restore access.
4. Open a saved title in the computer's Folio reader once. Its known page list is
   added to encrypted library sync. Choose **Sync now** on either side when you
   want to transfer immediately; the extension checks every minute and the mobile
   client checks every 20 seconds while open, on resume, and after local edits.
5. On the phone, open that title's details and choose **Keep offline**. Downloads
   run sequentially, show page progress, and can be cancelled. A failed or cancelled
   replacement keeps the previous complete copy.
6. Read in paged or continuous mode. Swipe or use the previous/next controls. Your
   reading position is saved locally and synced when a connection is available.
   Removing the download leaves the library title, notes, and progress intact.

You can also **Add a title**, save it, then **Import page images**. Images are
ordered by filename with numeric sorting. Local file bytes are not sent through
sync; import them independently on another device. Offline storage supports
raster images up to 25 MB per page, 512 MB per title, and 1,000 pages per title.
Storage quota failures are surfaced; existing complete downloads are preserved.

## Data and privacy

- `packages/portable-core/model.js`: versioned, source-neutral records. Individual
  fields carry Lamport revisions and a device identifier. Concurrent edits to
  different fields merge; edits to the same field resolve deterministically.
  Deletions propagate as tombstones. Progress follows field revisions rather
  than the maximum page number, so intentionally moving backward works. Concurrent
  offline edits to the same field resolve by revision and device ID; one wins.
- `repository.js`: transactional IndexedDB for the library, pairing state, and
  offline image blobs. Downloads and library records have independent lifecycles.
- `crypto.js`: AES-256-GCM, a fresh 96-bit nonce for each upload, and vault-specific
  authenticated data. Keys remain on paired devices. The relay cannot read titles,
  source URLs, notes, or progress.
- `sync.js`: authenticated, timeout-bounded fetches, optimistic revisions, and
  conflict retries. Unchanged libraries need no upload. Local edits survive errors.
- `apps/relay/server.mjs`: opaque encrypted snapshots, hashed bearer credentials,
  atomic disk writes, per-vault mutation serialization, body limits, basic request
  rate limits, and a bounded number of vaults. It serves the portable browser app.
- `extension/src/portable/bridge.js`: exports saved library changes and applies
  portable edits. Library-only settings such as follow baselines and cover choices
  remain owned by the extension. Unsaved catalog entries are not exported.

Artwork is off by default. **Hide library** conceals titles, artwork, details,
and pairing codes from the screen. This is a display preference, not an app lock.
Local storage is protected by the operating system's application sandbox; it is
not independently encrypted. Android cloud backup and device-transfer backup are disabled for this app.
The relay still sees connection times, encrypted snapshot sizes, and a random
vault ID. Possession of a pairing code grants access to that vault; disconnecting
one device is local and does not revoke codes already shared. A recovery account,
per-device revocation, and an audited production service are later work.

## Validation

```sh
npm run check
BROWSER_PATH=/usr/bin/brave npm run test:browser
npm run test:portable:browser
npm run test:companion
npm run build:android
```

Unit tests cover field merging, concurrent edits, deletion/restoration, encryption
and tampering, relay authentication and revision conflicts, persistent offline
storage, cancellation/failure preservation, and extension/phone round trips, including desktop edits made during a sync.
Browser tests use neutral synthetic books and images only. They pair separate
contexts, sync progress and notes, reload while offline, read cached images,
exercise continuous mode and privacy, and remove a download without deleting its
library entry. The companion suite uses the actual built extension and relay;
it simulates approving the browser's optional relay permission prompt.

The debug APK has been compiled locally. No Android phone or emulator was
connected during development; native document picking, image transport, and
full-screen behavior still need validation on a device. The browser suites
validate the shared reader and sync flows, not Android OS integration.

## Next work

A desktop install package, relay deployment, recovery/device revocation, encrypted
page-file sync, CBZ/PDF imports, background mobile sync while the app is closed,
and additional source adapters remain future milestones. The delivered first loop
is a paired library, private progress sync, and explicitly selected offline pages.
