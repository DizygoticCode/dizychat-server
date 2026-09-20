'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isMessageAuthor,
  resolveCurrentSocketRoom,
  resolveSocketUsername,
} = require('../src/messages/socket-message-authorization');

const repoRoot = path.resolve(__dirname, '..');

test('socket room authorization only resolves the room the socket actually joined', () => {
  const socket = { currentRoom: 'Private Room', username: 'Alice' };

  assert.equal(resolveCurrentSocketRoom(socket, 'Private Room'), 'Private Room');
  assert.equal(resolveCurrentSocketRoom(socket, ''), 'Private Room');
  assert.equal(resolveCurrentSocketRoom(socket, undefined), 'Private Room');
  assert.equal(resolveCurrentSocketRoom(socket, 'Other Room'), '');
  assert.equal(resolveCurrentSocketRoom({ currentRoom: '' }, 'Private Room'), '');
});

test('message actor identity comes from the socket and author checks are canonical', () => {
  assert.equal(resolveSocketUsername({ username: ' Alice ' }), 'Alice');
  assert.equal(resolveSocketUsername({ username: '' }), '');
  assert.equal(isMessageAuthor({ user: 'Alice' }, 'alice'), true);
  assert.equal(isMessageAuthor({ user: 'Alice' }, 'Bob'), false);
});

test('message handlers enforce current-room scope and ignore client-supplied actor names', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  const scopedRoomChecks = server.match(/resolveCurrentSocketRoom\(socket, room\)/g) || [];
  assert.ok(scopedRoomChecks.length >= 10, 'expected current-room checks across message actions');

  assert.match(
    server,
    /socket\.on\('message read'[\s\S]{0,220}resolveCurrentSocketRoom\(socket, room\)/,
  );
  assert.match(
    server,
    /socket\.on\('edit message'[\s\S]{0,900}!isMessageAuthor\(msg, username\)/,
  );
  assert.match(
    server,
    /socket\.on\('get pinned'[\s\S]{0,500}room:\s*targetRoom/,
  );
  assert.match(
    server,
    /socket\.on\('search messages'[\s\S]{0,500}resolveCurrentSocketRoom\(socket, room\)/,
  );

  assert.match(server, /socket\.on\('star message', async \(\{ room, id \}\) =>/);
  assert.match(server, /socket\.on\('unstar message', async \(\{ room, id \}\) =>/);
  assert.match(server, /socket\.on\('react message', async \(\{ room, id, reaction \}\) =>/);
  assert.doesNotMatch(server, /socket\.on\('star message', async \(\{ room, id, user \}\) =>/);
  assert.doesNotMatch(server, /socket\.on\('react message', async \(\{ room, id, reaction, username \}\) =>/);
});
