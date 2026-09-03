'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const indexSource = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');

test('server imports role authorization and removes legacy admin-session/password authority', () => {
  assert.match(indexSource, /const \{ requireModerator, requireOwner \} = require\('\.\/src\/auth\/authorization'\);/);
  assert.doesNotMatch(indexSource, /socket\.on\('admin auth'/);
  assert.doesNotMatch(indexSource, /\bissueAdminSession\b/);
  assert.doesNotMatch(indexSource, /\bresolveAdminSession\b/);
  assert.doesNotMatch(indexSource, /\brevokeAdminSessionForUser\b/);
  assert.doesNotMatch(indexSource, /\bresolveAdminCredential\b/);
  assert.doesNotMatch(indexSource, /\badminSessionsByToken\b/);
  assert.doesNotMatch(indexSource, /\badminSessionsByUser\b/);
  assert.doesNotMatch(indexSource, /\badminToken\b/);
});

test('room join persists the server-derived effective principal without legacy isAdmin state', () => {
  const joinStart = indexSource.indexOf("socket.on('join room'");
  const joinEnd = indexSource.indexOf("socket.on('leave room'", joinStart);
  const joinSource = indexSource.slice(joinStart, joinEnd > joinStart ? joinEnd : undefined);

  assert.match(joinSource, /socket\.principal = effectivePrincipal;/);
  assert.doesNotMatch(joinSource, /socket\.isAdmin/);
});

test('existing admin command guard delegates only to account-role authorization', () => {
  assert.match(indexSource, /function requireAdmin\(socket\)\{[\s\S]*const principal = requireModerator\(socket\);[\s\S]*if \(!principal\)/);
  assert.doesNotMatch(indexSource, /if \(!socket\.isAdmin\)/);
});

test('owner-only managed-user event creates through account service, revokes old sessions, and returns no password material', () => {
  const start = indexSource.indexOf("socket.on('account manage user'");
  const end = indexSource.indexOf("socket.on('join room'", start);
  const source = indexSource.slice(start, end > start ? end : undefined);

  assert.notEqual(start, -1);
  assert.match(source, /const actor = requireOwner\(socket\);/);
  assert.match(source, /if \(!actor\)/);
  assert.match(source, /accountService\.createManagedUser\(actor, \{ username, password, role \}\)/);
  assert.match(source, /accountSessions\.revokeUser\(account\.canonicalUsername\);/);
  assert.match(source, /ack\(\{ ok: true, account \}\)/);
  assert.doesNotMatch(source, /passwordHash\s*:/);
  assert.doesNotMatch(source, /password\s*:/);
});

test('server no longer uses mutable socket.isAdmin as authorization state', () => {
  assert.doesNotMatch(indexSource, /socket\.isAdmin/);
});
