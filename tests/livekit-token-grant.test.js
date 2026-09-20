'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  resolveCallTokenGrant,
  safeSecretEqual,
} = require('../src/calls/call-token-grant');

const repoRoot = path.resolve(__dirname, '..');

const makeIo = (socket) => ({
  of(name) {
    assert.equal(name, '/');
    return {
      sockets: new Map(socket ? [[socket.id, socket]] : []),
    };
  },
});

test('call token grant requires the exact admitted socket, room and nonce', () => {
  const socket = {
    id: 'socket-1',
    currentRoom: 'Private Room',
    username: 'Alice',
    callTokenNonce: 'nonce-1234567890',
  };
  const io = makeIo(socket);

  const ok = resolveCallTokenGrant({
    io,
    room: 'Private Room',
    socketId: 'socket-1',
    nonce: 'nonce-1234567890',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.username, 'Alice');

  assert.equal(resolveCallTokenGrant({
    io,
    room: 'Other Room',
    socketId: 'socket-1',
    nonce: 'nonce-1234567890',
  }).code, 'CALL_GRANT_ROOM_MISMATCH');

  assert.equal(resolveCallTokenGrant({
    io,
    room: 'Private Room',
    socketId: 'socket-1',
    nonce: 'wrong-nonce',
  }).code, 'CALL_GRANT_NONCE_INVALID');

  assert.equal(resolveCallTokenGrant({
    io,
    room: 'Private Room',
    socketId: 'missing',
    nonce: 'nonce-1234567890',
  }).code, 'CALL_GRANT_SOCKET_MISSING');
});

test('call token grant rejects incomplete HTTP grant data before socket lookup', () => {
  const explodingIo = {
    of() {
      throw new Error('socket lookup should not run');
    },
  };

  assert.equal(resolveCallTokenGrant({
    io: explodingIo,
    room: 'Private Room',
    socketId: '',
    nonce: 'nonce-1234567890',
  }).code, 'CALL_GRANT_REQUIRED');

  assert.equal(resolveCallTokenGrant({
    io: explodingIo,
    room: 'Private Room',
    socketId: 'socket-1',
    nonce: '',
  }).code, 'CALL_GRANT_REQUIRED');
});

test('call token nonce comparison rejects empty or mismatched secrets', () => {
  assert.equal(safeSecretEqual('abc', 'abc'), true);
  assert.equal(safeSecretEqual('abc', 'abd'), false);
  assert.equal(safeSecretEqual('abc', 'abcd'), false);
  assert.equal(safeSecretEqual('', ''), false);
});

test('LiveKit token endpoint derives identity from the admitted socket grant', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const start = server.indexOf("app.post('/api/calls/token'");
  const end = server.indexOf('// ---------------- Socket.IO ----------------', start);
  assert.ok(start >= 0 && end > start);
  const route = server.slice(start, end);

  assert.match(route, /resolveCallTokenGrant\(\{/);
  assert.match(route, /socketId: req\.body\?\.socketId/);
  assert.match(route, /nonce: req\.body\?\.callTokenNonce/);
  assert.match(route, /const username = normaliseUsername\(grant\.username, ''\)/);
  assert.doesNotMatch(route, /normaliseUsername\(req\.body\?\.username/);
  assert.match(route, /CALL_ROOM_GRANT_REQUIRED/);
});

test('chat client stores the room grant and includes it in token requests', () => {
  const chat = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');

  assert.match(chat, /socket\.on\("call token nonce"/);
  assert.match(chat, /window\.dizyCallTokenGrant = \{ room, token, socketId \}/);
  assert.match(chat, /socketId: grant\.socketId/);
  assert.match(chat, /callTokenNonce: grant\.token/);
  assert.doesNotMatch(
    chat,
    /\/api\/calls\/token[\s\S]{0,500}username: window\.currentUser/,
  );
});
