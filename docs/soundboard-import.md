# 101Soundboards Import Cheat Sheet

This guide walks through downloading entire boards from [101soundboards.com](https://www.101soundboards.com) into the local soundboard cache so they can be served offline by the `/soundboard-clips` endpoint.

## Prerequisites

- Node.js 16+ installed locally.
- Network access to `www.101soundboards.com` (some corporate VPNs block media domains—disable them if the script reports `ENOTFOUND` or `ECONNRESET`). If the site shows a bot-check page in your browser, copy the resulting cookie into `SB_101SOUNDBOARDS_COOKIE` before running the importer.
- A populated board list under `data/soundboards/board.txt` or another list file you plan to pass to the importer.

## 1. Review or curate your board list

Update `data/soundboards/board.txt` (or copy `boards.sample.txt`) so each non-comment line includes a board slug or full URL. You can optionally append a custom display title after a pipe (`|`). Example:

```
https://www.101soundboards.com/boards/2-the-memes-soundboard|Meme Classics
https://www.101soundboards.com/boards/14133-vine-boom|Vine Boom Variations
sad-violin|Sad Reactions
```

Anything prefixed with `#` is ignored. When the importer runs with **no flags**, it automatically looks for `board.txt`, `boards.txt`, `boards.list`, or `boards.sample.txt` under `data/soundboards/`.

## 2. Run the importer

Execute the downloader from the project root. Leave out `--skip-audio` so each clip is saved locally under `public/soundboards/<board-id>/`.

```bash
node scripts/download-101-soundboard.js
```

If you maintain multiple lists, point the script at the correct file:

```bash
node scripts/download-101-soundboard.js --list data/soundboards/my-boards.txt
```

You can also import a single board on demand:

```bash
node scripts/download-101-soundboard.js --board https://www.101soundboards.com/boards/21561-sad-violin
```

The script prints each clip as it downloads it. On success you will see messages similar to:

```
Fetching board https://www.101soundboards.com/boards/2-the-memes-soundboard
Downloading Bruh → bruh.mp3
Downloading Sad Trombone → sad-trombone.mp3
Imported 32 clips into board '2-the-memes-soundboard'.
```

## 3. Verify downloads and metadata

- Audio files are written to `public/soundboards/<board-id>/`. Because this directory is gitignored, the clips stay local and are not accidentally committed.
- Metadata lives in `data/soundboards/<board-id>.json`. These JSON definitions **are** tracked by git—commit them so the server knows about the boards.
- The importer automatically keeps `data/soundboards/index.json` in sync with the board IDs you import. There is no need to edit it manually.

If you need the files in version control (for example, to publish a release bundle), move them outside `public/soundboards/` before committing or adjust `.gitignore` temporarily. Most teams prefer to ship the binaries through object storage or release artifacts instead of git.

## 4. Serve the new boards

Restart the development server if it was running:

```bash
npm start
```

The `/soundboard-clips` endpoint now exposes the newly imported boards, and the chat composer picker will display them automatically.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Request failed with status 403/404` | First, open the board in a real browser to confirm it still exists. If you are shown a bot-check, copy the cookie value into the `SB_101SOUNDBOARDS_COOKIE` environment variable so the importer can reuse it. If the board is gone, remove it from the list and rerun. |
| `Network error (ENOTFOUND / ECONNRESET)` | Check your connection, disable VPNs, or retry—some hosts throttle repeated downloads. |
| Script exits immediately with “No boards to import” | Ensure your list file contains at least one non-comment line or pass `--board <slug>`. |
| Files downloaded but not usable in git | This is intentional. The repo ignores `public/soundboards/*` to keep pull requests light. Commit the JSON files only; distribute audio separately if needed. |

With these steps you can refresh the offline soundboard catalog whenever you curate a new batch of meme clips.
