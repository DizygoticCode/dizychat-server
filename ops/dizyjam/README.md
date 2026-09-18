# DizyJam self-hosted low-latency audio

DizyJam uses the official JackTrip hub-server container for the time-critical
instrument path. DizyChat/LiveKit remains responsible for camera, chat and
screen sharing.

## Audio topology

The hub runs with `--hubpatch 2` (client fan-out/in without loopback).
Each musician hears the other connected musicians but does not receive their
own network-delayed signal back from the hub.

The first deployment intentionally provides one shared low-latency mix.
Do not run unrelated DizyJam groups at the same time until per-room hub
allocation is implemented.

## Security boundary

This first hub is self-hosted but is not yet authenticated against DizyChat
accounts at the JackTrip protocol layer. Anyone who can reach the forwarded
JackTrip ports can attempt to connect.

For a private deployment, restrict source IPs at the firewall/router where
practical. JackTrip supports hub authentication with `-A`, certificates and a
credentials file; wire that in before treating the audio hub as an
Internet-public multi-user service.

## 1. Public network requirements

Use a public static IP or an FQDN that resolves to this server.

Forward these ports from the Internet/router to the DizyJam host:

- TCP 4464
- UDP 61002-61100

If UFW is enabled on the Linux host:

```bash
sudo ufw allow 4464/tcp
sudo ufw allow 61002:61100/udp
```

JackTrip allocates hub worker UDP ports from the configured base port. The
range above leaves capacity for a private group while avoiding the much larger
default public range.

## 2. Start the hub

Docker and the Compose plugin must already be installed.

```bash
cd ~/DizyChat/ops/dizyjam
cp .env.example .env
docker compose pull
docker compose up -d
docker compose ps
docker logs --tail=100 dizyjam-jacktrip
```

The logs should show the JackTrip hub waiting for client connections.

The Compose service uses host networking and privileged mode because JackTrip's
official container runs JACK with realtime scheduling and locked shared memory.

## 3. Configure DizyChat

Add these values to the environment used by `dizychat.service`:

```text
ENABLE_DIZYJAM=true
DIZYJAM_HOST=jam.example.com
DIZYJAM_TCP_PORT=4464
DIZYJAM_UDP_BASE_PORT=61002
DIZYJAM_UDP_END_PORT=61100
DIZYJAM_SAMPLE_RATE=48000
DIZYJAM_BUFFER_SIZE=128
```

Replace `jam.example.com` with the real public FQDN or static IP.

Restart DizyChat after changing its environment:

```bash
sudo systemctl restart dizychat.service
```

The Guitar Jam panel will then report **DizyJam Low Latency · Self-hosted**
and provide the host plus a copyable JackTrip Hub Client command.

## 4. Client setup

Install the current JackTrip desktop client on each musician's computer.

Recommended Windows path:

- wired Ethernet
- headphones
- ASIO audio interface
- 48 kHz sample rate
- small interface buffer that is stable on the local machine

Connect in **Hub Client** mode to the DIZYJAM_HOST shown in DizyChat.

The CLI equivalent for the default hub port is:

```bash
jacktrip -C jam.example.com -q auto --bufstrategy 4
```

DizyChat can remain open for cameras, text and screen sharing. While actively
playing over DizyJam, mute/turn down the LiveKit call audio to avoid hearing a
second delayed copy of the instruments.

## 5. SonoBus fallback

SonoBus remains available from the Guitar Jam panel as an optional peer-to-peer
fallback. It is not required for the primary DizyJam path.
