'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createJamSessionRateLimiter } = require('../src/jam/jam-session-rate-limit');

test('DizyJam session limiter rate limits one key without affecting another', () => {
  let now = 1_000_000;
  const limiter = createJamSessionRateLimiter({
    windowMs: 60_000,
    maxStarts: 2,
    now: () => now,
  });

  assert.equal(limiter.check('203.0.113.10'), true);
  now += 1000;
  assert.equal(limiter.check('203.0.113.10'), true);
  assert.equal(limiter.check('203.0.113.10'), false);
  assert.equal(limiter.check('203.0.113.11'), true);

  now += 60_000;
  assert.equal(limiter.check('203.0.113.10'), true);
});

test('DizyJam session limiter evicts expired idle keys when other clients arrive', () => {
  let now = 2_000_000;
  const limiter = createJamSessionRateLimiter({
    windowMs: 60_000,
    maxStarts: 12,
    now: () => now,
  });

  assert.equal(limiter.check('203.0.113.10'), true);
  assert.equal(limiter.getTrackedKeyCount(), 1);

  now += 61_000;
  assert.equal(limiter.check('203.0.113.11'), true);
  assert.equal(limiter.getTrackedKeyCount(), 1);
});

test('DizyJam session limiter can explicitly clear disconnected socket keys', () => {
  const limiter = createJamSessionRateLimiter();
  assert.equal(limiter.check('socket-123'), true);
  assert.equal(limiter.getTrackedKeyCount(), 1);
  limiter.clear('socket-123');
  assert.equal(limiter.getTrackedKeyCount(), 0);
});

test('production DizyJam session boundaries use bounded state and a small JSON body', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(server, /createJamSessionRateLimiter/);
  assert.match(
    server,
    /const jamSessionRateLimiter = createJamSessionRateLimiter\(\{[\s\S]{0,180}windowMs: JAM_SESSION_EVENT_WINDOW_MS,[\s\S]{0,180}maxStarts: JAM_SESSION_MAX_CREATES_PER_WINDOW/,
  );
  assert.match(server, /const canCreateJamSession = \(socketKey\) => jamSessionRateLimiter\.check\(socketKey\)/);
  assert.match(server, /app\.post\('\/api\/jam\/session', express\.json\(\{ limit: '4kb' \}\),/);
  assert.match(
    server,
    /socket\.on\('disconnect',[\s\S]{0,1100}jamSessionRateLimiter\.clear\(socket\.id\);/,
  );
});
