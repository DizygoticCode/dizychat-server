# DizyChat Server

DizyChat is a Socket.IO and Express-powered real-time chat backend designed for music and community discussions. It ships with MongoDB persistence, media uploads with antivirus scanning, granular moderation, and rich UX niceties such as link previews and GIF embedding.

## Features

### Realtime chat engine
- Uses **Socket.IO** atop an Express HTTP server for bidirectional messaging, typing indicators, message delivery/read receipts, and live room membership updates.
- Persists chat history, reactions, pins, stars, replies, and delivery status in MongoDB through a comprehensive `Message` schema.
- Provides paginated history fetching so clients can lazy-load older messages without over-fetching.

### Media uploads with antivirus scanning
- Accepts an allowlisted set of common image/audio/video/document formats via `/upload` (JPEG/JPG, PNG, GIF, WebP, HEIC/HEIF, MP3, M4A, WAV, OGG/Opus, WebM, MP4/M4V/MOV, PDF, text/CSV/JSON/Markdown, ZIP, and Office documents), stores assets under `public/uploads`, and advertises the configured size limit in logs.
- Streams uploads to OPSWAT MetaDefender Cloud; rejects infected files and cleans up temporary artifacts automatically.
- Supports configurable size caps (including "unlimited") through `MAX_UPLOAD_SIZE_MB`.

### Rich content previews
- Link preview endpoint fetches remote pages, parses OpenGraph/Twitter/JSON-LD metadata, and normalizes image/icon URLs with caching to reduce load.
- GIPHY search powers the composer media picker through a server-side proxy with tabs for GIFs, Clips, stickers, emoji, and text-sticker-style results, while Tenor share links can still be resolved for legacy embeds.

### Moderation & administration
- Admin accounts can be provisioned through environment variables with flexible username/password pairs.
- Socket-level admin authentication unlocks commands for announcements, muting, blocking, banning, and unblocking users with automatic notifications and toasts.
- Supports room passwords, per-room user bans, blocks, and timed mutes with presence snapshots that flag muted or blocked members.

### Room management & discovery
- Preconfigures persistent lobbies and dynamically tracks occupants, broadcasting updates to all clients so they can list active rooms.
- Enforces per-room passwords and bans, and automatically trims empty ad-hoc rooms to conserve memory.

### Message enrichment tools
- Allows message editing, deletion (with file cleanup), pinning, starring, emoji reactions, threaded replies, and full-text search.
- Sanitizes all user-provided text and filenames to avoid HTML/script injection.
- Packs a GIPHY GIF browser plus a curated meme soundboard picker backed by `/soundboard-clips`, sourcing JSON catalogs from `data/soundboards` so clips can be hosted entirely offline.

### Client experience helpers
- Broadcasts typing status with rate limiting to prevent spam.
- Provides `/version` endpoint exposing build metadata for clients to surface release information.
- Serves the bundled front-end from `public/` with a catch-all route for client-side routing.
- Toolbar toggle lets users persistently enable/disable sound notifications, with gentle chimes and accessibility labels that survive reloads via local storage.

### Live broadcast companions
- The dedicated Psybin Radio room surfaces a mini audio player that streams the live station, polls `/api/psybin/now-playing` for metadata, and exposes play/pause, mute, and volume controls with resilient reconnect logic.
- Rumble live streams pop into a draggable, resizable modal so viewers can park the broadcast alongside chat without losing context.
- **Dizygotic Rumble Chat Companion v1.8** extends Rumble itself with blocking/highlighting, keyword filtering, transcript capture/export, chat appearance controls, DizyChat DM handoff, notifications, and selectable auto-burn engines from the companion userscript in `scripts/tampermonkey/`.
- Watch2Gether watch-party launchers create synced W2G rooms from inside a DizyChat room while keeping the API key server-side.

