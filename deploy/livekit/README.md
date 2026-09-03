# Self-hosted LiveKit

This Compose service runs the media server used by DizyChat's existing call integration. It does **not** enable calls in DizyChat and it does not change any production environment.

## Generate credentials and start

Requirements: a Linux host with Docker Compose v2 and OpenSSL. From the repository root:

```bash
./deploy/livekit/generate-config.sh
# Review deploy/livekit/livekit.yaml before starting.
docker compose -f deploy/livekit/compose.yaml config --quiet
docker compose -f deploy/livekit/compose.yaml up -d
```

The generator creates the ignored, mode-`0600` `deploy/livekit/livekit.yaml` from the safe template and prints the three values to install in DizyChat's protected runtime environment. It refuses to replace an existing config. Back up the generated credentials in a secrets manager; losing or rotating them requires updating DizyChat at the same time.

The Compose service uses host networking because WebRTC needs a large, predictable UDP range and because address/port translation can produce unusable ICE candidates. Host networking is intended for Linux and means the ports below bind directly on `dizyserver`. Do not run a second service on them.

## Network and TLS

Allow these inbound ports through the host firewall, provider firewall, and any upstream NAT:

| Port | Protocol | Purpose |
| --- | --- | --- |
| `7880` | TCP | LiveKit HTTP/WebSocket signaling; bind it privately or firewall it so clients use the TLS proxy. |
| `7881` | TCP | WebRTC ICE/TCP fallback; expose directly (TLS termination does not proxy this media port). |
| `50000-50100` | UDP | Primary WebRTC ICE media range; expose/forward every port one-to-one. |

For an internet deployment, route a hostname you control to the server and terminate trusted TLS at an existing reverse proxy on TCP `443`. Proxy HTTP **and WebSocket upgrades** to `http://127.0.0.1:7880`, using long/no response timeouts. Set DizyChat `LIVEKIT_URL` to that proxy's `wss://` URL. Do not publish plain `ws://` signaling to internet browsers. Keep TCP `7880` blocked from the public internet after the proxy works, while `7881/tcp` and `50000-50100/udp` remain directly reachable. Calls also require DizyChat itself to use HTTPS so browsers can access microphones and cameras.

`rtc.use_external_ip: true` asks LiveKit to discover and advertise the public address. If `dizyserver` is behind NAT, forward the TCP/UDP media ports one-to-one and verify that discovery returns the NAT's public address; symmetric NAT or carrier-grade NAT generally requires a public VM or a separately configured TURN service. If the host has multiple interfaces or discovery is wrong, set `rtc.node_ip` explicitly to the client-reachable public address.

For LAN-only use, TLS is still recommended (and is required for non-localhost browser media permissions). Set `rtc.use_external_ip: false`, add `rtc.node_ip: <reachable-LAN-IP>`, use split DNS or a LAN hostname with a certificate trusted by every client, and set `LIVEKIT_URL=wss://<that-hostname>`. A temporary developer-only check may use `ws://<LAN-IP>:7880`, but many browsers will deny microphone/camera access from an insecure DizyChat page.

## DizyChat environment contract

Install these values in DizyChat's existing protected environment (not a checked-in `.env`):

```dotenv
LIVEKIT_URL=wss://<hostname-you-configured-for-livekit>
LIVEKIT_API_KEY=<key-generated-in-livekit.yaml>
LIVEKIT_API_SECRET=<secret-generated-in-livekit.yaml>
```

`LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must exactly match the single entry under `keys:` in `livekit.yaml`. The URL is client-facing: it must be resolvable and reachable from users' browsers, not merely from the DizyChat container. Do not set it to the Compose service name or `localhost` unless every caller is on that same machine. `ENABLE_VOICE_CALLS` can remain unset until deployment is ready; setting all three variables makes the existing server consider LiveKit configured, so coordinate the environment change with the intended rollout.

## Operations

```bash
docker compose -f deploy/livekit/compose.yaml ps
docker compose -f deploy/livekit/compose.yaml logs -f livekit
docker compose -f deploy/livekit/compose.yaml pull
docker compose -f deploy/livekit/compose.yaml up -d
docker compose -f deploy/livekit/compose.yaml down
```

The image is pinned to a reviewed release rather than `latest`. Test release upgrades in a staging call before changing the tag. This single-node slice is suitable for one self-hosted DizyChat host; multi-node LiveKit requires Redis and load-balancing/ICE routing beyond this configuration.
