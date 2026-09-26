'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createFcmTransport } = require('../src/push/transports/fcm-transport');

const createHarness = () => {
  const sent = [];
  const transport = createFcmTransport({
    messagingFactory: async () => ({
      send: async (message) => {
        sent.push(message);
        return 'firebase-accepted';
      },
    }),
    logger: { info() {}, warn() {}, error() {}, log() {} },
  });
  return { sent, transport };
};

test('Android messages are data-only so native MessagingStyle owns per-room grouping', async () => {
  const { sent, transport } = createHarness();
  await transport.send({
    type: 'message',
    room: 'ShittyChat',
    messageId: 'msg-1',
    sender: 'Steph',
    preview: 'hello',
    notificationKey: 'same-user-same-room',
    timestamp: '2026-09-26T20:00:00.000Z',
  }, 'device-token');

  assert.equal(sent.length, 1);
  const payload = sent[0];
  assert.equal(payload.token, 'device-token');
  assert.equal(payload.notification, undefined, 'FCM must not post its own individual Android notification');
  assert.equal(payload.android.priority, 'high', 'wake native receiver for background data pushes');
  assert.equal(payload.android.notification, undefined);
  assert.equal(payload.data.notificationKey, 'same-user-same-room');
  assert.equal(payload.data.messageId, 'msg-1');
  assert.equal(payload.data.room, 'ShittyChat');
  assert.equal(payload.data.preview, 'hello');

  assert.deepEqual(payload.apns.payload.aps.alert, {
    title: 'Steph · ShittyChat',
    body: 'hello',
  });
  assert.equal(payload.apns.payload.aps.sound, 'default');
  assert.equal(payload.apns.payload.aps.category, 'DIZYCHAT_MESSAGE');
  assert.equal(payload.apns.headers['apns-push-type'], 'alert');
});

test('multiple same-room messages preserve grouping key and unique message cursors', async () => {
  const { sent, transport } = createHarness();
  for (const messageId of ['msg-1', 'msg-2', 'msg-3']) {
    await transport.send({
      type: 'message',
      room: 'ShittyChat',
      messageId,
      sender: 'Steph',
      preview: messageId,
      notificationKey: 'stable-room-key',
      timestamp: '2026-09-26T20:00:00.000Z',
    }, 'device-token');
  }
  assert.equal(sent.length, 3);
  assert.deepEqual(sent.map((payload) => payload.data.messageId), ['msg-1', 'msg-2', 'msg-3']);
  assert.ok(sent.every((payload) =>
    payload.notification === undefined && payload.data.notificationKey === 'stable-room-key'));
});

test('message changes do not change activity or read-control delivery', async () => {
  const { sent, transport } = createHarness();
  await transport.send({ type: 'activity', room: 'ShittyChat', activityId: 'call-1' }, 'device-token');
  await transport.send({ type: 'read-control', room: 'ShittyChat', messageId: 'msg-1' }, 'device-token');

  assert.equal(sent.length, 2);
  assert.equal(sent[0].android.priority, 'high');
  assert.equal(sent[0].android.ttl, 120000);
  assert.equal(sent[0].notification, undefined);
  assert.equal(sent[1].apns.headers['apns-push-type'], 'background');
  assert.equal(sent[1].apns.payload.aps.contentAvailable, true);
});

test('Android native manager already replaces one notification per room with reply and read actions', () => {
  const manager = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/chat/dizychat/DizyNotificationManager.java'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/chat/dizychat/DizyNotificationStateStore.java'), 'utf8');
  const receiver = fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java'), 'utf8');

  assert.match(manager, /int notificationId = state\.notificationId;/);
  assert.match(manager, /NotificationManagerCompat\.from\(context\)\.notify\(notificationId, builder\.build\(\)\)/);
  assert.match(manager, /new NotificationCompat\.MessagingStyle\(localUser\)/);
  assert.match(manager, /addAction\(replyAction\)/);
  assert.match(manager, /addAction\(readAction\)/);
  assert.match(store, /resolveNotificationId\(prefs, key\)/);
  assert.match(store, /entries\.add\(new Entry\(normalizedMessageId, sender, preview, normalizedTimestamp\)\)/);
  assert.match(receiver, /DizyNotificationManager\.showMessageNotification\(/);
});
