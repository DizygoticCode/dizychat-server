'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
const start = source.indexOf("socket.on('chat message'");
const end = source.indexOf("socket.on('message read'", start + 1);
assert.ok(start >= 0 && end > start, 'chat message handler must exist');
const chat = source.slice(start, end);

test('push dispatch occurs exactly once after message persistence and normal publication path', () => {
  const save = chat.indexOf('await newMsg.save()');
  const publish = chat.indexOf("emit('chat message', newMsg)");
  const status = chat.indexOf("emit('message status'");
  const dispatch = chat.indexOf('pushCoordinator.onMessageStored');
  assert.ok(save >= 0 && publish > save && status > publish && dispatch > status, 'push must be post-persist and post-publication');
  assert.equal((chat.match(/pushCoordinator\.onMessageStored/g) || []).length, 1, 'accepted message must dispatch push exactly once');
});

test('registered sender canonical identity is passed explicitly and never derived from display message user', () => {
  assert.match(chat, /senderCanonicalUsername\s*=\s*socket\.principal\?\.kind\s*===\s*['"]account['"][\s\S]*socket\.principal\.canonicalUsername/, 'registered sender must use authenticated canonical identity');
  assert.match(chat, /onMessageStored\([\s\S]*\{\s*senderCanonicalUsername\s*\}/, 'canonical identity must be explicit coordinator metadata');
  assert.doesNotMatch(chat, /senderCanonicalUsername\s*=\s*.*newMsg\.user/, 'display name must never become account identity');
});

test('guest sender resolves to empty canonical identity', () => {
  assert.match(chat, /socket\.principal\?\.kind\s*===\s*['"]account['"][\s\S]*:\s*['"]['"]\s*;/, 'guest must have empty canonical sender identity');
});

test('coordinator failure is fire-and-forget and cannot undo accepted message', () => {
  assert.match(chat, /void\s+pushCoordinator\.onMessageStored\([\s\S]*\.catch\(/, 'push dispatch must be fire-and-forget');
  assert.match(chat, /post-message dispatch failed/, 'push failure must be contained and logged safely');
});
