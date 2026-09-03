#!/bin/sh
set -eu

cd "$(dirname "$0")"
if [ -e livekit.yaml ]; then
  echo "deploy/livekit/livekit.yaml already exists; refusing to overwrite it." >&2
  exit 1
fi

umask 077
api_key="$(openssl rand -hex 16)"
api_secret="$(openssl rand -base64 36 | tr -d '\n')"
sed \
  -e "s/LIVEKIT_API_KEY_PLACEHOLDER/$api_key/" \
  -e "s|LIVEKIT_API_SECRET_PLACEHOLDER|$api_secret|" \
  livekit.yaml.example > livekit.yaml

cat <<EOF_OUTPUT
Created deploy/livekit/livekit.yaml with mode 600.
Configure DizyChat's protected runtime environment with:
  LIVEKIT_URL=wss://<your-livekit-host>
  LIVEKIT_API_KEY=$api_key
  LIVEKIT_API_SECRET=$api_secret
Then follow README.md to configure TLS, firewall/NAT, and start LiveKit.
EOF_OUTPUT
