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
  local system_nvme runtime_source runtime wrapper

  system_nvme="$(command -v nvme 2>/dev/null || true)"
  if [[ -n "$system_nvme" ]] && "$system_nvme" version >/dev/null 2>&1; then
    NVME_BIN="$system_nvme"
    export NVME_BIN
    return 0
  fi

  # The installation medium may be mounted noexec. Treat /cdrom only as a
  # read-only source, then copy the complete bundled nvme runtime into /run
  # before executing its loader and binary.
  runtime_source=/cdrom/dizy/nvme-runtime
  [[ -r "$runtime_source/nvme" ]] || fatal "Bundled nvme-cli runtime is missing from the installation media."
  [[ -r "$runtime_source/ld-linux-x86-64.so.2" ]] || fatal "Bundled nvme-cli loader is missing from the installation media."
  [[ -d "$runtime_source/lib" ]] || fatal "Bundled nvme-cli libraries are missing from the installation media."

  runtime=/run/dizy-nvme-runtime
  rm -rf "$runtime"
  mkdir -p "$runtime"
  cp -a "$runtime_source/." "$runtime/"
  chmod 0755 "$runtime/nvme" "$runtime/ld-linux-x86-64.so.2"

  wrapper=/run/dizy-nvme
  cat > "$wrapper" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
runtime=/run/dizy-nvme-runtime
exec "$runtime/ld-linux-x86-64.so.2" \
  --library-path "$runtime/lib" \
  "$runtime/nvme" "$@"
WRAPPER
  chmod 0755 "$wrapper"

  "$wrapper" version >/dev/null 2>&1 || fatal "Bundled nvme-cli runtime cannot execute in the live environment."
  NVME_BIN="$wrapper"
  export NVME_BIN
}
'''
if old not in text:
    raise SystemExit('expected original ensure_nvme_cli block not found; refusing blind patch')
path.write_text(text.replace(old, new, 1))
PY

chmod +x "$file"
