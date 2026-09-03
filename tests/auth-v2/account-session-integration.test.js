'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const indexSource = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');

test('Socket.IO handshake resolves an optional Auth v2 session without rejecting guests', () => {
  assert.match(indexSource, /createSessionStore.*src\/auth\/session-store/);
  assert.match(indexSource, /const accountSessions = createSessionStore\(\{\s*ttlMs:\s*ADMIN_SESSION_TTL_MS\s*\}\);/s);
  assert.match(indexSource, /io\.use\(\(socket, next\) => \{[\s\S]*socket\.handshake\.auth\?\.sessionToken[\s\S]*accountSessions\.resolve\(sessionToken\)[\s\S]*socket\.principal = session\.principal[\s\S]*next\(\);[\s\S]*\}\);/);
});

test('account login authenticates server-side, applies the existing failure window, and issues sanitized session metadata', () => {
  assert.match(indexSource, /socket\.on\('account login', async \(payload = \{\}, ack\) => \{/);
  assert.match(indexSource, /getAdminAuthAttemptKey\(socket, username\)/);
  assert.match(indexSource, /getAdminAuthState\(attemptKey\)/);
  assert.match(indexSource, /accountService\.authenticate\(username, password\)/);
  assert.match(indexSource, /const principal = \{\s*kind: 'account',[\s\S]*username: account\.username,[\s\S]*canonicalUsername: account\.canonicalUsername,[\s\S]*role: account\.role,[\s\S]*userId: account\.userId,[\s\S]*\};/);
  assert.match(indexSource, /const session = accountSessions\.issue\(principal\);/);
  assert.match(indexSource, /socket\.principal = session\.principal;/);
  assert.doesNotMatch(indexSource, /socket\.principal\s*=\s*\{[^}]*role:\s*payload\.role/s);
});

test('account session reports only the current resolved session and logout revokes that socket session', () => {
  assert.match(indexSource, /socket\.on\('account session', \(payload = \{\}, ack\) => \{/);
  assert.match(indexSource, /accountSessions\.resolve\(socket\.accountSessionToken\)/);
  assert.match(indexSource, /socket\.on\('account logout', \(payload = \{\}, ack\) => \{/);
  assert.match(indexSource, /accountSessions\.revoke\(socket\.accountSessionToken\)/);
  assert.match(indexSource, /socket\.principal = null;/);
  assert.doesNotMatch(indexSource, /passwordHash\s*:/);
});
