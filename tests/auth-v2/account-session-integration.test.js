'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');
const coreSource = fs.readFileSync(path.resolve(__dirname, '../../server-core.js'), 'utf8');
const indexSource = `${bootstrapSource}\n${coreSource}`;

test('Socket.IO handshake resolves an optional browser or durable mobile Auth v2 session without rejecting guests', () => {
  assert.match(indexSource, /createSessionStore.*src\/auth\/session-store/);
  assert.match(indexSource, /createMobileSessionService.*src\/auth\/mobile-session-service/);
  assert.match(indexSource, /const accountSessions = createSessionStore\(\{\s*ttlMs:\s*ADMIN_SESSION_TTL_MS\s*\}\);/s);
  assert.match(indexSource, /const resolveAccountSessionToken\s*=\s*async/);
  assert.match(indexSource, /accountSessions\.resolve\(token\)/);
  assert.match(indexSource, /mobileAccountSessions\.resolve\(token\)/);
  assert.match(indexSource, /io\.use\(async \(socket, next\) => \{[\s\S]*socket\.handshake\.auth\?\.sessionToken[\s\S]*await resolveAccountSessionToken\(sessionToken\)[\s\S]*socket\.principal = session\.principal[\s\S]*next\(\);[\s\S]*\}\);/);
});

test('account login authenticates server-side, preserves browser sessions, and gates durable mobile sessions to trusted native clients', () => {
  assert.match(indexSource, /socket\.on\('account login', async \(payload = \{\}, ack\) => \{/);
  assert.match(indexSource, /getAdminAuthAttemptKey\(socket, username\)/);
  assert.match(indexSource, /getAdminAuthState\(attemptKey\)/);
  assert.match(indexSource, /accountService\.authenticate\(username, password\)/);
  assert.match(indexSource, /const wantsMobileSession = payload\.sessionKind === 'mobile';/);
  assert.match(indexSource, /wantsMobileSession && !isTrustedNativeOrigin\(socket\)/);
  assert.match(indexSource, /const principal = \{\s*kind: 'account',[\s\S]*username: account\.username,[\s\S]*canonicalUsername: account\.canonicalUsername,[\s\S]*role: account\.role,[\s\S]*userId: account\.userId,[\s\S]*\};/);
  assert.match(indexSource, /const session = wantsMobileSession[\s\S]*mobileAccountSessions\.issue\(principal,[\s\S]*accountSessions\.issue\(principal\)/);
  assert.match(indexSource, /socket\.principal = session\.principal;/);
  assert.doesNotMatch(indexSource, /socket\.principal\s*=\s*\{[^}]*role:\s*payload\.role/s);
});

test('account session validation and logout resolve and revoke whichever session authority owns the token', () => {
  assert.match(indexSource, /socket\.on\('account session', async \(payload = \{\}, ack\) => \{/);
  assert.match(indexSource, /await resolveAccountSessionToken\(socket\.accountSessionToken\)/);
  assert.match(indexSource, /socket\.on\('account logout', async \(payload = \{\}, ack\) => \{/);
  assert.match(indexSource, /await revokeAccountSessionToken\(socket\.accountSessionToken\)/);
  assert.match(indexSource, /socket\.principal = null;/);
  assert.doesNotMatch(indexSource, /passwordHash\s*:/);
});