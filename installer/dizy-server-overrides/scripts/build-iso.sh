#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UBUNTU_VERSION="24.04.4"
BASE_NAME="ubuntu-${UBUNTU_VERSION}-live-server-amd64.iso"
BASE_URL="https://releases.ubuntu.com/24.04/${BASE_NAME}"
SUMS_URL="https://releases.ubuntu.com/24.04/SHA256SUMS"
OUT_DIR="${OUT_DIR:-$ROOT/out}"
CACHE_DIR="${CACHE_DIR:-$ROOT/.cache}"
WORK_DIR="${WORK_DIR:-$ROOT/.work}"
OUT_NAME="DIZY-Server-Installer-${UBUNTU_VERSION}-amd64.iso"
BASE_ISO="$CACHE_DIR/$BASE_NAME"
SUMS_FILE="$CACHE_DIR/SHA256SUMS"
OUT_ISO="$OUT_DIR/$OUT_NAME"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

for cmd in curl xorriso sha256sum python3 git awk grep sed find sort xargs; do
  need "$cmd"
done

rm -rf "$WORK_DIR"
mkdir -p "$CACHE_DIR" "$WORK_DIR" "$OUT_DIR"

printf 'Downloading/verifying Ubuntu Server %s base...\n' "$UBUNTU_VERSION"
curl --fail --location --retry 5 --retry-delay 3 --output "$SUMS_FILE" "$SUMS_URL"
if [[ ! -f "$BASE_ISO" ]]; then
  curl --fail --location --retry 5 --retry-delay 3 --continue-at - --output "$BASE_ISO" "$BASE_URL"
fi
(
  cd "$CACHE_DIR"
  awk -v name="$BASE_NAME" '$2 == "*" name || $2 == name { print }' SHA256SUMS > "${BASE_NAME}.sha256.expected"
  [[ -s "${BASE_NAME}.sha256.expected" ]]
  sha256sum -c "${BASE_NAME}.sha256.expected"
)

printf 'Staging DIZY payload and generating its integrity manifest...\n'
cp -a "$ROOT/dizy" "$WORK_DIR/dizy"
find "$WORK_DIR/dizy" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$WORK_DIR/dizy" -type f -name '*.pyc' -delete
rm -f "$WORK_DIR/dizy/SHA256SUMS"
manifest_tmp="$WORK_DIR/dizy.SHA256SUMS.tmp"
rm -f "$manifest_tmp"
(
  cd "$WORK_DIR/dizy"
  find . -type f ! -name SHA256SUMS -print0 \
    | sort -z \
    | xargs -0 -r sha256sum > "$manifest_tmp"
  mv "$manifest_tmp" SHA256SUMS
)

printf 'Extracting Canonical GRUB configuration and media checksum list...\n'
xorriso -osirrox on -indev "$BASE_ISO" \
  -extract /boot/grub/grub.cfg "$WORK_DIR/grub.cfg.original" \
  -extract /md5sum.txt "$WORK_DIR/md5sum.txt.original" \
  >/dev/null 2>&1

cat "$ROOT/dizy/grub-menu.cfg.fragment" "$WORK_DIR/grub.cfg.original" > "$WORK_DIR/grub.cfg"
# The GRUB config is deliberately modified. Remove only that Canonical md5 entry;
# new /dizy files were never part of the original list and need no removal.
grep -vE '[[:space:]][*]?\.?/?boot/grub/grub\.cfg$' \
  "$WORK_DIR/md5sum.txt.original" > "$WORK_DIR/md5sum.txt"

printf 'Remastering ISO while replaying Canonical BIOS/UEFI boot metadata...\n'
rm -f "$OUT_ISO"
xorriso -indev "$BASE_ISO" -outdev "$OUT_ISO" \
  -boot_image any replay \
  -map "$WORK_DIR/dizy" /dizy \
  -map "$WORK_DIR/grub.cfg" /boot/grub/grub.cfg \
  -map "$WORK_DIR/md5sum.txt" /md5sum.txt \
  -commit -end

printf 'Writing artifact checksum and provenance manifest...\n'
(
  cd "$OUT_DIR"
  sha256sum "$OUT_NAME" > "$OUT_NAME.sha256"
)

ubuntu_sha="$(sha256sum "$BASE_ISO" | awk '{print $1}')"
dizytrades_sha="$(git ls-remote https://github.com/DizygoticCode/DizyTrades.git refs/heads/main | awk '{print $1}')"
dizychat_sha="$(git ls-remote https://github.com/DizygoticCode/dizychat-server.git refs/heads/main | awk '{print $1}')"
built_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
installer_sha="${GITHUB_SHA:-local-uncommitted-source}"

cat > "$OUT_DIR/$OUT_NAME.manifest.txt" <<MANIFEST
DIZY Server Installer
Built: $built_at
Base: Ubuntu Server $UBUNTU_VERSION LTS amd64
Base ISO: $BASE_URL
Base ISO SHA256: $ubuntu_sha
Installer source SHA: $installer_sha
DizyTrades main observed at build: $dizytrades_sha
DizyChat main observed at build: $dizychat_sha
Application install policy: fetch current main over Ethernet at installation time
Node runtime: 22.23.1
DizyTrades execution defaults: OFF
MANIFEST

printf '\nBuilt: %s\n' "$OUT_ISO"
cat "$OUT_DIR/$OUT_NAME.sha256"
