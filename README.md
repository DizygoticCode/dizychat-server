# DizyChat Server

DizyChat is a Socket.IO and Express-powered real-time chat backend designed for music and community discussions. It ships with MongoDB persistence, media uploads with antivirus scanning, granular moderation, and rich UX niceties such as link previews and GIF embedding.

## Features

### Realtime chat engine
- Uses **Socket.IO** atop an Express HTTP server for bidirectional messaging, typing indicators, message delivery/read receipts, and live room membership updates.
- Persists chat history, reactions, pins, stars, replies, and delivery status in MongoDB through a comprehensive `Message` schema.
- Provides paginated history fetching so clients can lazy-load older messages without over-fetching.

### Media uploads with antivirus scanning
- Accepts any file type via `/upload`, stores assets under `public/uploads`, and advertises the configured size limit in logs.
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
- Packs a Tenor GIF browser and a Pixabay-powered audio soundboard directly into the message composer.

### Client experience helpers
- Broadcasts typing status with rate limiting to prevent spam.
- Provides `/version` endpoint exposing build metadata for clients to surface release information.
- Serves the bundled front-end from `public/` with a catch-all route for client-side routing.

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
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Optional default admin credential pair. |
| `ADMIN_CREDENTIALS` | Comma-separated list of `username:password` pairs for multiple admins. |
| `MESSAGE_HISTORY_CHUNK_SIZE` | Page size (25-500) for history fetches; defaults to 150. |
| `MAX_UPLOAD_SIZE_MB` | File upload cap; accepts values like `50`, `50mb`, or `2gb`. Use `unlimited` to disable the limit. |
| `METADEFENDER_API_KEY` | **Required for uploads.** OPSWAT MetaDefender Cloud API key used to scan files. |
| `METADEFENDER_BASE_URL` | (Optional) Override the MetaDefender API origin. Defaults to `https://api.metadefender.com/v4`. |
| `METADEFENDER_POLL_INTERVAL_MS` | (Optional) Milliseconds between status polls; defaults to 1500 (bounded between 250-15000). |
| `METADEFENDER_MAX_POLL_ATTEMPTS` | (Optional) Maximum polling attempts before timing out; defaults to 10 (bounded between 1-40). |
| `PIXABAY_API_KEY` | Legacy Pixabay proxy key (no longer used now that soundboards are stored locally). Safe to omit. |

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
Accepts multipart form field `file`. Returns `{ url, name, type, size }` for clean files; otherwise reports validation or antivirus failures.

### `GET /link-preview?url=...`
Fetches metadata for an absolute URL and responds with normalized preview attributes. Non-HTML content returns empty fields.

### `GET /tenor-proxy?url=...`
Resolves a Tenor share URL to embeddable GIF URLs via Tenor oEmbed.

### `GET /soundboard-clips`
Returns locally curated soundboard clips aggregated from JSON definitions in `data/soundboards`. Accepts optional `q` and `board` query parameters for search filtering and responds with normalized clip metadata for the soundboard picker.

### Importing meme boards from 101Soundboards

The repository now stores soundboard metadata locally instead of proxying Pixabay. Use `scripts/download-101-soundboard.js` to mirror boards from [101soundboards.com](https://www.101soundboards.com/):

```bash
# Import a single board by slug or URL
node scripts/download-101-soundboard.js --board https://www.101soundboards.com/boards/<board-slug>

# Import several boards listed in a text file (one slug/URL per line, optional "| Custom Title")
node scripts/download-101-soundboard.js --list data/soundboards/boards.sample.txt

# When no flags are passed the script will look for data/soundboards/board.txt (or boards.txt)
node scripts/download-101-soundboard.js

# Capture only metadata and reference remote audio without downloading binaries
node scripts/download-101-soundboard.js --board <slug> --skip-audio
```

Each successful import rewrites `data/soundboards/<board>.json` with the clip metadata, records the upstream board URL, and ensures `data/soundboards/index.json` references the board. Duplicate or commented lines in the list file are ignored. By default the script downloads every clip into `public/soundboards/<board>/`; pass `--skip-audio` (or `--remote-only`) if you prefer to keep the repo binary-free and stream directly from 101Soundboards at runtime.

See `data/soundboards/boards.sample.txt` for a commented template you can copy and customise for batch imports. The repository now also includes `data/soundboards/board.txt` pre-populated with a meme-heavy starter list—update it with the boards you care about and run the importer with no extra flags to refresh everything in one go.

The `public/soundboards` directory remains gitignored so audio payloads never end up in commits. Commit only the JSON definitions; if you need to distribute the audio assets, publish them through your own storage or ship them as a separate artifact bundle.

All other paths serve the front-end single-page app from `public/index.html`.

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
| `room list` | Server → Client | Broadcasts current public rooms and occupant counts. |

## Security considerations

- All user text and filenames are sanitized before persistence or broadcast to avoid XSS vectors.
- Room passwords, admin credentials, and mute/block lists are normalized to avoid casing mismatches.
- File uploads must pass antivirus checks; failure removes the file and notifies the client.

## Deployment notes

- Behind a reverse proxy, ensure WebSocket upgrades are forwarded to the Node server.
- Provision persistent storage for `public/uploads` if you need to retain files across deploys.
- Configure process managers (PM2, systemd, Docker, etc.) to supply environment variables securely.
- Scale horizontally by sharing the same MongoDB and enabling a Socket.IO adapter (e.g., Redis) if broadcasting across instances is required.

## Roadmap ideas

- Automated tests for moderation workflows and file scanning fallbacks.
- Redis or MongoDB change streams for cross-instance Socket.IO scaling.
- Rate-limited public APIs to expose room listings and message statistics.

---

Feel free to open issues or PRs to collaborate on future iterations of DizyChat!