### Recently added
- **Rumble Chat Companion v1.8** – the companion userscript now adds a passive local transcript recorder with JSON/CSV export, configurable fonts and chat colours (including per-character rainbow/multi-colour local rendering), multiple selectable burn engines, import/export compatibility, and the existing block/highlight/DM toolset.
- **Push-to-talk voice notes** – the web client exposes a hold-to-record microphone button that uploads and posts audio clips with automatic cleanup and status toasts so moderators can manage voice memos alongside regular attachments.
- **Theme & density toggles** – users can flip between dark/light themes and compact/comfortable layouts, both of which persist per browser via local storage to keep the interface feeling familiar across sessions.
- **Inline Rumble embeds** – links to Rumble videos auto-expand into responsive iframes so shared broadcasts can play without leaving the room.
- **Psybin Radio tuner** – the Psybin room now auto-reveals a dedicated player with live metadata sourced from `/api/psybin/now-playing`, plus play, pause, mute, and volume controls that reconnect automatically after hiccups.
- **Searchable meme soundboard** – a composer button opens a searchable clip library powered by `/soundboard-clips`, driven by JSON catalogs under `data/soundboards` (kept fresh via `scripts/download-101-soundboard.js`).
- **Sound notification toggle** – chat toolbar switch enables lightweight audio alerts for new messages, persisting each visitor’s preference in local storage so the cues stick between sessions.

## Project structure

```
index.js              # Express & Socket.IO server entry point
src/models/message.js # Mongoose schema for chat messages
public/               # Static assets served to clients (uploads, UI bundle)
scripts/tampermonkey/ # Dizygotic Rumble Chat Companion userscript
tests/                # Automated tests (if/when added)
```

## Prerequisites

- **Node.js 22+** (matching the `engines` field).
- **MongoDB** instance accessible via connection string.
- Upload antivirus/type-signature enforcement is temporarily disabled while mobile upload compatibility is being verified.

## Installation

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/<you>/dizychat-server.git
   cd dizychat-server
   npm install
   ```
2. Ensure MongoDB is running/available.
3. Create a `.env` file (see below) or configure environment variables in your host.

## Environment variables

Create a `.env` file in the project root with the following keys:

| Variable | Description |
| --- | --- |
| `PORT` | (Optional) HTTP port, defaults to `10000`. |
| `MONGO_URI` | **Required.** MongoDB connection string. Server exits if missing. |
| `SOCKET_IO_CORS_ORIGINS` | (Recommended for public deployments) Comma-separated Socket.IO CORS origin allowlist (example: `https://chat.example.com,https://app.example.com`). |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Optional default admin credential pair. |
| `ADMIN_CREDENTIALS` | Comma-separated list of `username:password` pairs for multiple admins. |
| `ADMIN_PASSWORD_HASH` | Preferred hashed admin credential for `ADMIN_USERNAME`, encoded as `scrypt$N$r$p$saltBase64$keyBase64$keyLength`. |
| `ADMIN_CREDENTIALS_HASHED` | Preferred comma-separated list of `username:scrypt$N$r$p$saltBase64$keyBase64$keyLength` pairs. |
| `ADMIN_AUTH_MAX_FAILURES` | (Optional) Failed admin auth attempts allowed per window before temporary lockout; defaults to `5`. |
| `ADMIN_AUTH_WINDOW_MS` | (Optional) Rolling window in milliseconds for counting failed admin auth attempts; defaults to `600000` (10 minutes). |
| `ADMIN_AUTH_LOCK_MS` | (Optional) Temporary lockout duration in milliseconds after too many failed failures; defaults to `900000` (15 minutes). |
| `MESSAGE_HISTORY_CHUNK_SIZE` | Page size (25-500) for history fetches; defaults to 150. |
| `MAX_UPLOAD_SIZE_MB` | File upload cap; accepts values like `50`, `50mb`, or `2gb`. Use `unlimited` to disable the limit. |
| `ENABLE_VOICE_CALLS` | (Optional) Set to `true`/`false` to force LiveKit call availability. The legacy name is still used for compatibility; when enabled, calls support microphone audio and optional camera video. If unset, calls enable automatically when all LiveKit credentials are present. |
| `LIVEKIT_URL` | Required when LiveKit calls are enabled. LiveKit Cloud/server WebSocket URL (for example `wss://<project>.livekit.cloud`). |
| `LIVEKIT_API_KEY` | Required when LiveKit calls are enabled. LiveKit API key used by the backend to issue room-scoped access tokens. |
| `LIVEKIT_API_SECRET` | Required when LiveKit calls are enabled. LiveKit API secret paired with `LIVEKIT_API_KEY`. |
| `GIPHY_SDK_KEY` | Required for the GIF picker. Create a GIPHY SDK key in the GIPHY Developer Dashboard and store it server-side in Render environment variables. |
| `W2G_API_KEY` | Required for Watch2Gether watch-party room creation. Keep this server-side in Render environment variables; clients only see generated W2G room links. Aliases `WATCH2GETHER_API_KEY` and `WATCH_2_GETHER_API_KEY` are also accepted. |
| `W2G_REQUEST_TIMEOUT_MS` | (Optional) Timeout for Watch2Gether API room creation; defaults to 10000 ms. |
| `JACKTRIP_STUDIO_CREATE_URL` | (Optional) Override the JackTrip create-studio URL used by the Jam Session launcher; defaults to `https://app.jacktrip.org/studios/create`. |
| `JACKTRIP_STUDIO_INVITE_URL` | (Optional) If you already have a reusable JackTrip studio invite, expose that directly instead of the create-studio page. |
| `SONOBUS_DOWNLOAD_URL` | (Optional) Override the SonoBus fallback URL; defaults to `https://sonobus.net/index.html`. |

