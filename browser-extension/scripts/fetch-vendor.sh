#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
mkdir -p "$VENDOR"

curl --fail --location --retry 3 --silent --show-error \
  'https://unpkg.com/compromise@14.7.0/builds/compromise.min.js' \
  -o "$VENDOR/compromise.min.js"

curl --fail --location --retry 3 --silent --show-error \
  'https://unpkg.com/rita@3.2.16/dist/rita.min.js' \
  -o "$VENDOR/rita.min.js"

printf 'compromise: '; wc -c < "$VENDOR/compromise.min.js"
printf 'RiTa:       '; wc -c < "$VENDOR/rita.min.js"
