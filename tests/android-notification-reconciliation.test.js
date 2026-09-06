'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('native notification store persists bounded non-secret per-room reconciliation state', () => {
  const store = read('android/app/src/main/java/com/chat/dizychat/DizyNotificationStateStore.java');
  assert.match(store, /MAX_RECENT_MESSAGES\s*=\s*8/);
  assert.match(store, /notificationKey/);
  assert.match(store, /latestMessageId/);
  assert.match(store, /latestTimestamp/);
  assert.match(store, /readMessageId/);
  assert.match(store, /readTimestamp/);
  assert.match(store, /DizyNotificationIdentity\.resolve/);
  assert.match(store, /DizyNotificationCursor\.compare/);
  assert.match(store, /MODE_PRIVATE/);
  assert.doesNotMatch(store, /Bearer|sessionToken|password|firebase-adminsdk|MONGO_URI/i);
});

test('room notifications use MessagingStyle and one durable logical identity', () => {
  const manager = read('android/app/src/main/java/com/chat/dizychat/DizyNotificationManager.java');
  assert.match(manager, /NotificationCompat\.MessagingStyle/);
  assert.match(manager, /DizyNotificationStateStore\.recordMessage/);
  assert.match(manager, /applyReadControl/);
  assert.match(manager, /latestMessageId/);
  assert.doesNotMatch(manager, /notificationKey\.hashCode\(\)/);
  assert.doesNotMatch(manager, /identity\.hashCode\(\)/);
});

test('Firebase service distinguishes message and idempotent read-control intents', () => {
  const service = read('android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java');
  assert.match(service, /read-control/);
  assert.match(service, /applyReadControl/);
  assert.match(service, /messageId/);
  assert.match(service, /timestamp/);
});

test('notification Mark as read clears through the shared durable state boundary only after success', () => {
  const receiver = read('android/app/src/main/java/com/chat/dizychat/DizyNotificationActionReceiver.java');
  assert.match(receiver, /DizyNotificationStateStore/);
  assert.match(receiver, /\/api\/read-state\/mark/);
  assert.match(receiver, /responseCode/);
});
