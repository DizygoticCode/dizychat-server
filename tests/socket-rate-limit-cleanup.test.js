'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('disconnect clears all per-socket rate-limit state', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(server, /const clearSocketRateLimitState = \(socketId\) => \{/);
  assert.match(server, /messageTimestamps\.delete\(socketId\)/);
  assert.match(server, /typingTimestamps\.delete\(socketId\)/);
  assert.match(server, /callEventTimestamps\.delete\(socketId\)/);
  assert.match(server, /watchPartyCreateTimestamps\.delete\(socketId\)/);

  assert.match(
    server,
    /socket\.on\('disconnect',[\s\S]{0,900}clearTypingUser\(socket, lastRoom\);[\s\S]{0,200}clearSocketRateLimitState\(socket\.id\);/,
  );
});
