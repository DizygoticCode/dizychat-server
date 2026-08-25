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
  local system_nvme runtime wrapper

  system_nvme="$(command -v nvme 2>/dev/null || true)"
  if [[ -n "$system_nvme" ]] && "$system_nvme" version >/dev/null 2>&1; then
    NVME_BIN="$system_nvme"
    export NVME_BIN
    return 0
  fi

  # Do not trust the package layout inside /cdrom/pool here. The live-server
  # environment and the package pool are not the same root filesystem, and a
  # dynamically linked nvme binary can exist yet still be unusable because its
  # shared-library dependencies are absent. The ISO builder therefore embeds a
  # known-good nvme-cli binary together with every library reported by ldd.
  # This fallback is fully offline and is verified from the finished ISO.
  runtime=/cdrom/dizy/nvme-runtime
  [[ -x "$runtime/nvme" ]] || fatal "Bundled nvme-cli runtime is missing from the installation media."
  [[ -d "$runtime/lib" ]] || fatal "Bundled nvme-cli libraries are missing from the installation media."

  wrapper=/run/dizy-nvme
  cat > "$wrapper" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
export LD_LIBRARY_PATH="/cdrom/dizy/nvme-runtime/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec /cdrom/dizy/nvme-runtime/nvme "$@"
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
