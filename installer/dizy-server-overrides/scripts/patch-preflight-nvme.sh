#!/usr/bin/env bash
set -euo pipefail

file="${1:?usage: patch-preflight-nvme.sh <preflight.sh>}"
python3 - "$file" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = '''ensure_nvme_cli() {
  if command -v nvme >/dev/null 2>&1; then
    NVME_BIN="$(command -v nvme)"
    export NVME_BIN
    return 0
  fi

  local pkg extract
  pkg="$(find /cdrom/pool/main/n/nvme-cli -maxdepth 1 -type f -name 'nvme-cli_*_amd64.deb' 2>/dev/null | head -n1 || true)"
  [[ -n "$pkg" ]] || fatal "nvme-cli is unavailable on the installation media."
  extract=/run/dizy-nvme-cli
  rm -rf "$extract"
  mkdir -p "$extract"
  dpkg-deb -x "$pkg" "$extract"
  NVME_BIN="$(find "$extract" -type f -name nvme -perm -0100 | head -n1 || true)"
  [[ -x "$NVME_BIN" ]] || fatal "Could not extract a working nvme-cli binary."
  export NVME_BIN
}
'''
new = '''ensure_nvme_cli() {
  if command -v nvme >/dev/null 2>&1; then
    NVME_BIN="$(command -v nvme)"
    export NVME_BIN
    return 0
  fi

  local pkg extract candidate link
  pkg="$(find /cdrom/pool/main/n/nvme-cli -maxdepth 1 -type f -name 'nvme-cli_*_amd64.deb' 2>/dev/null | head -n1 || true)"
  [[ -n "$pkg" ]] || fatal "nvme-cli is unavailable on the installation media."

  extract=/run/dizy-nvme-cli
  rm -rf "$extract"
  mkdir -p "$extract"
  dpkg-deb -x "$pkg" "$extract"

  # Ubuntu media may package /usr/bin/nvme as a symlink. The old probe used
  # `find -type f -name nvme`, which ignores symlinks and stopped before the
  # installer could even inspect the target disk. Resolve the packaged entry
  # entirely from /cdrom; no network or PXE dependency is permitted here.
  NVME_BIN=""
  for candidate in \
    "$extract/usr/bin/nvme" \
    "$extract/usr/sbin/nvme" \
    "$extract/bin/nvme" \
    "$extract/sbin/nvme"; do
    [[ -e "$candidate" || -L "$candidate" ]] || continue
    if [[ -L "$candidate" ]]; then
      link="$(readlink "$candidate")"
      if [[ "$link" == /* ]]; then
        candidate="$extract$link"
      else
        candidate="$(dirname "$candidate")/$link"
      fi
    fi
    if [[ -f "$candidate" && -x "$candidate" ]]; then
      NVME_BIN="$candidate"
      break
    fi
  done

  if [[ -z "$NVME_BIN" ]]; then
    NVME_BIN="$(find "$extract" -type f -perm /111 \( -name nvme -o -name 'nvme.*' -o -name 'nvme-*' \) -print 2>/dev/null | head -n1 || true)"
  fi

  [[ -n "$NVME_BIN" && -x "$NVME_BIN" ]] || fatal "Could not extract a working nvme-cli binary from the installation media."
  "$NVME_BIN" version >/dev/null 2>&1 || fatal "The nvme-cli binary on the installation media cannot run in the live environment."
  export NVME_BIN
}
'''
if old not in text:
    raise SystemExit('expected original ensure_nvme_cli block not found; refusing blind patch')
path.write_text(text.replace(old, new, 1))
PY

chmod +x "$file"
