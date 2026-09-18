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

The hub is **authenticated by default**. JackTrip starts with `-A` and reads a
TLS certificate, private key and credentials file from `ops/dizyjam/runtime/`.

DizyChat is the authority for who may obtain a JackTrip credential:

- the socket must already have joined a DizyChat room successfully;
- registered users keep their signed-in DizyChat identity;
- guests only qualify after DizyChat has admitted their guest name;
- a random per-socket JackTrip password is generated server-side;
- only a salted SHA-512-crypt hash is written to the JackTrip credentials file;
- credentials are revoked from the file on room leave, sign-out or socket
  disconnect, and expire automatically as a safety net;
- one shared-hub room lock prevents separate DizyChat rooms from being issued
  credentials into the same audio mix concurrently.

The JackTrip username contains a safe form of the visible DizyChat name plus a
non-secret per-socket suffix. **The password is never derived from the username.**

JackTrip checks these credentials during connection setup. Removing a credential
immediately prevents new/reconnect attempts, but upstream JackTrip does not
re-authenticate an already-established audio stream on every packet. A user
leaving DizyChat should therefore close JackTrip as well; restarting the hub
forcibly disconnects every active client. A future control-plane slice can add
targeted live-client kick semantics if that becomes necessary.

JackTrip's current authenticated client encrypts the credential exchange with
TLS but does not verify the server certificate in its classic hub-client code.
That protects against passive credential sniffing, while a fully active
man-in-the-middle remains a limitation of upstream JackTrip. The random,
short-lived credentials materially reduce replay exposure, but they are not a
substitute for certificate pinning. For a higher-assurance deployment, add a
trusted private tunnel such as WireGuard or a client build that verifies/pins
the DizyJam certificate.

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

## 2. Create the authentication material

Docker, the Compose plugin and OpenSSL must already be installed.

Create a dedicated JackTrip TLS key/certificate and an empty protected
credentials file before opening any router ports:

```bash
cd ~/DizyChat/ops/dizyjam
cp .env.example .env
bash ./generate-auth-material.sh
ls -la runtime
```

The private key and generated credentials file are runtime secrets and are
ignored by Git.

## 3. Start the authenticated hub

```bash
cd ~/DizyChat/ops/dizyjam
docker compose pull
docker compose up -d
docker compose ps
docker logs --tail=100 dizyjam-jacktrip
```

The logs should say that JackTrip authentication is enabled before it waits for
client connections.

The logs should show the JackTrip hub waiting for client connections.

The Compose service uses host networking and privileged mode because JackTrip's
official container runs JACK with realtime scheduling and locked shared memory.
The JACK base image currently requires a 384 MB `/dev/shm`; smaller values can
make `jackd` crash with `SIGBUS` before JackTrip starts.

## 4. Configure DizyChat

Add these values to the environment used by `dizychat.service`:

```text
ENABLE_DIZYJAM=true
DIZYJAM_HOST=jam.example.com
DIZYJAM_TCP_PORT=4464
DIZYJAM_UDP_BASE_PORT=61002
DIZYJAM_UDP_END_PORT=61100
DIZYJAM_SAMPLE_RATE=48000
DIZYJAM_BUFFER_SIZE=128
DIZYJAM_CREDENTIAL_TTL_SECONDS=7200
```

Replace `jam.example.com` with the real public FQDN or static IP.

Restart DizyChat after changing its environment:

```bash
sudo systemctl restart dizychat.service
```

The Guitar Jam panel will then report **DizyJam Low Latency · Self-hosted · authenticated**.
When an admitted DizyChat user presses **Start DizyJam**, the server mints a
short-lived JackTrip username/password for that socket and returns a copyable
authenticated Hub Client command.

## 5. Client setup

Install the current JackTrip desktop client on each musician's computer.

Recommended Windows path:

- wired Ethernet
- headphones
- ASIO audio interface
- 48 kHz sample rate
- small interface buffer that is stable on the local machine

Connect in **Hub Client** mode to the DIZYJAM_HOST shown in DizyChat.

DizyChat displays the exact authenticated CLI equivalent after issuing the
credential. It has this shape:

```bash
jacktrip -C jam.example.com -A --username DizyUser-<session> --password -q auto --bufstrategy 4
```

JackTrip then prompts for the temporary password with terminal echo disabled,
so the secret is not placed in shell history or the process command line. Do
not reuse or share that password. It is tied to the current admitted DizyChat
socket and is removed from the hub credentials file when that socket
leaves/signs out/disconnects.

DizyChat can remain open for cameras, text and screen sharing. While actively
playing over DizyJam, mute/turn down the LiveKit call audio to avoid hearing a
second delayed copy of the instruments.

## 6. SonoBus fallback

SonoBus remains available from the Guitar Jam panel as an optional peer-to-peer
fallback. It is not required for the primary DizyJam path.
