'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
const chat = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
const css = fs.readFileSync(path.join(repoRoot, 'public', 'chat.css'), 'utf8');
const compose = fs.readFileSync(path.join(repoRoot, 'ops', 'dizyjam', 'docker-compose.yml'), 'utf8');
const readme = fs.readFileSync(path.join(repoRoot, 'ops', 'dizyjam', 'README.md'), 'utf8');
const generator = fs.readFileSync(path.join(repoRoot, 'ops', 'dizyjam', 'generate-auth-material.sh'), 'utf8');

test('Guitar Jam exposes Music Call, authenticated self-hosted DizyJam, and SonoBus fallback only', () => {
  assert.match(server, /id:\s*['"]music-call['"]/);
  assert.match(server, /id:\s*['"]dizyjam['"]/);
  assert.match(server, /id:\s*['"]sonobus['"]/);
  assert.doesNotMatch(server, /app\.jacktrip\.org\/studios\/create/);
  assert.doesNotMatch(chat, /Try JackTrip free/);
  assert.match(chat, /Start Music Call/);
  assert.match(chat, /Start DizyJam/);
  assert.match(chat, /Use SonoBus fallback/);
  assert.match(server, /Self-hosted · authenticated/);
});

test('Music Call launches the existing LiveKit call with Music mode selected', () => {
  assert.match(chat, /dizychat:start-music-call/);
  assert.match(chat, /chooseMusicMode\(true\)/);
  assert.match(chat, /await joinCall\(\)/);
  assert.match(chat, /window\.dispatchEvent\(new CustomEvent\(["']dizychat:start-music-call["']\)\)/);
});

test('DizyJam is unavailable until host plus TLS auth material exist', () => {
  assert.match(server, /DIZYJAM_HOST/);
  assert.match(server, /DIZYJAM_AUTH_CERT_FILE/);
  assert.match(server, /DIZYJAM_AUTH_KEY_FILE/);
  assert.match(server, /DIZYJAM_AUTH_CREDS_FILE/);
  assert.match(server, /DIZYJAM_CREDENTIAL_TTL_SECONDS/);
  assert.match(server, /const DIZYJAM_AUTH_FILES_READY = \(\) =>/);
  assert.match(server, /const DIZYJAM_ENABLED = \(\) =>[\s\S]{0,180}!DIZYJAM_DISABLED[\s\S]{0,180}DIZYJAM_AUTH_FILES_READY\(\)[\s\S]{0,180}dizyJamCredentialStoreReady/);
  assert.match(server, /getDizyJamMissingConfig/);
});

test('DizyJam credentials are issued only over an admitted DizyChat socket', () => {
  assert.match(server, /socket\.on\(['"]jam:dizyjam-credentials['"]/);
  assert.match(server, /normaliseRoomName\(socket\.currentRoom\)/);
  assert.match(server, /\['account', 'guest'\]\.includes\(identityKind\)/);
  assert.match(server, /dizyJamCredentialStore\.issue\(/);
  assert.match(server, /DIZYJAM_ROOM_REQUIRED/);
  assert.match(server, /DIZYJAM_IDENTITY_REQUIRED/);
  assert.match(server, /DIZYJAM_BUSY/);
  assert.match(server, /DIZYJAM_RATE_LIMITED/);
  assert.match(server, /DIZYJAM_SOCKET_AUTH_REQUIRED/);
  assert.match(server, /dizyJamCredentialStoreReady = true/);
  assert.doesNotMatch(server, /else if \(provider\.id === 'dizyjam'\) \{[\s\S]{0,1200}session\.password =/);
});

test('DizyJam credentials are revoked on room leave, sign-out, and disconnect', () => {
  const revokeMatches = server.match(/dizyJamCredentialStore\.revokeSocket\(socket\.id\)/g) || [];
  assert.ok(revokeMatches.length >= 3, 'expected room/sign-out/disconnect credential revocation');
  assert.match(server, /const removeSocketFromRoom = \(socket, targetRoom\) => \{[\s\S]{0,500}dizyJamCredentialStore\.revokeSocket\(socket\.id\)/);
  assert.match(server, /socket\.on\(['"]account logout['"][\s\S]{0,500}dizyJamCredentialStore\.revokeSocket\(socket\.id\)/);
  assert.match(server, /socket\.on\(['"]disconnect['"][\s\S]{0,500}dizyJamCredentialStore\.revokeSocket\(socket\.id\)/);
});

test('DizyJam client requests credentials over Socket.IO and renders authenticated details', () => {
  assert.match(chat, /socket\.emit\(["']jam:dizyjam-credentials["']/);
  assert.match(chat, /requestDizyJamSession/);
  assert.match(chat, /session\.username/);
  assert.match(chat, /JackTrip user/);
  assert.match(chat, /Credential expires/);
  assert.match(chat, /provider === ["']dizyjam["'][\s\S]{0,160}requestDizyJamSession\(\)/);
  assert.doesNotMatch(server, /['"]--password['"],\s*credential\.password/);
  assert.match(server, /['"]--password['"],\s*['"]-q['"]/);
});

test('self-hosted hub requires JackTrip authentication and avoids delayed self-loop', () => {
  assert.match(compose, /jacktrip\/jacktrip:latest/);
  assert.match(compose, /network_mode:\s*host/);
  assert.match(compose, /privileged:\s*true/);
  assert.match(compose, /-A/);
  assert.match(compose, /--certfile \/dizyjam-auth\/jacktrip\.crt/);
  assert.match(compose, /--keyfile \/dizyjam-auth\/jacktrip\.key/);
  assert.match(compose, /--credsfile \/dizyjam-auth\/auth/);
  assert.match(compose, /\.\/runtime:\/dizyjam-auth:ro/);
  assert.match(compose, /--hubpatch 2/);
  assert.match(compose, /--bufstrategy 4/);
  assert.match(compose, /-q auto/);
  assert.match(compose, /-U \$\{DIZYJAM_UDP_BASE_PORT:-61002\}/);
});

test('auth material generator protects private runtime files', () => {
  assert.match(generator, /openssl req/);
  assert.match(generator, /rsa:3072/);
  assert.match(generator, /chmod 700 ["']?\$runtime_dir/);
  assert.match(generator, /chmod 600 ["']?\$key_file["']? ["']?\$creds_file/);
  assert.doesNotMatch(generator, /echo .*password/i);
});

test('deployment guide documents authenticated admission and upstream certificate-verification limitation', () => {
  assert.match(readme, /TCP 4464/);
  assert.match(readme, /UDP 61002-61100/);
  assert.match(readme, /authenticated by default/);
  assert.match(readme, /random per-socket JackTrip password/);
  assert.match(readme, /password is never derived from the username/i);
  assert.match(readme, /does not verify the server certificate/i);
  assert.match(readme, /one shared low-latency mix/);
});

test('Guitar Jam UI visibly handles unconfigured DizyJam and long copyable commands', () => {
  assert.match(chat, /Server setup required/);
  assert.match(chat, /jam-provider-card\$\{available \? "" : " is-unavailable"\}/);
  assert.match(chat, /jam-session-command/);
  assert.match(css, /\.jam-provider-card\.is-unavailable/);
  assert.match(css, /\.jam-session-command code/);
});