### GIPHY setup

Yes, the GIF picker requires your own `GIPHY_SDK_KEY`; there is no bundled shared key and no fallback key name. Create a GIPHY developer account, create an SDK key in the GIPHY Developer Dashboard, then add the key to Render as `GIPHY_SDK_KEY` and redeploy. The browser never receives the key directly because the composer calls DizyChat's `/giphy-search` endpoint, and the server forwards requests to GIPHY.

GIPHY SDK keys start as beta keys with limited hourly usage. If chat traffic grows beyond beta limits, upgrade the key from the GIPHY dashboard before relying on the GIF picker in production.

## Running locally

### Development mode
Use Nodemon for auto-restarts:
```bash
npm run dev
```

### Production mode
Launch the server with Node:
```bash
npm start
```

The server will log the active port, build/version information, and upload limit during boot.

### LiveKit call provider setup

Live audio/video calls are **not self-contained inside the DizyChat server**. The chat server provides the UI, room lifecycle events, and LiveKit access-token minting, but real-time microphone/camera transport still requires a LiveKit Cloud project or a self-hosted LiveKit server. Until `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are configured, `/api/calls/status` reports `configured: false` with a `missingRequiredEnv` list, and the client shows the missing server variables instead of a generic setup error.

Recommended options:

1. **Use LiveKit Cloud** for the fastest production path. Create a LiveKit Cloud project, copy its project URL plus API key/secret, then set those values as `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in the DizyChat deployment environment. If LiveKit shows the project URL as `https://...`, paste it as-is or change it to `wss://...`; DizyChat normalizes it before sending it to the browser. DizyChat also accepts common aliases such as `LIVE_KIT_URL`, `LIVE_KIT_API_KEY`, and `LIVE_KIT_API_SECRET`, but the canonical `LIVEKIT_*` names are recommended because they match LiveKit's own examples.
2. **Self-host LiveKit on infrastructure that supports WebRTC networking** if you need full control. A production LiveKit server needs a trusted TLS certificate, public DNS such as `wss://livekit.example.com`, TCP signaling, and exposed ICE UDP/TCP ports. This usually fits a VM, Kubernetes cluster, or LiveKit-focused host better than a standard single-port app service.
3. **Use Render only if you can satisfy LiveKit's networking requirements with a Docker service and the required public ports.** DizyChat itself can stay on Render, but LiveKit media traffic is a separate realtime media service and should not be bundled into the same Node/Express process.
4. **Use `livekit-server --dev` only for local testing.** The dev server uses the built-in `devkey` / `secret` credentials and is not a production deployment.

For audio and optional camera video, configure only the LiveKit variables above. DizyChat uses the same LiveKit room connection for microphone and camera tracks; users join with audio first and can press **Add video** in the live call panel to publish their camera. Browser camera access requires HTTPS or localhost, and the current server permissions policy allows both microphone and camera access.

When users choose **Music mode On**, the token endpoint marks the call as music mode and returns high-fidelity audio settings to the browser. The browser then requests a stereo microphone track with echo cancellation, noise suppression, and automatic gain control disabled, and publishes it with a 320 kbps LiveKit/Opus target, DTX disabled, and RED disabled. This is an application-side publish setting, not a separate DizyChat media backend; actual quality can still vary with the user's microphone, browser, operating-system audio path, and network conditions. LiveKit Cloud's free Build plan has usage quotas and included allowances, but LiveKit documents hi-fi audio publish settings up to 510 kbps stereo rather than a free-plan-specific low-bitrate cap.

### Jam session launcher setup

