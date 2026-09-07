# DizyChat Server

DizyChat is a self-hosted real-time chat platform built with Express, Socket.IO and MongoDB. It combines persistent rooms and messaging with media uploads, moderation, public accounts, Android push notifications, browser/iPhone access, LiveKit audio/video calls, music-focused call mode, custom emoji/GIFs, soundboards, and a Rumble companion userscript.

Production: **https://dizychat.com**

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
- The Android app uses a durable native session store so closing/reopening the app does not normally force another login; explicit logout and server-declared invalid/revoked sessions clear the stored native session.

### Messaging and media
- Messages support editing, deletion, reactions, replies, pinning, starring and search.
- Uploads use the existing `/upload` contract and are written to a private quarantine first.
- Every completed upload must receive a clean local ClamAV verdict before it is atomically promoted into the public upload store.
- Voice messages are normalized for broad browser/mobile playback compatibility.
- Custom emoji/GIF assets, uploaded images/audio/video and soundboard audio work in normal browsers and in the Android Capacitor shell.
- The GIPHY picker is proxied through DizyChat so the GIPHY key stays server-side.
- The searchable meme soundboard is backed by JSON catalogs under `data/soundboards` and `/soundboard-clips`.

### Notifications
- Browser users can enable lightweight new-message sounds, with the preference stored locally.
- The Android app supports FCM-backed room notifications with room/message tap routing.
- Android notifications support inline **Reply** and **Mark as read** actions where the OS exposes them.
- Notification state is reconciled per room so stale/out-of-order controls do not clear unread state by guessing.

### LiveKit calls and Music Mode
- DizyChat supports room-scoped LiveKit audio calls with optional camera video.
- Production can use LiveKit Cloud or the self-hosted service documented in [`deploy/livekit/README.md`](deploy/livekit/README.md).
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

The installed web app launches in standalone mode at the DizyChat login screen. The helper is shown only for eligible iPhone/iPad browser sessions and is hidden once DizyChat is already running standalone.

### Android app
DizyChat also ships a signed, sideload-only Android app. The current architecture is a **thin Capacitor/native shell** rather than a hundreds-of-megabytes bundled web application.

The shell connects to the production backend at `https://dizychat.com`, downloads the server-managed web bundle, verifies the bundle manifest/assets with SHA-256 before activation, and keeps a last-known-good local bundle rather than repeatedly reloading a bad update. Ordinary DizyChat web/UI changes therefore normally deploy from the server **without rebuilding the APK**. Native Java, manifest, Capacitor-plugin or signing changes still require a new signed APK.

Current tester release:

- **APK:** https://github.com/DizygoticCode/dizychat-server/releases/download/v1.0.0/dizychat-v1.apk
- **SHA-256:** `26c47392baab81b2c5dee8dfc976c1c23fbba03769c41c102cbd755c75d0ab35`
- **Package:** `com.chat.dizychat`

Google Play Protect may offer to scan the sideloaded APK. For the current release, allowing the scan is the straightforward install path; after the scan completes, Android can continue with the normal installation.

See [`docs/android-private-apk.md`](docs/android-private-apk.md) for signing, CI, bundle/update behaviour and the current real-device acceptance checks.

### Rumble companion userscript
The companion userscript lives at [`scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`](scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js).

The repository source is currently **v1.12.10**.

GitHub install/update source:

- **Repository source:** [`scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`](scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js)
- **Raw userscript (install/update):** https://raw.githubusercontent.com/DizygoticCode/dizychat-server/main/scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js

The **Dizygotic Rumble Chat Tool** currently provides blocking/highlighting, keyword filters, compact/timestamp controls, notifications, autoscroll controls, transcript recording/export, IndexedDB-backed transcript history, curated burn-memory tooling, selectable auto-burn engines, outgoing Unicode/font and colour styling, settings import/export/backup, and DizyChat handoff tools. Recent transcript work serializes/yields hydration and curated backfill work so overlapping history processing does not corrupt the in-memory/live record path.

