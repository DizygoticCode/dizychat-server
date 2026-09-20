<p align="center">
  <img src="public/logo.svg" alt="DizyChat logo" width="112" />
</p>

<h1 align="center">DizyChat</h1>

<p align="center"><strong>Home-hosted real-time chat, media, calls and community control — without a Big Tech social platform in the middle.</strong></p>

<p align="center">
  <a href="https://dizychat.com"><img alt="Live" src="https://img.shields.io/badge/live-dizychat.com-22c55e" /></a>
  <a href="https://github.com/DizygoticCode/dizychat-server/actions/workflows/self-host-ui-test.yml"><img alt="Self-Host CI" src="https://github.com/DizygoticCode/dizychat-server/actions/workflows/self-host-ui-test.yml/badge.svg" /></a>
  <a href="https://github.com/DizygoticCode/dizychat-server/actions/workflows/android-slice1-ci.yml"><img alt="Android CI" src="https://github.com/DizygoticCode/dizychat-server/actions/workflows/android-slice1-ci.yml/badge.svg" /></a>
  <a href="https://github.com/DizygoticCode/dizychat-server/actions/workflows/ios-capacitor-ci.yml"><img alt="iOS CI" src="https://github.com/DizygoticCode/dizychat-server/actions/workflows/ios-capacitor-ci.yml/badge.svg" /></a>
</p>

<p align="center">
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=000" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=fff" />
  <img alt="Socket.IO" src="https://img.shields.io/badge/Socket.IO-4.8-010101?logo=socketdotio&logoColor=fff" />
  <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb&logoColor=fff" />
  <img alt="Capacitor" src="https://img.shields.io/badge/Capacitor-7.4-119EFF?logo=capacitor&logoColor=fff" />
  <img alt="Android" src="https://img.shields.io/badge/Android-signed_APK-3DDC84?logo=android&logoColor=fff" />
  <img alt="iOS" src="https://img.shields.io/badge/iOS-native_path-000000?logo=apple&logoColor=fff" />
  <img alt="LiveKit" src="https://img.shields.io/badge/LiveKit-self--hosted-111827" />
</p>

<p align="center">
  <a href="https://dizychat.com">Live site</a> ·
  <a href="https://github.com/DizygoticCode/dizychat-server/releases/tag/v1.0.0">Android APK</a> ·
  <a href="#iphone--ipad-home-screen-web-app">iPhone / iPad install</a> ·
  <a href="docs/ios-native.md">Native iOS</a> ·
  <a href="deploy/livekit/README.md">Self-hosted LiveKit</a> ·
  <a href="scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js">Rumble companion</a>
</p>

DizyChat is a **home-hosted, self-managed real-time community platform** built with Express, Socket.IO and MongoDB. The deployed core runs on infrastructure controlled by the project rather than on a third-party chat or social platform: room/account authority, MongoDB state, message history, uploads and quarantine, media processing, moderation, and the realtime stack stay under DizyChat control.

External providers are deliberately scoped integrations rather than the foundation of the product. Services such as mobile push delivery, GIPHY, Watch2Gether, Rumble embeds, or optional jam providers can extend a room, but they do not own the community's accounts, rooms, history, uploads, or moderation state.

### Platform snapshot

| Surface | Current status | Runtime / distribution |
| --- | --- | --- |
| **Core server** | Live | Home/self-hosted Express + Socket.IO + MongoDB, local ClamAV/FFmpeg media pipeline |
| **Web app** | Live | https://dizychat.com with registered accounts, guest access, Web Push and server-managed frontend |
| **iPhone / iPad** | Live | Safari **Add to Home Screen** standalone app with supported Web Push |
| **Android** | Signed tester release | Thin Capacitor shell, signed sideload APK, server-managed SHA-256-verified web bundle |
| **Native iOS** | Build-ready | Capacitor path validated in CI for Simulator and unsigned physical-device builds; not yet distributed as a signed IPA |
| **Live calls** | Live/self-hosted path | Room-scoped LiveKit voice/video, screen sharing and Music Mode |

