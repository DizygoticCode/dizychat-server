'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_LOCK_MS,
  DEFAULT_MAX_FAILURES,
  DEFAULT_MAX_TRACKED_KEYS,
  DEFAULT_WINDOW_MS,
  createRoomAuthThrottle,
} = require('../src/rooms/room-auth-throttle');

const repoRoot = path.resolve(__dirname, '..');

test('room password throttle adds a short backoff after a failed attempt', () => {
  let now = 1_000_000;
  const throttle = createRoomAuthThrottle({ now: () => now });
  const key = '203.0.113.10::private room';

  assert.deepEqual(throttle.check(key), { blocked: false, retryAfterMs: 0 });

  const failure = throttle.registerFailure(key);
  assert.equal(failure.count, 1);
  assert.equal(failure.retryAfterMs, 500);

  const blocked = throttle.check(key);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.retryAfterMs, 500);

  now += 500;
  assert.deepEqual(throttle.check(key), { blocked: false, retryAfterMs: 0 });
});

test('room password throttle locks only after eight failures and clears on success', () => {
  let now = 2_000_000;
  const throttle = createRoomAuthThrottle({ now: () => now });
  const key = '203.0.113.10::private room';

  let last;
  for (let i = 0; i < DEFAULT_MAX_FAILURES; i += 1) {
    last = throttle.registerFailure(key);
    if (i < DEFAULT_MAX_FAILURES - 1) {
      now += last.retryAfterMs;
    }
  }

  assert.equal(last.count, DEFAULT_MAX_FAILURES);
  assert.equal(last.lockUntil, now + DEFAULT_LOCK_MS);
  assert.equal(throttle.check(key).blocked, true);

  throttle.clear(key);
  assert.deepEqual(throttle.check(key), { blocked: false, retryAfterMs: 0 });
});

test('room password throttle forgets old failures after the window', () => {
  let now = 3_000_000;
  const throttle = createRoomAuthThrottle({ now: () => now });
  const key = '203.0.113.10::private room';

  throttle.registerFailure(key);
  now += DEFAULT_WINDOW_MS;
  assert.deepEqual(throttle.check(key), { blocked: false, retryAfterMs: 0 });
});

test('production room join path checks, records, and clears the throttle', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const start = server.indexOf("socket.on('join room'");
  const end = server.indexOf("socket.on('request older messages'", start);
  assert.ok(start >= 0 && end > start);

  const joinHandler = server.slice(start, end);
  assert.match(joinHandler, /roomAuthThrottle\.check\(roomAuthKey\)/);
  assert.match(joinHandler, /roomAuthThrottle\.registerFailure\(roomAuthKey\)/);
  assert.match(joinHandler, /roomAuthThrottle\.clear\(roomAuthKey\)/);
  assert.match(joinHandler, /Too many incorrect room password attempts/);
});


test('room password throttle evicts expired idle keys when another key arrives', () => {
  let now = 4_000_000;
  const throttle = createRoomAuthThrottle({
    windowMs: 1000,
    lockMs: 500,
    now: () => now,
  });

  throttle.registerFailure('203.0.113.10::private room');
  assert.equal(throttle.getTrackedKeyCount(), 1);

  now += 1100;
  throttle.registerFailure('203.0.113.11::private room');
  assert.equal(throttle.getTrackedKeyCount(), 1);
});

test('room password throttle fails closed at the tracked-key ceiling and recovers after expiry', () => {
  let now = 5_000_000;
  const throttle = createRoomAuthThrottle({
    windowMs: 1000,
    lockMs: 500,
    maxTrackedKeys: 2,
    now: () => now,
  });

  throttle.registerFailure('client-a');
  throttle.registerFailure('client-b');
  assert.equal(throttle.getTrackedKeyCount(), 2);

  const saturated = throttle.check('client-c');
  assert.equal(saturated.blocked, true);
  assert.equal(saturated.reason, 'capacity');
  assert.equal(throttle.getTrackedKeyCount(), 2);

  now += 1100;
  assert.deepEqual(throttle.check('client-c'), { blocked: false, retryAfterMs: 0 });
  assert.equal(throttle.getTrackedKeyCount(), 0);
});

test('production account and room auth throttles use bounded shared state', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(server, /ADMIN_AUTH_MAX_TRACKED_KEYS = parsePositiveIntegerEnv\('ADMIN_AUTH_MAX_TRACKED_KEYS', 5000/);
  assert.match(server, /ROOM_AUTH_MAX_TRACKED_KEYS = parsePositiveIntegerEnv\('ROOM_AUTH_MAX_TRACKED_KEYS', 5000/);
  assert.match(server, /const roomAuthThrottle = createRoomAuthThrottle\(\{[\s\S]{0,120}maxTrackedKeys: ROOM_AUTH_MAX_TRACKED_KEYS/);
  assert.match(server, /const accountAuthThrottle = createRoomAuthThrottle\(\{[\s\S]{0,400}maxTrackedKeys: ADMIN_AUTH_MAX_TRACKED_KEYS/);
  assert.match(server, /accountAuthThrottle\.check\(attemptKey\)/);
  assert.match(server, /accountAuthThrottle\.registerFailure\(attemptKey\)/);
  assert.match(server, /accountAuthThrottle\.clear\(attemptKey\)/);
  assert.doesNotMatch(server, /const adminAuthFailures = new Map\(\)/);
  assert.equal(DEFAULT_MAX_TRACKED_KEYS, 5000);
});
