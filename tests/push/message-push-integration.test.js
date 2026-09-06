'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bootstrapSource = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '..', '..', 'server-core.js'), 'utf8');
const source = `${bootstrapSource}\n${coreSource}`;
const service = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'messages', 'chat-message-service.js'), 'utf8');
const start = source.indexOf("socket.on('chat message'");
const end = source.indexOf("socket.on('message read'", start + 1);
assert.ok(start >= 0 && end > start, 'chat message handler must exist');
const chat = source.slice(start, end);

test('push dispatch occurs exactly once after message persistence and normal publication path', () => {
  const save = service.indexOf('await newMsg.save()');
  const publish = service.indexOf("emit('chat message', newMsg)");
  const status = service.indexOf("emit('message status'");
  const dispatch = service.indexOf('pushCoordinator.onMessageStored');
  assert.ok(save >= 0 && publish > save && status > publish && dispatch > status, 'push must be post-persist and post-publication');
  assert.equal((service.match(/pushCoordinator\.onMessageStored/g) || []).length, 1, 'accepted message must dispatch push exactly once');
  assert.match(chat, /chatMessageService\.persistChatMessage\(/, 'socket acceptance must delegate to the canonical persistence path');
});

test('registered sender canonical identity is passed explicitly and never derived from display message user', () => {
  assert.match(chat, /senderCanonicalUsername\s*=\s*socket\.principal\?\.kind\s*===\s*['"]account['"][\s\S]*socket\.principal\.canonicalUsername/, 'registered sender must use authenticated canonical identity');
  assert.match(chat, /persistChatMessage\([\s\S]*senderCanonicalUsername[\s\S]*message:\s*msgDataRaw/, 'canonical identity must be explicit service metadata');
  assert.match(service, /onMessageStored\([\s\S]*senderCanonicalUsername:\s*String\(senderCanonicalUsername\s*\|\|\s*['"]['"]\)/, 'canonical identity must remain explicit coordinator metadata');
  assert.doesNotMatch(service, /senderCanonicalUsername\s*=\s*.*newMsg\.user/, 'display name must never become account identity');
});

test('guest sender resolves to empty canonical identity', () => {
  assert.match(chat, /socket\.principal\?\.kind\s*===\s*['"]account['"][\s\S]*:\s*['"]['"]\s*;/, 'guest must have empty canonical sender identity');
});

test('coordinator failure is fire-and-forget and cannot undo accepted message', () => {
  assert.match(service, /void\s+pushCoordinator\.onMessageStored\([\s\S]*\.catch\(/, 'push dispatch must be fire-and-forget');
  assert.match(service, /post-message dispatch failed/, 'push failure must be contained and logged safely');
});