### What is in the stack

| Area | DizyChat capability |
| --- | --- |
| **Identity & rooms** | Registered accounts or confirmed guests first, then public/private room selection; account and room passwords remain separate |
| **Messaging** | Persistent paginated history, replies, edits, deletes, reactions, pins, stars, search, typing and read/delivery state |
| **Media safety** | Private upload quarantine, mandatory clean local ClamAV verdict before promotion, FFmpeg normalization and native-aware media URLs |
| **Notifications** | Browser sounds, VAPID Web Push, Android FCM actions, and the native iOS Firebase/APNs path |
| **Live communication** | Self-hosted LiveKit calls, voice/webcam, screen sharing, Normal/Music audio modes, plus optional JackTrip/SonoBus launchers |
| **Community extras** | GIPHY, custom emoji, local soundboards plus live 101Soundboards search/preview/send, Psybin Radio, inline previews, Rumble companion tools and Watch2Gether |

> **UI verification:** relevant pull requests run the Self-Host browser suite, which captures current desktop/mobile screenshots and a Playwright video as GitHub Actions artifacts. See the [Self-Host CI workflow](https://github.com/DizygoticCode/dizychat-server/actions/workflows/self-host-ui-test.yml).

## Current platform

### Realtime chat and rooms
- **Socket.IO** provides bidirectional messaging, typing indicators, message delivery/read state and live room membership updates.
- MongoDB persists chat history, reactions, replies, pins, stars and room/account state.
- History is fetched in bounded pages so clients can load older messages without pulling the entire room at once.
- Rooms support passwords, per-room bans, blocks and timed mutes; empty ad-hoc rooms are trimmed automatically.

### Accounts and recovery
- Public users can create registered DizyChat accounts from the login UI.
- Registered accounts use server-authoritative authentication rather than trusting a client-supplied username.
- Recovery email and password-reset flows are supported without exposing mail-provider credentials to the browser.
- Native mobile clients use durable secure session storage: Android uses its native secure-session boundary and the iOS path uses Keychain. Closing/reopening the app does not normally force another login; explicit logout and server-declared invalid/revoked sessions clear the stored native session.

### Messaging and media
- Messages support editing, deletion, reactions, replies, pinning, starring and search.
- Uploads use the existing `/upload` contract and are written to a private quarantine first.
- Every completed upload must receive a clean local ClamAV verdict before it is atomically promoted into the public upload store.
- Voice messages are normalized for broad browser/mobile playback compatibility.
- Custom emoji/GIF assets, uploaded images/audio/video and soundboard audio work in normal browsers and across the native Capacitor runtime boundaries.
- The GIPHY picker is proxied through DizyChat so the GIPHY key stays server-side.
- The soundboard picker has **Local** and **Web** modes: local clips come from JSON catalogs under `data/soundboards` via `/soundboard-clips`, while Web mode searches 101Soundboards from inside DizyChat, lets users browse matching boards, preview clips and send resolved clips directly into the current chat. Owner accounts can also import one clip or a whole board into the local catalog.

### Notifications
- Browser users can enable lightweight new-message sounds, with the preference stored locally.
- Supported browsers/Home Screen installs can also use Web Push through the DizyChat service worker and VAPID-backed subscription endpoints.
- The Android app supports FCM-backed room notifications with room/message tap routing, inline **Reply** and **Mark as read** actions.
- The native iOS path is wired for Firebase Messaging/APNs with room/message tap routing, token rotation, **Reply**, **Mark as read**, background read-control handling and cold-launch routing.
- Notification state is reconciled per room so stale/out-of-order controls do not clear unread state by guessing.

### LiveKit calls and Music Mode
- DizyChat supports room-scoped LiveKit audio calls with optional camera video.
- The current deployment uses the self-hosted LiveKit service documented in [`deploy/livekit/README.md`](deploy/livekit/README.md); cloud mode remains an optional deployment choice.
- Normal voice mode uses browser voice processing such as echo cancellation, noise suppression and automatic gain control.
- **Music Mode** is selected per connection before joining. While joining/connected the choice is locked; after disconnect it resets so the next call requires a fresh Normal/Music choice.
- Music Mode requests **48 kHz stereo** capture with echo cancellation, noise suppression and automatic gain control disabled, uses a **510 kb/s Opus target/max**, forces stereo, and disables DTX and RED.
- Music Mode also checks the captured track settings and refuses to publish if browser voice processing remains enabled after strict constraints are reapplied.
- `510 kb/s` is the application publish target/max, not a promise that every network path will transmit exactly that bitrate; the effective encoder rate still depends on LiveKit/WebRTC conditions.

### iPhone / iPad Home Screen web app
DizyChat does not require an App Store build on iPhone or iPad. Open **https://dizychat.com** in Safari and use the built-in **Install on iPhone** guidance:

1. Tap **Share**.
2. Choose **Add to Home Screen**.
3. Tap **Add**.

The installed web app launches in standalone mode at the DizyChat login screen. The helper is shown only for eligible iPhone/iPad browser sessions and is hidden once DizyChat is already running standalone. On supported iOS versions, the Home Screen app can use Web Push after the user grants notification permission.

### Native iOS app path
DizyChat now also has a reproducible **Capacitor iOS native build path** using bundle ID `com.chat.dizychat`. CI generates the Xcode project, links Firebase Messaging, applies the DizyChat Swift/native bridges, and validates both an iOS Simulator build and an unsigned `iphoneos` device build.

The native iOS path currently includes:

- Keychain-backed durable session storage;
- native external-link handling and iOS camera/microphone permission boundaries;
- the same server-managed, SHA-256-verified web-bundle activation/fallback model used by Android;
- Firebase Messaging/APNs registration and token rotation;
- tap-to-open, **Reply** and **Mark as read** notification actions;
- background read-control reconciliation; and
- cold-launch notification routing.

This is **build-ready but not yet distributed as a signed iPhone app**. The current user-facing iPhone option remains the Home Screen web app above. A distributable IPA still requires Apple signing/provisioning plus Firebase iOS/APNs configuration. See [`docs/ios-native.md`](docs/ios-native.md).

### Android app
DizyChat also ships a signed, sideload-only Android app. The current architecture is a **thin Capacitor/native shell** rather than a hundreds-of-megabytes bundled web application.

The shell connects to the production backend at `https://dizychat.com`, downloads the server-managed web bundle, verifies the bundle manifest/assets with SHA-256 before activation, and keeps a last-known-good local bundle rather than repeatedly reloading a bad update. Ordinary DizyChat web/UI changes therefore normally deploy from the server **without rebuilding the APK**. Native Java, manifest, Capacitor-plugin or signing changes still require a new signed APK.

Current tester release:

- **APK:** https://github.com/DizygoticCode/dizychat-server/releases/download/v1.0.0/dizychat-v1.apk
- **Size:** `4,693,459` bytes
- **SHA-256:** `7a196bd500de09c545ea6ad5c1ce2ab3f9109ded1beb8903d41544fb3bb31f71`
- **Package:** `com.chat.dizychat`

Google Play Protect may offer to scan the sideloaded APK. For the current release, allowing the scan is the straightforward install path; after the scan completes, Android can continue with the normal installation.

See [`docs/android-private-apk.md`](docs/android-private-apk.md) for signing, CI, bundle/update behaviour and the current real-device acceptance checks.

### Rumble companion userscript
The companion userscript lives at [`scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`](scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js).

The repository source is currently **v1.12.9**.

GitHub distribution/source links:

- **Repository source:** [`scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`](scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js)
- **Raw userscript (install):** https://raw.githubusercontent.com/DizygoticCode/dizychat-server/main/scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js

The **Dizygotic Rumble Chat Tool** currently provides blocking/highlighting, keyword filters, compact/timestamp controls, notifications, autoscroll controls, transcript recording/export, IndexedDB-backed transcript history, curated burn-memory tooling, selectable auto-burn engines, outgoing Unicode/font and colour styling, settings import/export/backup, and DizyChat handoff tools. Recent transcript work serializes/yields hydration and curated backfill work so overlapping history processing does not corrupt the in-memory/live record path.

Install with Tampermonkey by installing the Tampermonkey browser extension, opening the public GitHub raw `.user.js` source above, reviewing the Rumble-only match scope/dependencies, and accepting the userscript. No GitHub account is required to read or install the public raw file. The floating chat-settings control appears on supported Rumble chat pages once the chat DOM is available.

The Rumble userscript is a companion to DizyChat, not part of the DizyChat server runtime. Its source and deterministic source-contract tests are kept in this repository.

### Other companions
- Psybin Radio rooms expose a mini player with now-playing metadata and resilient reconnect behaviour.
- Rumble links can open in a draggable/resizable modal alongside chat.
- Watch2Gether launchers create synchronized watch-party rooms while keeping the W2G API key server-side.
- Jam-session helpers can launch JackTrip/SonoBus destinations configured by the server.

## Project structure

```text
index.js                         # Express/Socket.IO entry point
server-core.js                   # Main server routes/socket wiring
src/auth/                        # Accounts, sessions and password recovery
src/messages/                    # Message service boundaries
src/mobile-web/                  # Server-managed native web-bundle manifest/assets
src/push/                        # Native/Web Push policy, FCM transport and read-state services
src/uploads/                     # ClamAV and voice-message normalization
src/models/                      # MongoDB models
public/                          # Browser UI and server-managed frontend assets
public/iphone-install.*          # iPhone/iPad Home Screen helper
public/mobile-*.js               # Native/mobile web runtime integration
android-shell/                   # Minimal native bootstrap web shell
android/                         # Capacitor Android project and native plugins
ios-native/                      # Tracked Swift bridges injected into generated iOS target
scripts/prepare-ios-*.js         # Reproducible iOS/Firebase native-project preparation
scripts/tampermonkey/            # Dizygotic Rumble Chat Tool userscript
scripts/tests/                   # Userscript deterministic source tests
tests/                           # Server/browser/native deterministic tests
deploy/livekit/                  # Self-hosted LiveKit Compose/runbook
```

## Prerequisites

- **Node.js 22+** (matching `package.json`).
- **MongoDB** reachable through `MONGO_URI`.
- **ClamAV daemon plus `clamdscan`** for uploads; scanning fails closed if unavailable.
- **FFmpeg** for voice-message conversion and normalized soundboard imports/rebuilds.
- LiveKit credentials only when live calls are enabled.
- Firebase/FCM credentials when native push delivery is enabled; browser Web Push additionally uses VAPID configuration. Apple signing/APNs configuration is only required for distributable native iOS builds.

## Installation

```bash
git clone https://github.com/DizygoticCode/dizychat-server.git
cd dizychat-server
npm install
```

Create a local `.env` for development or configure the protected service environment on the deployment host. Production secrets, MongoDB credentials, API keys, Firebase credentials and Android signing material must stay outside Git.

## Environment variables

| Variable | Description |
| --- | --- |
| `PORT` | Optional HTTP port; defaults to `10000`. |
| `MONGO_URI` | **Required.** MongoDB connection string. |
| `SOCKET_IO_CORS_ORIGINS` | Recommended public-deployment Socket.IO CORS allowlist. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Optional legacy/default admin credential pair. |
| `ADMIN_CREDENTIALS` | Optional comma-separated `username:password` admin pairs. |
| `ADMIN_PASSWORD_HASH` | Preferred hashed admin credential for `ADMIN_USERNAME`. |
| `ADMIN_CREDENTIALS_HASHED` | Preferred comma-separated hashed admin credentials. |
| `ADMIN_AUTH_MAX_FAILURES` | Failed admin-auth attempts allowed per rolling window; default `5`. |
| `ADMIN_AUTH_WINDOW_MS` | Admin-auth rolling window; default `600000`. |
| `ADMIN_AUTH_LOCK_MS` | Admin-auth temporary lock duration; default `900000`. |
| `MESSAGE_HISTORY_CHUNK_SIZE` | History page size (25-500); default `150`. |
| `MAX_UPLOAD_SIZE_MB` | Upload cap; accepts values such as `50`, `50mb`, `2gb`, or `unlimited`. |
| `UPLOAD_QUARANTINE_DIR` | Private pre-scan upload directory; default `/var/lib/dizychat/upload-quarantine`. |
| `CLAMAV_SCAN_COMMAND` | ClamAV client command; default `clamdscan`. |
| `CLAMAV_SCAN_TIMEOUT_MS` | Per-file scan timeout; default `120000`, bounded 5000-600000 ms. |
| `FFMPEG_PATH` | Optional FFmpeg executable override; defaults to `ffmpeg` on PATH. Used for voice-message conversion and soundboard normalization. |
| `ENABLE_VOICE_CALLS` | Optional explicit LiveKit call enable/disable flag. If unset, calls enable when all LiveKit credentials are present. |
| `LIVEKIT_URL` | Browser-reachable LiveKit URL, normally trusted `wss://...`. |
| `LIVEKIT_API_KEY` | LiveKit API key used by DizyChat to issue room-scoped tokens. |
| `LIVEKIT_API_SECRET` | Secret paired with `LIVEKIT_API_KEY`. |
| `DIZYCHAT_FCM_ENABLED` | Enables the FCM push transport when set to `1`, `true`, `yes` or `on`. |
| `DIZYCHAT_FIREBASE_PROJECT_ID` | Firebase project ID used by the server-side FCM transport for registered native devices. |
| `DIZYCHAT_WEB_PUSH_ENABLED` | Enables browser/Home Screen Web Push when set to `1`, `true`, `yes` or `on`. |
| `DIZYCHAT_WEB_PUSH_VAPID_PUBLIC_KEY` | Public VAPID key exposed to supported browser clients when Web Push is enabled. |
| `DIZYCHAT_WEB_PUSH_VAPID_PRIVATE_KEY` | Private VAPID key; keep only in protected runtime configuration. |
| `DIZYCHAT_WEB_PUSH_SUBJECT` | VAPID subject, normally a `mailto:` or HTTPS contact URI. |
| `GIPHY_SDK_KEY` | Server-side GIPHY key used by the GIF picker proxy. |
| `W2G_API_KEY` | Server-side Watch2Gether API key. Aliases `WATCH2GETHER_API_KEY` and `WATCH_2_GETHER_API_KEY` are accepted. |
| `W2G_REQUEST_TIMEOUT_MS` | Watch2Gether request timeout; default 10000 ms. |
| `JACKTRIP_STUDIO_CREATE_URL` | Optional JackTrip create-studio URL override. |
| `JACKTRIP_STUDIO_INVITE_URL` | Optional reusable JackTrip studio invite URL. |
| `SONOBUS_DOWNLOAD_URL` | Optional SonoBus fallback URL override. |

### GIPHY setup
The browser calls DizyChat's `/giphy-search` endpoint; DizyChat calls GIPHY server-side. Keep `GIPHY_SDK_KEY` in the protected runtime environment. GIPHY beta keys have usage limits, so check the provider's current quota before relying on them for larger traffic.

### ClamAV upload scanning
DizyChat keeps the `/uploads/...` public URL contract but does not write incoming files directly into the public store. Multer completes the upload in `UPLOAD_QUARANTINE_DIR`, `clamdscan --fdpass --no-summary` returns the local malware verdict, and only a clean file is atomically renamed into the public upload directory.

Ubuntu/Debian example:

```bash
sudo apt update
sudo apt install -y clamav clamav-daemon
sudo systemctl enable --now clamav-freshclam clamav-daemon
sudo install -d -o dizy -g dizy -m 0700 /var/lib/dizychat/upload-quarantine
clamdscan --fdpass --no-summary /etc/hosts
```

Keep quarantine outside every web-served or symlink-exposed directory.

### LiveKit setup
For the current self-hosted production-style configuration, use [`deploy/livekit/README.md`](deploy/livekit/README.md). DizyChat and LiveKit remain separate services: DizyChat handles room/auth/token lifecycle while LiveKit transports realtime media.

Minimum application contract:

```dotenv
LIVEKIT_URL=wss://<your-livekit-host>
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
```

Browser microphone/camera access requires HTTPS (or localhost for development). The same LiveKit room connection carries microphone audio and optional camera video.

## Native server-managed web bundle

The native Android client and generated iOS path are intentionally split into two layers:

1. **Native shell:** signing identity, Capacitor/native plugins, secure session, push notifications, native navigation/media boundaries and the bundle updater.
2. **Server-managed web bundle:** DizyChat HTML/CSS/JS and related frontend assets published by the server.

The native updater fetches a manifest for the current server bundle, downloads only declared assets, validates paths, sizes and SHA-256 hashes before promotion, and retains a previously verified bundle as fallback. A failed/partial update must not replace the known-good local bundle.

Because of that split, normal frontend changes under the server-managed bundle do not justify issuing another native release. Rebuild/re-sign only when the relevant native shell itself changes.

Native relative media URLs are resolved against the configured DizyChat backend inside Capacitor; ordinary browser relative URLs continue using the browser's own current origin.

## Running locally

Development with Nodemon:

```bash
npm run dev
```

Production-style start:

```bash
npm start
```

## Testing

Run the deterministic Node test gate:

```bash
npm test
```

The repository also contains Android/native contract tests, native iOS contract tests, browser UI tests, iPhone PWA install tests, LiveKit Music Mode tests, push/read-state tests and userscript source-contract tests. CI additionally builds/verifies the signed Android package when encrypted signing/Firebase material is available, and generates/compiles the iOS Capacitor target for both Simulator and unsigned physical-device (`iphoneos`) architectures.

## HTTP API highlights

### `GET /version`
Returns `{ version, build, time }` for client diagnostics.

### `POST /upload`
Accepts multipart form field `file`. Clean uploads return metadata including the public URL; rejected or antivirus-failed uploads are not promoted into the public upload store.

### `GET /link-preview?url=...`
Fetches and normalizes preview metadata for an absolute URL.

### `GET /tenor-proxy?url=...`
Resolves legacy Tenor share URLs to embeddable media through Tenor oEmbed.

### `GET /giphy-search?q=...&limit=24&type=gifs|clips|stickers|emoji|text`
Returns normalized GIPHY results for the composer picker. `GIPHY_SDK_KEY` stays server-side.

### `GET /soundboard-clips`
Returns locally curated soundboard clips from `data/soundboards`, with optional search/board filtering.

### `GET /api/jam/status`
Returns the configured external jam-provider choices.

### `POST /api/jam/session`
Accepts a provider/room request and returns launch instructions for JackTrip or SonoBus.

## Socket.IO event highlights

| Event | Direction | Purpose |
| --- | --- | --- |
| `join room` | Client → Server | Enter a room (optionally password-protected) and trigger history loading. |
| `chat message` | Client → Server | Send sanitized text/file messages with optional reply snapshots. |
| `load messages` / `older messages` | Server → Client | Deliver initial and paginated history chunks. |
| `typing` / `stop typing` | Bidirectional | Broadcast/clear typing indicators with rate limiting. |
| `message status` | Server → Client | Update delivery/read receipts. |
| `pin message`, `star message`, `react message`, etc. | Bidirectional | Manage message metadata actions. |
| `moderate` | Client → Server | Admin mute/block/ban/unban actions. |
| `call:start`, `call:join`, `call:leave`, `call:end` | Bidirectional | Manage LiveKit-backed room-call lifecycle. |
| `call:mute-user`, `call:kick-user`, `call:disable-video-user`, `call:enable-video-user` | Client → Server | Admin call moderation. |
| `watch-party:w2g-create` | Client → Server | Create a Watch2Gether room using the server-side API key. |
| `room list` | Server → Client | Broadcast public rooms and occupant counts. |

## Soundboard catalog maintenance

The picker exposes separate **Local** and **Web** sources. **Web** mode makes the public 101Soundboards catalog directly searchable from inside DizyChat: enter at least three characters, browse matching boards, preview individual clips, and send a resolved clip straight into the current room without first importing it.

Search/browse/preview/send are part of the normal soundboard UI. The signed-in **owner** additionally gets controls to import a single clip or a whole public 101Soundboards board into DizyChat's local catalog.

### Import a new board

Paste an HTTPS `101soundboards.com/boards/...` URL and choose **Import**.

Normal imports are additive and resumable:

- existing catalog entries and audio files are preserved;
- an already-imported board skips matched clips and adds only new/unmatched clips;
- the server validates every page, media and redirect target against the 101Soundboards host boundary;
- imports run as a background job with progress shown in the picker;
- the in-memory soundboard search cache reloads automatically when an import completes; and
- if the source site presents CAPTCHA/human verification, DizyChat stops cleanly rather than attempting to bypass it.

Every newly downloaded clip is passed through FFmpeg before it enters the catalog. DizyChat trims quiet leading/trailing edges, normalizes to a consistent `-16 LUFS` target with a `-1.5 dBTP` ceiling, resamples to 48 kHz, and stores browser-friendly 128 kb/s AAC/M4A.

### Rebuild the existing 101Soundboards library

The owner-only **Rebuild current 101 boards** control discovers only catalogs explicitly marked `source: "101soundboards"`, re-downloads their source clips sequentially, applies the same normalization pipeline, and safely replaces matched legacy audio.

Replacement is fail-safe: a cleaned file must be created successfully before its catalog entry is changed, and the old local file is removed only after the new catalog has been written. If FFmpeg or a source clip fails, the working legacy clip remains in place.

This rebuild is intended for migrating older DizyChat soundboards that were captured by the previous downloader/blob workflow into cleaner, level-consistent source copies. FFmpeg can trim silence and normalize level, but it does not attempt to identify/remove arbitrary non-silent content embedded in the source clip itself.

Metadata remains under `data/soundboards`; downloaded binaries remain under `public/soundboards`. The older `scripts/download-101-soundboard.js` CLI remains available for legacy/manual maintenance of publicly accessible boards.

## Android release signing

Release signing keys/passwords are never committed. CI reconstructs the keystore only on the ephemeral Actions runner from encrypted repository secrets and verifies the produced APK with Android `apksigner` before exposing the release artifact.

See [`docs/android-private-apk.md`](docs/android-private-apk.md) for the full signing/build/install boundary.

## Deployment notes

- The canonical production deployment is self-hosted behind a reverse proxy; WebSocket upgrades must reach the Node/Socket.IO service.
- Keep MongoDB, LiveKit, Firebase/FCM, Web Push VAPID and Apple/APNs/signing credentials in protected host/runtime or CI configuration rather than the Git checkout.
- Provision persistent storage for uploads if files must survive service redeploy/replacement.
- The native web-bundle endpoint is part of the production server contract, so deploy frontend assets atomically with the DizyChat service and retain the native clients' hash verification/fallback boundary.
- LiveKit remains a separate realtime-media service; see [`deploy/livekit/README.md`](deploy/livekit/README.md) for the self-hosted network/TLS boundary.

## Security notes

- Do not commit `.env`, API keys, MongoDB credentials, Firebase service/client configuration, VAPID private keys, Apple APNs keys, provisioning profiles, certificates or Android/iOS signing material.
- Upload scanning fails closed: an infected file, scanner error or scan timeout is not promoted into the public upload store.
- Server authorization remains authoritative for accounts, sessions, room access, moderation and notification actions.
- User text/filenames are sanitized before persistence/broadcast.
- Restrict Socket.IO CORS origins with `SOCKET_IO_CORS_ORIGINS` on public deployments.
- Prefer hashed admin credentials over plaintext compatibility values.
- Possessing an Android APK or future signed iOS package does not bypass DizyChat authentication.

## License

MIT
