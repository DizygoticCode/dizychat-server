'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const indexSource = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');
const joinStart = indexSource.indexOf("socket.on('join room'");
const joinEnd = indexSource.indexOf("socket.on('leave room'", joinStart);
const joinSource = indexSource.slice(joinStart, joinEnd > joinStart ? joinEnd : undefined);

test('join room no longer accepts or references legacy admin sessions', () => {
  assert.match(joinSource, /socket\.on\('join room', async \(\{ room, username, password \}\) => \{/);
  assert.doesNotMatch(joinSource, /resolveAdminSession\(adminToken\)/);
  assert.doesNotMatch(joinSource, /adminSession/);
});

test('authenticated room identity comes only from the server-side account principal', () => {
  assert.match(joinSource, /if \(socket\.principal\?\.kind === 'account'\) \{/);
  assert.match(joinSource, /effectivePrincipal = socket\.principal;/);
  assert.match(joinSource, /socket\.username = effectivePrincipal\.username;/);
  assert.match(joinSource, /socket\.canonicalUsername = effectivePrincipal\.canonicalUsername;/);
  assert.match(joinSource, /socket\.identityKind = effectivePrincipal\.kind;/);
  assert.match(joinSource, /socket\.role = effectivePrincipal\.role;/);
  assert.doesNotMatch(joinSource, /const requestedUsername = .*username/);
});

test('guest room identity is allowed only when the canonical name is not a registered account', () => {
  assert.match(joinSource, /const guestUsername = normaliseUsername\(username, fallbackUser\);/);
  assert.match(joinSource, /await accountService\.isRegisteredUsername\(guestUsername\)/);
  assert.match(joinSource, /sendJoinError\(socket, 'That username is reserved\. Sign in to use it\.'\);/);
  assert.match(joinSource, /kind: 'guest',[\s\S]*username: guestUsername,[\s\S]*canonicalUsername: canonicalUsername\(guestUsername\),[\s\S]*role: 'guest'/);
});

test('room password validation remains independent from account role and happens before identity mutation', () => {
  const passwordCheck = joinSource.indexOf('roomPasswordService.claimOrVerify(roomName, providedPassword)');
  const passwordDecision = joinSource.indexOf('if (!roomPasswordResult.ok)');
  const principalCheck = joinSource.indexOf("socket.principal?.kind === 'account'");
  const usernameMutation = joinSource.indexOf('socket.username = effectivePrincipal.username');

  assert.notEqual(passwordCheck, -1);
  assert.notEqual(passwordDecision, -1);
  assert.notEqual(principalCheck, -1);
  assert.notEqual(usernameMutation, -1);
  assert.ok(passwordCheck < passwordDecision);
  assert.ok(passwordDecision < principalCheck);
  assert.ok(principalCheck < usernameMutation);
});
