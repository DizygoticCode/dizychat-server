#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required to create DizyJam authentication material." >&2
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

host="${DIZYJAM_HOST:-dizyjam.local}"
runtime_dir="${DIZYJAM_AUTH_DIR:-$(pwd)/runtime}"
cert_file="${DIZYJAM_AUTH_CERT_FILE:-$runtime_dir/jacktrip.crt}"
key_file="${DIZYJAM_AUTH_KEY_FILE:-$runtime_dir/jacktrip.key}"
creds_file="${DIZYJAM_AUTH_CREDS_FILE:-$runtime_dir/auth}"
auth_gid="${DIZYJAM_AUTH_GID:-63}"

mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"

if [[ ! -f "$key_file" || ! -f "$cert_file" ]]; then
  echo "Generating dedicated DizyJam TLS key/certificate for CN=$host"
  openssl req     -x509     -sha256     -nodes     -days 825     -newkey rsa:3072     -keyout "$key_file"     -out "$cert_file"     -subj "/CN=$host"
else
  echo "DizyJam TLS key/certificate already exist; leaving them unchanged."
fi

if [[ ! -f "$creds_file" ]]; then
  : > "$creds_file"
fi

# JackTrip runs as a non-root service user in the official container. Keep
# DizyChat as the owner/writer, but grant the container audio group read-only
# access. The setgid runtime directory makes future atomic auth-file rewrites
# inherit the same group.
if ! chgrp "$auth_gid" "$runtime_dir" "$key_file" "$cert_file" "$creds_file" 2>/dev/null; then
  if command -v sudo >/dev/null 2>&1; then
    echo "Assigning DizyJam runtime group GID $auth_gid (sudo may prompt)..."
    sudo chgrp "$auth_gid" "$runtime_dir" "$key_file" "$cert_file" "$creds_file"
  else
    echo "Unable to assign DizyJam runtime group GID $auth_gid." >&2
    echo "Run this script as a user allowed to chgrp these files, or set DIZYJAM_AUTH_GID." >&2
    exit 1
  fi
fi

chmod 2750 "$runtime_dir"
chmod 640 "$key_file" "$creds_file"
chmod 644 "$cert_file"

echo
echo "DizyJam authentication material is ready:"
echo "  certificate: $cert_file"
echo "  private key: $key_file"
echo "  credentials: $creds_file"
echo "  reader GID:  $auth_gid"
echo
echo "The credentials file intentionally starts empty."
echo "DizyChat will add short-lived salted password hashes for admitted users."
