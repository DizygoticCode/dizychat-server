'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const readServer = () => fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

test('typing identity is derived from the admitted socket instead of client payload', () => {
  const server = readServer();
  const start = server.indexOf("socket.on('typing'");
  const end = server.indexOf("socket.on('stop typing'", start);
  assert.ok(start >= 0 && end > start);
  const handler = server.slice(start, end);

  assert.match(handler, /socket\.on\('typing', \(\) =>/);
  assert.match(handler, /normaliseUsername\(socket\.username, ''\)/);
  assert.doesNotMatch(handler, /username\.trim/);
});

test('call mute and kick use the protected moderation target validator', () => {
  const server = readServer();

  for (const eventName of ['call:mute-user', 'call:kick-user']) {
    const start = server.indexOf(`socket.on('${eventName}'`);
    const end = server.indexOf('  });', start) + 5;
    assert.ok(start >= 0 && end > start, eventName);
    const handler = server.slice(start, end);

    assert.match(handler, /requireAdmin\(socket\)/, eventName);
    assert.match(handler, /validateCallModerationTarget\(socket, roomName, target\)/, eventName);
    assert.match(handler, /targetInfo\.cleanedTarget/, eventName);
  }
});

test('only the call starter or a moderator can end the room-wide call', () => {
  const server = readServer();
  const start = server.indexOf("socket.on('call:end'");
  const end = server.indexOf("// ----- Chat message -----", start);
  assert.ok(start >= 0 && end > start);
  const handler = server.slice(start, end);

  assert.match(handler, /const isCallStarter = Boolean/);
  assert.match(handler, /active\.startedBySocketId === socket\.id/);
  assert.match(handler, /!requireModerator\(socket\) && !isCallStarter/);
  assert.match(handler, /Only the call starter or an admin can end the room call/);
  assert.match(handler, /activeRoomCalls\.delete\(roomName\)/);

  assert.match(server, /startedBySocketId: socket\.id/);
});
