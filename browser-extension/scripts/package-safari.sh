#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/safari-xcode"
rm -rf "$OUT"
xcrun safari-web-extension-packager "$ROOT/dist/safari" \
  --project-location "$OUT" \
  --app-name "Dizygotic Rumble Chat Companion" \
  --bundle-identifier "com.dizygotic.rumblechatcompanion" \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force
