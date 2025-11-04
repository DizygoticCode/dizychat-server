#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV=production

echo "[start] Starting Dizy server and background soundboard loader…"
echo "[start] Node version: $(node -v)"

# Create soundboards dir if missing
mkdir -p public/soundboards

# Background download task (non-blocking startup)
(
  echo "[dl] Checking soundboard list…"
  while IFS= read -r line; do
    # trim whitespace
    line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

    # skip blanks and comments
    [ -z "$line" ] && continue
    case "$line" in \#*) continue;; esac

    # parse "<url>|<title>" or "<url>"
    url="${line%%|*}"
    title="${line#*|}"
    [ "$title" = "$url" ] && title=""

    echo "[dl] Fetching: $url"

    if [ -n "$title" ]; then
      node scripts/download-101-soundboard.js \
        --board "$url" \
        --title "$title" \
        --resume \
        --concurrency 3 \
        --delayMs 150
    else
      node scripts/download-101-soundboard.js \
        --board "$url" \
        --resume \
        --concurrency 3 \
        --delayMs 150
    fi
  done < data/soundboards/board.txt
  echo "[dl] All boards processed."
) &

# Start your Node server
echo "[start] Launching app now…"
exec node index.js
