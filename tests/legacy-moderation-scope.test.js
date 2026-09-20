'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

const readServer = () => fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

test('legacy announcements stay inside the admin socket current room', () => {
  const server = readServer();
  const start = server.indexOf("socket.on('announce'");
  const end = server.indexOf("socket.on('moderate'", start);
  assert.ok(start >= 0 && end > start);
  const handler = server.slice(start, end);

  assert.match(handler, /const targetRoom = normaliseRoomName\(room\) \|\| socket\.currentRoom/);
  assert.match(handler, /targetRoom !== socket\.currentRoom/);
  assert.match(handler, /requireAdmin\(socket\)/);
  assert.match(handler, /io\.to\(targetRoom\)\.emit\('announcement'/);
  assert.doesNotMatch(handler, /io\.to\(room\)\.emit\('announcement'/);
});

test('legacy moderation requires joined-room scope and protects admins and self', () => {
  const server = readServer();
  const start = server.indexOf("socket.on('moderate'");
  const end = server.indexOf("socket.on('moderate user'", start);
  assert.ok(start >= 0 && end > start);
  const handler = server.slice(start, end);

  assert.match(handler, /const targetRoom = normaliseRoomName\(room\) \|\| socket\.currentRoom/);
  assert.match(handler, /targetRoom !== socket\.currentRoom/);
  assert.match(handler, /requireAdmin\(socket\)/);
  assert.match(handler, /canonicalTarget === canonicalUsername\(socket\.username\)/);
  assert.match(handler, /targetInfo\.isAdmin/);
  assert.match(handler, /getSocketsForUser\(targetRoom, canonicalTarget\)/);
  assert.doesNotMatch(handler, /addUserBan\(room,/);
  assert.doesNotMatch(handler, /s\.currentRoom === room/);
});

test('legacy moderation emits normalized room and target values', () => {
  const server = readServer();
  const start = server.indexOf("socket.on('moderate'");
  const end = server.indexOf("socket.on('moderate user'", start);
  const handler = server.slice(start, end);

  assert.match(handler, /room: targetRoom/);
  assert.match(handler, /target: cleanedTarget/);
  assert.match(handler, /removeSocketFromRoom\(targetSocket, targetRoom\)/);
});
