'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('server admits and checks room access before recording private history', () => {
  const server = read('server-core.js');
  const join = server.slice(server.indexOf("socket.on('join room',"), server.indexOf("socket.on('leave room',"));
  const password = join.indexOf('if (!roomPasswordResult.ok)');
  const banned = join.indexOf('if (bannedSet && bannedSet.has(canonicalUser))');
  const record = join.indexOf('await recentRoomService.record(userId, roomName)');
  const success = join.indexOf("socket.emit('join room success')");
  assert.ok(password >= 0 && banned > password && record > banned && success > record);
  assert.match(join, /if \(effectivePrincipal\.kind === 'account'\)/);
  assert.match(join, /const userId = await authenticatedRecentRoomUser\(\)/);
});

test('private history requests derive user identity from session authority only', () => {
  const server = read('server-core.js');
  const start = server.indexOf('const authenticatedRecentRoomUser = async () => {');
  const end = server.indexOf("socket.on('join room',", start);
  const recent = server.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(recent, /resolveAccountSessionToken\(socket\.accountSessionToken\)/);
  assert.match(recent, /session\.principal\?\.kind !== 'account'/);
  assert.match(recent, /socket\.principal\?\.userId !== session\.principal\.userId/);
  assert.match(recent, /recentRoomService\.list\(userId\)/);
  assert.match(recent, /recentRoomService\.clear\(userId\)/);
  assert.doesNotMatch(recent, /payload\.(?:userId|username|role)/);
});

test('recent room controls appear only in the registered room-selection flow', () => {
  const html = read('public/login.html');
  const client = read('public/chat.js');
  const css = read('public/chat.css');
  assert.match(html, /id="recent-rooms-panel"[^>]*hidden/);
  assert.match(html, /id="recent-rooms-list"/);
  assert.match(html, /id="clear-recent-rooms-btn"/);
  assert.match(client, /recentRoomsPanel\.hidden = rooms\.length === 0/);
  assert.match(client, /accountState\.identity\?\.userId/);
  assert.match(client, /detail\.textContent = entry\.requiresPassword \? "Password required" : "Public room"/);
  assert.match(client, /if \(entry\.requiresPassword\) \{[\s\S]*?passwordInput\?\.focus\(\)/);
  assert.match(client, /socket\.emit\("account recent rooms", \{\}, \(ack = \{\}\) =>/);
  assert.match(css, /\.recent-rooms-panel\[hidden\] \{ display: none !important; \}/);
});
