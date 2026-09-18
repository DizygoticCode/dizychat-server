'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DizyJamCredentialStore,
  safeAuthUsername,
} = require('../src/jam/dizyjam-credentials');

const fakeSpawn = (_command, args) => {
  const saltIndex = args.indexOf('-salt');
  const salt = saltIndex >= 0 ? args[saltIndex + 1] : 'testsalt';
  return {
    status: 0,
    stdout: `$6$${salt}$deterministic-test-hash\n`,
    stderr: '',
  };
};

test('safe DizyJam usernames keep visible identity without trusting raw guest input', () => {
  const username = safeAuthUsername('  Guest: Rob / Guitar!!  ', 'socket-123');
  assert.match(username, /^Guest_Rob_Guitar-[a-f0-9]{12}$/);
  assert.ok(username.length <= 63);
});

test('credential store writes only salted hashes and never plaintext passwords', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dizyjam-auth-'));
  const file = path.join(dir, 'auth');
  let now = 1_000_000;
  const store = new DizyJamCredentialStore({
    credentialsFile: file,
    ttlSeconds: 300,
    now: () => now,
    spawnSyncImpl: fakeSpawn,
  });

  store.initialiseEmpty();
  const credential = store.issue({
    socketId: 'socket-A',
    displayName: 'Dizygotic',
    room: 'General',
    identityKind: 'account',
  });

  const onDisk = fs.readFileSync(file, 'utf8');
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  assert.ok(onDisk.startsWith(`${credential.username}:$6'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DizyJamCredentialStore,
  safeAuthUsername,
} = require('../src/jam/dizyjam-credentials');

const fakeSpawn = (_command, args) => {
  const saltIndex = args.indexOf('-salt');
  const salt = saltIndex >= 0 ? args[saltIndex + 1] : 'testsalt';
  return {
    status: 0,
    stdout: `$6$${salt}$deterministic-test-hash\n`,
    stderr: '',
  };
};

test('safe DizyJam usernames keep visible identity without trusting raw guest input', () => {
  const username = safeAuthUsername('  Guest: Rob / Guitar!!  ', 'socket-123');
  assert.match(username, /^Guest_Rob_Guitar-[a-f0-9]{12}$/);
  assert.ok(username.length <= 63);
});

test('credential store writes only salted hashes and never plaintext passwords', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dizyjam-auth-'));
  const file = path.join(dir, 'auth');
  let now = 1_000_000;
  const store = new DizyJamCredentialStore({
    credentialsFile: file,
    ttlSeconds: 300,
    now: () => now,
    spawnSyncImpl: fakeSpawn,
  });

  store.initialiseEmpty();
  const credential = store.issue({
    socketId: 'socket-A',
    displayName: 'Dizygotic',
    room: 'General',
    identityKind: 'account',
  });

));
  assert.equal(onDisk.includes(credential.password), false);
  assert.equal(credential.room, 'General');
  assert.equal(credential.identityKind, 'account');
  assert.ok(credential.password.startsWith('djt_'));
  assert.ok(credential.password.length >= 32);
  assert.deepEqual(store.getActiveRooms(), ['General']);
  assert.equal(store.getActiveLeaseCount(), 1);

  now += 301_000;
  store.pruneExpired();
  assert.equal(store.getActiveLeaseCount(), 0);
  assert.equal(fs.readFileSync(file, 'utf8'), '');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('credential revocation removes a socket immediately from the JackTrip auth file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dizyjam-revoke-'));
  const file = path.join(dir, 'auth');
  const store = new DizyJamCredentialStore({
    credentialsFile: file,
    ttlSeconds: 600,
    spawnSyncImpl: fakeSpawn,
  });

  store.initialiseEmpty();
  const first = store.issue({
    socketId: 'socket-A',
    displayName: 'Rob',
    room: 'Jam Room',
    identityKind: 'account',
  });
  const second = store.issue({
    socketId: 'socket-B',
    displayName: 'Guest Player',
    room: 'Jam Room',
    identityKind: 'guest',
  });

  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(first.username));
  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(second.username));
  assert.equal(store.revokeSocket('socket-A'), true);

  const after = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(after, new RegExp(first.username));
  assert.match(after, new RegExp(second.username));
  assert.equal(store.getActiveLeaseCount(), 1);

  fs.rmSync(dir, { recursive: true, force: true });
});
