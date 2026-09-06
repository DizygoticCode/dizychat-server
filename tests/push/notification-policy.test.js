'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDevicePushEligible,
  buildPushIntent,
  buildSafePreview,
  buildNotificationKey,
} = require('../../src/push/notification-policy');

const message = {
  _id: '507f1f77bcf86cd799439099',
  room: 'ShittyChat',
  user: 'Rob',
  text: 'hello there',
  timestamp: new Date('2026-09-05T20:00:10.000Z'),
};
const device = {
  canonicalUsername: 'nick',
  fcmToken: 'token-nick',
  disabledAt: null,
  suppressionLeaseExpiresAt: null,
};
const subscription = { room: 'ShittyChat' };

const eligible = (overrides = {}) => isDevicePushEligible({
  device,
  subscription,
  senderCanonicalUsername: 'rob',
  readCursor: null,
  message,
  now: new Date('2026-09-05T20:00:11.000Z'),
  ...overrides,
});

test('subscribed background device is eligible and browser presence is irrelevant', () => {
  assert.equal(eligible(), true);
  assert.equal(eligible({ browserPresent: true }), true);
});

test('same authenticated account is suppressed but guest display name is not guessed into account identity', () => {
  assert.equal(eligible({ device: { ...device, canonicalUsername: 'rob' }, senderCanonicalUsername: 'ROB' }), false);
  assert.equal(eligible({ device: { ...device, canonicalUsername: 'rob' }, senderCanonicalUsername: '', message: { ...message, user: 'Rob' } }), true);
});

test('fresh target-device lease suppresses while stale or cleared lease remains eligible', () => {
  assert.equal(eligible({ device: { ...device, suppressionLeaseExpiresAt: new Date('2026-09-05T20:00:20Z') } }), false);
  assert.equal(eligible({ device: { ...device, suppressionLeaseExpiresAt: new Date('2026-09-05T20:00:10Z') } }), true);
  assert.equal(eligible({ device: { ...device, suppressionLeaseExpiresAt: null } }), true);
});

test('disabled, tokenless, unsubscribed and already-read candidates are excluded', () => {
  assert.equal(eligible({ device: { ...device, disabledAt: new Date() } }), false);
  assert.equal(eligible({ device: { ...device, fcmToken: '' } }), false);
  assert.equal(eligible({ subscription: null }), false);
  assert.equal(eligible({ readCursor: { messageId: message._id, messageTimestamp: message.timestamp } }), false);
  assert.equal(eligible({ readCursor: { messageId: 'ffffffffffffffffffffffff', messageTimestamp: message.timestamp } }), false);
});

test('safe preview normalizes whitespace, caps text, and labels attachment-only messages without leaking URLs', () => {
  assert.equal(buildSafePreview({ text: 'hello\n\t  there' }), 'hello there');
  assert.equal(buildSafePreview({ text: 'x'.repeat(200) }).length, 160);
  assert.equal(buildSafePreview({ fileUrl: '/uploads/a.jpg', fileType: 'image/jpeg' }), 'sent an image');
  assert.equal(buildSafePreview({ fileUrl: '/uploads/a.webm', fileType: 'audio/webm' }), 'sent a voice message');
  assert.equal(buildSafePreview({ fileUrl: '/uploads/a.mp4', fileType: 'video/mp4' }), 'sent a video');
  assert.equal(buildSafePreview({ fileUrl: '/uploads/a.pdf', fileType: 'application/pdf' }), 'sent a file');
  assert.equal(buildSafePreview({ fileUrl: 'https://secret.example/raw' }).includes('http'), false);
});

test('push intent is allowlisted and notification key is stable opaque account+room hash', () => {
  const intent = buildPushIntent({ device, message });
  assert.deepEqual(Object.keys(intent).sort(), ['messageId', 'notificationKey', 'preview', 'room', 'sender', 'timestamp'].sort());
  assert.equal(intent.notificationKey, buildNotificationKey('nick', 'ShittyChat'));
  assert.match(intent.notificationKey, /^[a-f0-9]{24}$/);
  const serialized = JSON.stringify(intent);
  assert.equal(serialized.includes('token-nick'), false);
  assert.equal(serialized.includes('canonicalUsername'), false);
  assert.equal(serialized.includes('password'), false);
});