The **Jam Session** button is an external pro-audio handoff for musician rooms. It recommends JackTrip first because JackTrip currently offers a free hosted-studio test path for up to 5 musicians for 30 minutes, then exposes SonoBus as a free fallback for open-source peer-to-peer audio with ASIO support through its native app.

No JackTrip API key is required for the default launcher. If `JACKTRIP_STUDIO_CREATE_URL`, `JACKTRIP_STUDIO_INVITE_URL`, and `SONOBUS_DOWNLOAD_URL` are unset, DizyChat works as-is by opening JackTrip's create-studio page and SonoBus's download page. Set those variables only when you want Render to point users at a specific reusable JackTrip studio invite, a different JackTrip landing page, or a mirrored SonoBus URL.

DizyChat does not handle ASIO audio directly in the browser. The launcher opens the external provider and gives room-specific instructions so musicians can use the provider's native desktop app/audio-interface support while staying coordinated in DizyChat.


### Configuring native/WebView builds
Capacitor and similar wrappers load the web bundle from a non-HTTP origin (`capacitor://localhost`).
The default Socket.IO client assumes it can reuse the current origin, so the native shell
needs to know which deployed backend to contact. Override the connection target by editing
`public/app-config.js` before running `npx cap copy android`:

```js
window.dizychatConfig = {
  socketUrl: "https://your-production-server.example.com",
  // Optional: automatically use this URL whenever the page is loaded
  // from capacitor://localhost or file:// origins.
  defaultNativeSocketUrl: "https://your-production-server.example.com",
  // Optional Socket.IO client options
  socketOptions: {
    transports: ["websocket"],
  },
};
```

At runtime you can also drop an alternate server URL into `localStorage` under the
`dizychat-socket-url` key (configurable via `socketUrlStorageKey`) to point debug builds at
different environments without rebuilding the native project.

> **Tip:** keep your Git commits lean by excluding Gradle build output and Android Studio
> workspace files. The repository’s `.gitignore` already filters `android/app/build/`,
> `android/.gradle/`, `android/.idea/`, and `android/local.properties`. If you accidentally
> generated these before updating `.gitignore`, run:
>
> ```bash
> git rm -r --cached android/app/build android/.gradle android/.idea android/local.properties
> ```
>
> …then commit to drop the tracked artifacts. This keeps your repo small while still
> checking in the Capacitor project files needed to rebuild the APK.

## Automated UI smoke tests

The `tests/` folder contains Playwright- and Puppeteer-based smoke tests that hit the deployed Render instance and capture screenshots/video artifacts. They are optional and require installing the browsers locally:

```bash
npm install --save-dev playwright puppeteer
```

Run the CommonJS harness (which includes retries and artifact generation) with Node.js:

```bash
node tests/ui-test.cjs             # Playwright only
node tests/ui-test.cjs --puppeteer # Playwright + Puppeteer snapshot
```

Artifacts are written to `ui-test-artifacts/` and include timestamped screenshots, videos, and an `index.html` viewer. Set the `TIMESTAMP` environment variable to control the artifact prefix if you need deterministic names.

## API reference

### `GET /version`
Returns JSON containing `{ version, build, time }` for client diagnostics.

### `POST /upload`
Accepts multipart form field `file`. Supported uploads include JPEG/JPG, PNG, GIF, WebP, HEIC/HEIF, MP3, M4A, WAV, OGG/Opus, WebM voice clips, MP4/M4V/MOV videos, PDF, text/CSV/JSON/Markdown, ZIP, and Office documents. Returns `{ url, name, type, size }` for clean files; otherwise reports validation or antivirus failures.

### `GET /link-preview?url=...`
Fetches metadata for an absolute URL and responds with normalized preview attributes. Non-HTML content returns empty fields.

### `GET /tenor-proxy?url=...`
Resolves a Tenor share URL to embeddable GIF URLs via Tenor oEmbed.

### `GET /giphy-search?q=...&limit=24&type=gifs|clips|stickers|emoji|text`
Returns normalized GIPHY results for the composer picker. Omit `q` to load trending GIFs, stickers, Clips, or emoji depending on `type`. Requires `GIPHY_SDK_KEY`; Clips availability depends on GIPHY account approval.

### `GET /soundboard-clips`
Returns locally curated soundboard clips aggregated from JSON definitions in `data/soundboards`. Accepts optional `q` and `board` query parameters for search filtering and responds with normalized clip metadata for the soundboard picker.