Install with Tampermonkey by installing the Tampermonkey browser extension, opening the public GitHub raw `.user.js` source above, reviewing the Rumble-only match scope/dependencies, and accepting the userscript. No GitHub account is required to read or install the public raw file. The userscript declares the same public GitHub raw URL as its `@updateURL` and `@downloadURL`, so Tampermonkey can use GitHub directly for future version updates. The floating chat-settings control appears on supported Rumble chat pages once the chat DOM is available.

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
src/mobile-web/                  # Server-managed Android web-bundle manifest/assets
src/push/                        # Push policy, FCM transport and read-state services
src/uploads/                     # ClamAV and voice-message normalization
src/models/                      # MongoDB models
public/                          # Browser UI and server-managed frontend assets
public/iphone-install.*          # iPhone/iPad Home Screen helper
public/mobile-*.js               # Native/mobile web runtime integration
android-shell/                   # Minimal native bootstrap web shell
android/                         # Capacitor Android project and native plugins
scripts/tampermonkey/            # Dizygotic Rumble Chat Tool userscript
scripts/tests/                   # Userscript deterministic source tests
tests/                           # Server/browser/native deterministic tests
deploy/livekit/                  # Self-hosted LiveKit Compose/runbook
```

## Prerequisites

- **Node.js 22+** (matching `package.json`).
- **MongoDB** reachable through `MONGO_URI`.
- **ClamAV daemon plus `clamdscan`** for uploads; scanning fails closed if unavailable.
- LiveKit credentials only when live calls are enabled.
- Firebase/FCM credentials only when Android push delivery is enabled.

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
| `ENABLE_VOICE_CALLS` | Optional explicit LiveKit call enable/disable flag. If unset, calls enable when all LiveKit credentials are present. |
| `LIVEKIT_URL` | Browser-reachable LiveKit URL, normally trusted `wss://...`. |
| `LIVEKIT_API_KEY` | LiveKit API key used by DizyChat to issue room-scoped tokens. |
| `LIVEKIT_API_SECRET` | Secret paired with `LIVEKIT_API_KEY`. |
| `DIZYCHAT_FCM_ENABLED` | Enables the FCM push transport when set to `1`, `true`, `yes` or `on`. |
| `DIZYCHAT_FIREBASE_PROJECT_ID` | Firebase project ID used by the server-side FCM transport. |
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

## Android server-managed web bundle

The production Android client is intentionally split into two layers:

1. **Native shell:** signing identity, Capacitor/native plugins, secure session, push notifications, native navigation/media boundaries and the bundle updater.
2. **Server-managed web bundle:** DizyChat HTML/CSS/JS and related frontend assets published by the server.

The app fetches a manifest for the current server bundle, downloads only declared assets, validates hashes before promotion and retains a previously verified bundle as fallback. A failed/partial update must not replace the known-good local bundle.

Because of that split, normal frontend changes under the server-managed bundle do not justify issuing another Android release. Rebuild the APK only when the native shell itself changes.

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

The repository also contains Android/native contract tests, browser UI tests, iPhone PWA install tests, LiveKit Music Mode tests, push/read-state tests and userscript source-contract tests. CI additionally builds/verifies the signed Android package when the required encrypted signing/Firebase material is available.

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

To import a curated 101Soundboards board into the local catalog:

```bash
node scripts/download-101-soundboard.js --board https://www.101soundboards.com/boards/<board-slug>
```

Metadata is kept in `data/soundboards`; downloaded binaries under `public/soundboards` are intentionally not part of the Git source history. If the source site requires a browser session cookie, the importer supports `SB_101SOUNDBOARDS_COOKIE`.

## Android release signing

Release signing keys/passwords are never committed. CI reconstructs the keystore only on the ephemeral Actions runner from encrypted repository secrets and verifies the produced APK with Android `apksigner` before exposing the release artifact.

See [`docs/android-private-apk.md`](docs/android-private-apk.md) for the full signing/build/install boundary.

## Deployment notes

- The canonical production deployment is self-hosted behind a reverse proxy; WebSocket upgrades must reach the Node/Socket.IO service.
- Keep MongoDB, LiveKit, Firebase/FCM and other credentials in protected host/runtime configuration rather than the Git checkout.
- Provision persistent storage for uploads if files must survive service redeploy/replacement.
- The Android web-bundle endpoint is part of the production server contract, so deploy frontend assets atomically with the DizyChat service and retain the native client's hash verification/fallback boundary.
- LiveKit remains a separate realtime-media service; see [`deploy/livekit/README.md`](deploy/livekit/README.md) for the self-hosted network/TLS boundary.

## Security notes

- Do not commit `.env`, API keys, MongoDB credentials, Firebase service credentials or Android signing material.
- Upload scanning fails closed: an infected file, scanner error or scan timeout is not promoted into the public upload store.
- Server authorization remains authoritative for accounts, sessions, room access, moderation and notification actions.
- User text/filenames are sanitized before persistence/broadcast.
- Restrict Socket.IO CORS origins with `SOCKET_IO_CORS_ORIGINS` on public deployments.
- Prefer hashed admin credentials over plaintext compatibility values.
- Possessing the Android APK does not bypass DizyChat authentication.

## License

MIT
