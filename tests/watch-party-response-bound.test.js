'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Watch2Gether room creation keeps timeout protection and bounds the upstream response body', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(
    server,
    /W2G_REQUEST_TIMEOUT_MS = parsePositiveIntegerEnv\('W2G_REQUEST_TIMEOUT_MS', 10000, \{ min: 1000, max: 30000 \}\)/,
  );
  assert.match(
    server,
    /W2G_MAX_RESPONSE_BYTES = parsePositiveIntegerEnv\('W2G_MAX_RESPONSE_BYTES', 256 \* 1024, \{ min: 1024, max: 4 \* 1024 \* 1024 \}\)/,
  );

  const start = server.indexOf('const createWatch2GetherRoom = async');
  const end = server.indexOf('const isCallVideoBlocked', start);
  assert.ok(start >= 0 && end > start);
  const helper = server.slice(start, end);

  assert.match(helper, /const controller = new AbortController\(\)/);
  assert.match(helper, /setTimeout\(\(\) => controller\.abort\(\), W2G_REQUEST_TIMEOUT_MS\)/);
  assert.match(helper, /signal: controller\.signal/);
  assert.match(helper, /readBoundedBody\(response, W2G_MAX_RESPONSE_BYTES\)/);
  assert.doesNotMatch(helper, /await response\.text\(\)/);
  assert.match(helper, /clearTimeout\(timeout\)/);
});

test('Watch2Gether creation remains room-scoped and socket-rate-limited', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  const start = server.indexOf("socket.on('watch-party:w2g-create'");
  const end = server.indexOf("socket.on('watch-party:external-clear'", start);
  assert.ok(start >= 0 && end > start);
  const handler = server.slice(start, end);

  assert.match(handler, /roomName !== socket\.currentRoom/);
  assert.match(handler, /canCreateWatchParty\(socket\.id\)/);
  assert.match(handler, /createWatch2GetherRoom\(\{ sourceUrl \}\)/);
});