### `GET /api/jam/status`
Returns available external jam providers, including JackTrip as the recommended free test path and SonoBus as the free fallback.

### `POST /api/jam/session`
Accepts JSON `{ "provider": "jacktrip" | "sonobus", "room": "Room Name" }` and returns launch instructions for the selected external jam provider. JackTrip sessions return the configured create/invite URL plus free-tier guidance; SonoBus sessions generate a room-specific group name and password for copying into the native app.

### Importing meme boards from 101Soundboards

The repository now stores soundboard metadata locally instead of proxying Pixabay. To pull curated boards from [101soundboards.com](https://www.101soundboards.com/):

```bash
node scripts/download-101-soundboard.js --board https://www.101soundboards.com/boards/<board-slug>
```

The script downloads every clip from the target board into `public/soundboards/<board-slug>/` and updates the JSON catalog in `data/soundboards`. The `public/soundboards` directory is intentionally gitignored so the repo stays binary-free—commit only the JSON definitions. If you need to distribute the audio assets, publish them through your own storage or an artifact bundle instead of checking the binaries into source control.

Some boards now require a browser cookie to bypass anti-bot checks. Set `SB_101SOUNDBOARDS_COOKIE` to the cookie you see after loading a board in your browser (for example, `user_session_id=<value>`). You can paste just the value—the importer will prefix the cookie name for you.

All marketing routes serve the hero experience from `public/index.html`; the chat client now lives at `/login.html` (also aliased to `/login`, `/chat`, and `/app`).

## Socket.IO events (highlights)

| Event | Direction | Purpose |
| --- | --- | --- |
| `join room` | Client → Server | Enter a room (optionally password-protected) and trigger history loading. |
| `chat message` | Client → Server | Send sanitized text/file messages with optional reply snapshots. |
| `load messages` / `older messages` | Server → Client | Deliver initial and paginated history chunks. |
| `typing` / `stop typing` | Bidirectional | Broadcast or clear typing indicators with rate limiting. |
| `message status` | Server → Client | Update delivery/read receipts when status changes. |
| `pin message`, `star message`, `react message`, etc. | Bidirectional | Manage message metadata actions. |
| `moderate` | Client → Server | Admin actions for mute/block/ban/unban with notifications. |
| `call:start`, `call:join`, `call:leave`, `call:end` | Bidirectional | Manage optional LiveKit-backed voice/video call lifecycle; the first participant can start a room call automatically. |
| `call:mute-user`, `call:kick-user`, `call:disable-video-user`, `call:enable-video-user` | Client → Server | Admin-only call moderation actions for audio, removal, and camera access. Camera disables are remembered for the active room call until an admin allows the camera again or the call ends. |
| `call:user-muted`, `call:user-kicked`, `call:user-video-disabled`, `call:user-video-enabled` | Server → Client | Targeted room call moderation notifications; affected clients mute audio, leave, stop camera video, or re-enable their camera control. |
| `watch-party:w2g-create` | Client → Server | Creates a Watch2Gether room for the current DizyChat room using the server-side `W2G_API_KEY`. |
| `watch-party:external-created`, `watch-party:external-active`, `watch-party:external-cleared`, `watch-party:error` | Server → Client | Broadcasts the current external Watch2Gether room card, clears it, or reports room-creation failures. |
| `room list` | Server → Client | Broadcasts current public rooms and occupant counts. |

## Security considerations

- All user text and filenames are sanitized before persistence or broadcast to avoid XSS vectors.
- Room passwords, admin credentials, and mute/block lists are normalized to avoid casing mismatches.
- File uploads must pass antivirus checks; failure removes the file and notifies the client.
- Restrict Socket.IO CORS origins with `SOCKET_IO_CORS_ORIGINS` before exposing the service publicly.
- Prefer hashed admin credentials (`ADMIN_PASSWORD_HASH` / `ADMIN_CREDENTIALS_HASHED`); plaintext admin passwords are still accepted for migration compatibility.
- Admin authentication now includes anti-bruteforce controls (progressive retry delay + temporary lockout after repeated failures).
- HTTP responses include hardened security headers (CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`) while allowing trusted inline media frames from YouTube, Spotify, SoundCloud, and Rumble so chat link embeds keep working; Express `x-powered-by` is disabled.

## Deployment notes

- Behind a reverse proxy, ensure WebSocket upgrades are forwarded to the Node server.
- Provision persistent storage for `public/uploads` if you need to retain files across deploys.
- Configure process managers (PM2, systemd, Docker, etc.) to supply environment variables securely.
- Rotate admin credentials on a fixed cadence (for example every 60–90 days) and immediately after suspected exposure.
- Scale horizontally by sharing the same MongoDB and enabling a Socket.IO adapter (e.g., Redis) if broadcasting across instances is required.

## Roadmap ideas

- Automated tests for moderation workflows and file scanning fallbacks.
- Redis or MongoDB change streams for cross-instance Socket.IO scaling.
- Rate-limited public APIs to expose room listings and message statistics.

## Dizygotic Rumble Chat Companion (Tampermonkey v1.8)

The companion userscript at `scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js` brings DizyChat-style moderation and utility controls directly into Rumble livestream chat. It is designed to run as a browser-side companion: Rumble remains the chat service, while the script augments the page locally and can hand users into DizyChat for private direct-message rooms.

Greasy Fork listing: https://greasyfork.org/en/scripts/565816-dizygotic-rumble-chat-tool

### v1.8 feature highlights
- **Context-menu moderation & DizyChat handoff** – right-click a Rumble username to block/unblock, highlight/unhighlight, or open a DizyChat direct-message tab for that user.
- **Filtering and chat controls** – keyword hide/mask modes, compact display, timestamps with 12/24-hour modes, autoscroll lock, optional system-message hiding, long-message collapse, highlighted-user notifications, and configurable notification sound/volume.
- **Passive transcript recorder** – optionally records public chat locally with sequence number, ISO capture time, username/display name, message text, @mentions, page URL/title, original rendered message HTML, and row classes. The recorder is bounded to 20,000 messages and batches local-storage writes to avoid hammering the browser on busy streams.
- **JSON/CSV transcript export** – export the locally captured transcript for later analysis, or clear it independently of the main settings/blocklist.
- **Chat appearance controls** – choose any installed font family by name, enumerate locally installed fonts where the browser exposes the Local Font Access API, override font size, choose a single text colour, or render each character locally using rainbow or configurable multi-colour palettes.
- **Selectable auto-burn engines** – optional mention-triggered replies with cooldown control. Built-in quips, Compromise NLP, RiTa creative generation, local Markov generation, and a custom JavaScript hook can each be enabled or disabled independently, with a preferred engine selector and graceful fallbacks.
- **Portable settings** – export/import blocklists and settings, schedule automatic backups, and import JSON exported by earlier script versions; new v1.8 fields fall back to defaults when they are absent from an older profile.
- **Persistent draggable UI** – the floating Chat Settings button remembers its screen position and keeps the existing dark mode, block/highlight management, notifications, DM integration, and other controls in one panel.

### Burn engine notes
- **Built-in** requires no external dependency and is always available.
- **Compromise** is loaded by Tampermonkey using `@require` and provides lightweight noun/verb-aware responses.
- **RiTa** is also loaded with `@require` for more playful creative generation.
- **Markov** uses a small local word-chain generator so a third-party CDN/package change cannot break the entire userscript; users can supply their own corpus in the settings panel.
- **Custom** exposes `window.rumbleBlocker.customBurnGenerator(ctx)` for users who want to supply their own response function.

### Install with Tampermonkey
1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Install from the Greasy Fork listing above, or open the repository source directly: `https://raw.githubusercontent.com/DizygoticCode/dizychat-server/main/scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`.
3. Review the requested Rumble match scope and dependencies, then install the userscript.
4. Visit a Rumble livestream with chat. The floating **Chat Settings** button appears once the chat DOM is available.
5. Existing users can open **Import** and select a settings JSON exported by an older release; v1.8 merges it with the current defaults.

### Local data and privacy
The transcript recorder, blocklist, highlights, appearance settings, and other preferences are stored in the browser. Transcript export is user-triggered. The companion does not require access to DizyChat server data for normal Rumble filtering/recording; the DizyChat server is only opened when the user explicitly chooses the direct-message handoff.

### Manual script injection
Tampermonkey is the supported userscript workflow, but the file is plain JavaScript and can also be reviewed or run manually for development/testing. A future standalone Chrome/Brave/Edge/Firefox WebExtension can reuse the same core Rumble DOM logic while replacing userscript metadata/local storage glue with browser-extension APIs.

---

Feel free to open issues or PRs to collaborate on future iterations of DizyChat!
