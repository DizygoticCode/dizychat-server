#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV=production
export PATH="/usr/local/bin:$PATH"

echo "[start] Starting Dizy server + persistent soundboard loader"
echo "[start] Node version: $(node -v)"

# -------------------------------
# ✅ Persistent Disk Setup (reuse the same disk)
# -------------------------------
DISK_ROOT="/var/soundboards"        # this is your existing mounted disk
SB_DIR="$DISK_ROOT"                  # soundboards live at the disk root
UPLOADS_DIR="$DISK_ROOT/uploads"     # uploads live in a subfolder on the same disk

# Ensure disk root exists (it will if mounted)
mkdir -p "$DISK_ROOT"

# Link public/soundboards -> /var/soundboards
rm -rf public/soundboards 2>/dev/null || true
ln -s "$SB_DIR" public/soundboards
echo "[disk] Linked public/soundboards -> $SB_DIR"

# Link public/uploads -> /var/soundboards/uploads
mkdir -p "$UPLOADS_DIR"
rm -rf public/uploads 2>/dev/null || true
ln -s "$UPLOADS_DIR" public/uploads
echo "[disk] Linked public/uploads -> $UPLOADS_DIR"


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
# ----- Persistent uploads directory -----
UPLOADS_DISK="/var/uploads"
UPLOADS_PUB="public/uploads"

mkdir -p "$UPLOADS_DISK"
rm -rf "$UPLOADS_PUB" 2>/dev/null || true
ln -s "$UPLOADS_DISK" "$UPLOADS_PUB"
echo "[disk] Linked $UPLOADS_PUB -> $UPLOADS_DISK"

# -------------------------------
# ✅ Start Server
# -------------------------------
echo "[start] Launching API/server…"
exec node index.js
