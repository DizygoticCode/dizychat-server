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
- Tenor GIF proxy converts Tenor share links into direct GIF URLs for quick embeds while enforcing domain safelists.

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
- Packs a Tenor GIF browser plus a curated meme soundboard picker backed by `/soundboard-clips`, sourcing JSON catalogs from `data/soundboards` so clips can be hosted entirely offline.

### Client experience helpers
- Broadcasts typing status with rate limiting to prevent spam.
- Provides `/version` endpoint exposing build metadata for clients to surface release information.
- Serves the bundled front-end from `public/` with a catch-all route for client-side routing.
- Toolbar toggle lets users persistently enable/disable sound notifications, with gentle chimes and accessibility labels that survive reloads via local storage.

### Live broadcast companions
- The dedicated Psybin Radio room surfaces a mini audio player that streams the live station, polls `/api/psybin/now-playing` for metadata, and exposes play/pause, mute, and volume controls with resilient reconnect logic.
- Rumble live streams pop into a draggable, resizable modal so viewers can park the broadcast alongside chat without losing context.

### Recently added
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
tests/                # Automated tests (if/when added)
```

## Prerequisites

- **Node.js 22+** (matching the `engines` field).
- **MongoDB** instance accessible via connection string.
- **MetaDefender Cloud API key** (set `METADEFENDER_API_KEY`) for inline antivirus scanning.

## Installation

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/<you>/dizychat-server.git
   cd dizychat-server
   npm install
   ```
2. Ensure MongoDB is running/available and obtain a MetaDefender Cloud API key.
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
| `ADMIN_AUTH_LOCK_MS` | (Optional) Temporary lockout duration in milliseconds after too many failed admin auth attempts; defaults to `900000` (15 minutes). |
| `MESSAGE_HISTORY_CHUNK_SIZE` | Page size (25-500) for history fetches; defaults to 150. |
| `MAX_UPLOAD_SIZE_MB` | File upload cap; accepts values like `50`, `50mb`, or `2gb`. Use `unlimited` to disable the limit. |
| `METADEFENDER_API_KEY` | OPSWAT MetaDefender Cloud API key used to scan files when configured. If unset, uploads still work after local type verification unless `REQUIRE_UPLOAD_ANTIVIRUS_SCAN=true`. |
| `REQUIRE_UPLOAD_ANTIVIRUS_SCAN` | (Optional) Set to `true` to fail uploads when `METADEFENDER_API_KEY` is missing or rejected; defaults to allowing locally verified uploads without antivirus scanning. |
| `METADEFENDER_BASE_URL` | (Optional) Override the MetaDefender API origin. Defaults to `https://api.metadefender.com/v4`. |
| `METADEFENDER_POLL_INTERVAL_MS` | (Optional) Milliseconds between status polls; defaults to 1500 (bounded between 250-15000). |
| `METADEFENDER_MAX_POLL_ATTEMPTS` | (Optional) Maximum polling attempts before timing out; defaults to 10 (bounded between 1-40). |
| `ENABLE_VOICE_CALLS` | (Optional) Set to `true`/`false` to force voice-call availability. If unset, calls enable automatically when all LiveKit credentials are present. |
| `LIVEKIT_URL` | Required when voice calls are enabled. LiveKit Cloud/server WebSocket URL (for example `wss://<project>.livekit.cloud`). |
| `LIVEKIT_API_KEY` | Required when voice calls are enabled. LiveKit API key used by the backend to issue room-scoped access tokens. |
| `LIVEKIT_API_SECRET` | Required when voice calls are enabled. LiveKit API secret paired with `LIVEKIT_API_KEY`. |

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

### `GET /soundboard-clips`
Returns locally curated soundboard clips aggregated from JSON definitions in `data/soundboards`. Accepts optional `q` and `board` query parameters for search filtering and responds with normalized clip metadata for the soundboard picker.

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
| `call:mute-user`, `call:kick-user`, `call:disable-video-user`, `call:enable-video-user` | Client → Server | Admin-only call moderation actions for audio, removal, and camera access. |
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
- Rotate admin credentials and scanner API keys on a fixed cadence (for example every 60–90 days) and immediately after suspected exposure.
- Scale horizontally by sharing the same MongoDB and enabling a Socket.IO adapter (e.g., Redis) if broadcasting across instances is required.

## Roadmap ideas

- Automated tests for moderation workflows and file scanning fallbacks.
- Redis or MongoDB change streams for cross-instance Socket.IO scaling.
- Rate-limited public APIs to expose room listings and message statistics.

## Dizygotic Rumble Chat UserScript

Bring the DizyChat experience to Rumble livestreams with the companion Tampermonkey script located at `scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`.

### Feature highlights
- **Contextual moderation controls** – right-click usernames to block/unblock viewers, highlight regulars, or jump straight into a DizyChat-powered direct-message tab with friendly placeholders ready for your handle and room.
- **Smart filtering & alerts** – combine user blocks, keyword filters, collapsible long posts, timestamps, and optional desktop/audio notifications to focus on the messages that matter.
- **Portable settings** – export/import profiles or schedule auto-backups so your blocklist, highlights, and preferences travel with you across browsers.
- **Draggable control center** – launch a floating settings palette that remembers its position, supports dark mode, and surfaces quick toggles for compact layout, autoscroll lock, previews, and more.

### Install with Tampermonkey
1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension (Chrome, Edge, Firefox, Brave, etc.).
2. Open the raw script URL: `https://raw.githubusercontent.com/<your-org>/dizychat-server/main/scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js`.
3. Tampermonkey will prompt to create a new userscript—review the code, then click **Install**.
4. Visit any `https://rumble.com/` chat; a floating Chat Settings button should appear after the page loads. Click it to configure filters, highlights, DMs, notifications, and backups.

### Manual script injection
If you prefer not to use a userscript manager:

1. Copy the contents of `scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js` to your clipboard.
2. In a Rumble chat tab, open your browser’s developer tools and run the script from the Console, or save it as a bookmarklet/snippet that executes on demand.
3. The script stores settings in `localStorage`, so rerunning it will reload your existing blocklist, filters, and UI customizations.

---

Feel free to open issues or PRs to collaborate on future iterations of DizyChat!
