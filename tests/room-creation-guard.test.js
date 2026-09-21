'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('dynamic room creation is rate-limited and globally bounded before persistence', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(
    server,
    /ROOM_CREATE_WINDOW_MS = parsePositiveIntegerEnv\('ROOM_CREATE_WINDOW_MS', 60 \* 60 \* 1000/,
  );
  assert.match(
    server,
    /ROOM_CREATE_MAX_PER_WINDOW = parsePositiveIntegerEnv\('ROOM_CREATE_MAX_PER_WINDOW', 10/,
  );
  assert.match(
    server,
    /ROOM_CREATE_MAX_TRACKED_KEYS = parsePositiveIntegerEnv\('ROOM_CREATE_MAX_TRACKED_KEYS', 5000/,
  );
  assert.match(
    server,
    /ROOM_MAX_PERSISTED = parsePositiveIntegerEnv\('ROOM_MAX_PERSISTED', 5000/,
  );
  assert.match(
    server,
    /const roomCreationThrottle = createRoomAuthThrottle\(\{[\s\S]{0,420}maxFailures: ROOM_CREATE_MAX_PER_WINDOW[\s\S]{0,420}minRetryDelayMs: 0[\s\S]{0,420}maxTrackedKeys: ROOM_CREATE_MAX_TRACKED_KEYS/,
  );

  const joinStart = server.indexOf("socket.on('join room'");
  const joinEnd = server.indexOf("socket.on('request older messages'", joinStart);
  assert.ok(joinStart >= 0 && joinEnd > joinStart);
  const joinHandler = server.slice(joinStart, joinEnd);

  assert.match(joinHandler, /if \(!roomPasswords\.has\(roomName\)\) \{/);
  assert.match(joinHandler, /if \(roomPasswords\.size >= ROOM_MAX_PERSISTED\)/);
  assert.match(joinHandler, /roomCreationThrottle\.check\(remoteAddress\)/);
  assert.match(joinHandler, /roomCreationThrottle\.registerFailure\(remoteAddress\)/);
  assert.match(joinHandler, /room_creation_rate_limited/);
  assert.match(joinHandler, /room_creation_capacity_reached/);

  const guardIndex = joinHandler.indexOf('roomCreationThrottle.check(remoteAddress)');
  const persistIndex = joinHandler.indexOf('roomPasswordService.claimOrVerify(roomName, providedPassword)');
  assert.ok(guardIndex >= 0 && persistIndex > guardIndex, 'creation guard must run before password hashing/Mongo persistence');
});

test('existing persisted rooms bypass the new-room creation budget', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const start = server.indexOf("socket.on('join room'");
  const end = server.indexOf("socket.on('request older messages'", start);
  const joinHandler = server.slice(start, end);

  assert.match(
    joinHandler,
    /if \(!roomPasswords\.has\(roomName\)\) \{[\s\S]*roomCreationThrottle\.registerFailure\(remoteAddress\);[\s\S]*\}\s*const roomAuthKey/,
  );
});
