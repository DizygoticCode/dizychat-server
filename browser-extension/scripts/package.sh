#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
SOURCE="$REPO_ROOT/scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js"
VERSION="$(sed -nE 's#^//[[:space:]]*@version[[:space:]]+([^[:space:]]+).*#\1#p' "$SOURCE" | head -1)"
if [[ -z "$VERSION" ]]; then
  echo "Could not determine extension version" >&2
  exit 1
fi
cd "$ROOT/dist"
rm -f "dizygotic-rumble-chat-companion-v${VERSION}-chromium.zip" \
      "dizygotic-rumble-chat-companion-v${VERSION}-firefox.zip" \
      "dizygotic-rumble-chat-companion-v${VERSION}-safari-source.zip" \
      SHA256SUMS.txt
( cd chromium && zip -qr "../dizygotic-rumble-chat-companion-v${VERSION}-chromium.zip" . )
( cd firefox && zip -qr "../dizygotic-rumble-chat-companion-v${VERSION}-firefox.zip" . )
( cd safari && zip -qr "../dizygotic-rumble-chat-companion-v${VERSION}-safari-source.zip" . )
sha256sum *.zip > SHA256SUMS.txt
cat SHA256SUMS.txt
