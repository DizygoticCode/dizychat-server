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

test('Guitar Jam exposes Music Call, self-hosted DizyJam, and SonoBus fallback only', () => {
  assert.match(server, /id:\s*['"]music-call['"]/);
  assert.match(server, /id:\s*['"]dizyjam['"]/);
  assert.match(server, /id:\s*['"]sonobus['"]/);
  assert.doesNotMatch(server, /app\.jacktrip\.org\/studios\/create/);
  assert.doesNotMatch(chat, /Try JackTrip free/);
  assert.match(chat, /Start Music Call/);
  assert.match(chat, /Start DizyJam/);
  assert.match(chat, /Use SonoBus fallback/);
});

test('Music Call launches the existing LiveKit call with Music mode selected', () => {
  assert.match(chat, /dizychat:start-music-call/);
  assert.match(chat, /chooseMusicMode\(true\)/);
  assert.match(chat, /await joinCall\(\)/);
  assert.match(chat, /window\.dispatchEvent\(new CustomEvent\(["']dizychat:start-music-call["']\)\)/);
});

test('DizyJam server configuration is explicit and disabled until a public host is configured', () => {
  assert.match(server, /DIZYJAM_HOST/);
  assert.match(server, /ENABLE_DIZYJAM/);
  assert.match(server, /DIZYJAM_TCP_PORT/);
  assert.match(server, /DIZYJAM_UDP_BASE_PORT/);
  assert.match(server, /DIZYJAM_UDP_END_PORT/);
  assert.match(server, /DIZYJAM_SAMPLE_RATE/);
  assert.match(server, /DIZYJAM_BUFFER_SIZE/);
  assert.match(server, /const DIZYJAM_ENABLED = !DIZYJAM_DISABLED && Boolean\(DIZYJAM_HOST\)/);
  assert.match(server, /missingRequiredEnv:\s*DIZYJAM_HOST \? \[\] : \[['"]DIZYJAM_HOST['"]\]/);
});

test('DizyJam session returns self-hosted hub details and keeps one shared mix explicit', () => {
  assert.match(server, /session\.host = DIZYJAM_HOST/);
  assert.match(server, /session\.tcpPort = DIZYJAM_TCP_PORT/);
  assert.match(server, /session\.udpBasePort = DIZYJAM_UDP_BASE_PORT/);
  assert.match(server, /session\.udpEndPort = DIZYJAM_UDP_END_PORT/);
  assert.match(server, /session\.sampleRate = DIZYJAM_SAMPLE_RATE/);
  assert.match(server, /session\.bufferSize = DIZYJAM_BUFFER_SIZE/);
  assert.match(server, /session\.oneSharedMix = true/);
  assert.match(server, /jacktrip -C \$\{DIZYJAM_HOST\} -q auto --bufstrategy 4/);
  assert.match(chat, /Keep DizyChat open for camera\/chat/);
});

test('self-hosted hub uses the official JackTrip container without delayed self-loop', () => {
  assert.match(compose, /jacktrip\/jacktrip:latest/);
  assert.match(compose, /network_mode:\s*host/);
  assert.match(compose, /privileged:\s*true/);
  assert.match(compose, /--hubpatch 2/);
  assert.match(compose, /--bufstrategy 4/);
  assert.match(compose, /-q auto/);
  assert.match(compose, /-U \$\{DIZYJAM_UDP_BASE_PORT:-61002\}/);
  assert.doesNotMatch(compose, /^\s*-\s+-t\s*$/m);
});

test('deployment guide documents network ports and the unauthenticated first-slice boundary', () => {
  assert.match(readme, /TCP 4464/);
  assert.match(readme, /UDP 61002-61100/);
  assert.match(readme, /not yet authenticated against DizyChat accounts/);
  assert.match(readme, /JackTrip supports hub authentication/);
  assert.match(readme, /one shared low-latency mix/);
});

test('Guitar Jam UI visibly handles unconfigured DizyJam and long copyable commands', () => {
  assert.match(chat, /Server setup required/);
  assert.match(chat, /jam-provider-card\$\{available \? "" : " is-unavailable"\}/);
  assert.match(chat, /jam-session-command/);
  assert.match(css, /\.jam-provider-card\.is-unavailable/);
  assert.match(css, /\.jam-session-command code/);
});
