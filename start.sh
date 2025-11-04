#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV=production
export PATH="/usr/local/bin:$PATH"

echo "[start] Starting Dizy server + persistent soundboard loader"
echo "[start] Node version: $(node -v)"

# -------------------------------
# ✅ Persistent Disk Setup
# -------------------------------
DISK_DIR="/var/soundboards"
APP_DIR="public/soundboards"

echo "[disk] Ensuring persistent disk is mounted at $DISK_DIR…"
mkdir -p "$DISK_DIR"

echo "[disk] Linking $APP_DIR -> $DISK_DIR"
rm -rf "$APP_DIR" 2>/dev/null || true
ln -s "$DISK_DIR" "$APP_DIR"

# -------------------------------
# ✅ Background Downloader
# -------------------------------
SB_CONCURRENCY="${SB_CONCURRENCY:-4}"
SB_DELAY_MS="${SB_DELAY_MS:-100}"

(
  echo "[dl] Starting soundboard import in background"
  echo "[dl] Concurrency=$SB_CONCURRENCY Delay=${SB_DELAY_MS}ms"

  BOARD_FILE="data/soundboards/board.txt"

  if [ ! -f "$BOARD_FILE" ]; then
    echo "[dl] WARNING: $BOARD_FILE not found — skipping download"
    exit 0
  fi

  while IFS= read -r line; do
    # Trim whitespace
    line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

    # Skip blank or comment lines
    [ -z "$line" ] && continue
    case "$line" in \#*) continue;; esac

    url="${line%%|*}"
    title="${line#*|}"
    [ "$title" = "$url" ] && title=""

    echo "[dl] Fetching: $url ${title:+($title)}"

    if [ -n "$title" ]; then
      node scripts/download-101-soundboard.js \
        --board "$url" \
        --title "$title" \
        --resume \
        --concurrency "$SB_CONCURRENCY" \
        --delayMs "$SB_DELAY_MS"
    else
      node scripts/download-101-soundboard.js \
        --board "$url" \
        --resume \
        --concurrency "$SB_CONCURRENCY" \
        --delayMs "$SB_DELAY_MS"
    fi

  done < "$BOARD_FILE"

  echo "[dl] ✅ Finished board.txt processing"
) &

# -------------------------------
# ✅ Start Server
# -------------------------------
echo "[start] Launching API/server…"
exec node index.js
