'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushCoordinator } = require('../../src/push/push-coordinator');

const message = {
  _id: '507f1f77bcf86cd799439099',
  room: 'ShittyChat',
  user: 'Rob',
  text: 'hello',
  timestamp: new Date('2026-09-05T20:00:10.000Z'),
};

const candidate = (username, token, lease = null) => ({
  device: {
    canonicalUsername: username,
    fcmToken: token,
    disabledAt: null,
    suppressionLeaseExpiresAt: lease,
  },
  subscription: { room: 'ShittyChat' },
});

function makeCoordinator({ devices = [], send, cursor = null, logs = [], retired = [] } = {}) {
  const pushDeviceService = {
    listRoomDevices: async () => devices,
    retireToken: async (token, reason) => retired.push({ token, reason }),
  };
  const readStateService = { getCursor: async () => cursor };
  const transport = { send: send || (async () => {}) };
  const logger = { warn: (...args) => logs.push(args) };
  return createPushCoordinator({
    pushDeviceService,
    readStateService,
    transport,
    logger,
    now: () => new Date('2026-09-05T20:00:11.000Z'),
  });
}

test('same-account registered sender is excluded using explicit canonical identity', async () => {
  const sent = [];
  const coordinator = makeCoordinator({
    devices: [candidate('rob', 'rob-token'), candidate('nick', 'nick-token')],
    send: async (_intent, token) => sent.push(token),
  });
  const result = await coordinator.onMessageStored(message, { senderCanonicalUsername: 'rob' });
  assert.deepEqual(sent, ['nick-token']);
  assert.deepEqual(result, { attempted: 1, sent: 1, failed: 0 });
});

test('guest display name is not guessed into account identity', async () => {
  const sent = [];
  const coordinator = makeCoordinator({
    devices: [candidate('rob', 'rob-token')],
    send: async (_intent, token) => sent.push(token),
  });
  await coordinator.onMessageStored({ ...message, user: 'Rob' }, { senderCanonicalUsername: '' });
  assert.deepEqual(sent, ['rob-token']);
});

test('independent device lease state suppresses only the leased device', async () => {
  const sent = [];
  const coordinator = makeCoordinator({
    devices: [
      candidate('nick', 'phone-a', new Date('2026-09-05T20:00:20Z')),
      candidate('nick', 'phone-b', null),
    ],
    send: async (_intent, token) => sent.push(token),
  });
  await coordinator.onMessageStored(message, { senderCanonicalUsername: 'rob' });
  assert.deepEqual(sent, ['phone-b']);
});

test('permanent invalid-token failure retires only that token', async () => {
  const retired = [];
  const coordinator = makeCoordinator({
    devices: [candidate('nick', 'bad-token'), candidate('alice', 'good-token')],
    retired,
    send: async (_intent, token) => {
      if (token === 'bad-token') {
        const error = new Error('not registered');
        error.code = 'messaging/registration-token-not-registered';
        error.permanent = true;
        throw error;
      }
    },
  });
  const result = await coordinator.onMessageStored(message, { senderCanonicalUsername: 'rob' });
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(retired, [{ token: 'bad-token', reason: 'messaging/registration-token-not-registered' }]);
});

test('temporary transport failure preserves registration', async () => {
  const retired = [];
  const coordinator = makeCoordinator({
    devices: [candidate('nick', 'temp-token')],
    retired,
    send: async () => {
      const error = new Error('unavailable');
      error.code = 'messaging/server-unavailable';
      error.permanent = false;
      throw error;
    },
  });
  const result = await coordinator.onMessageStored(message, { senderCanonicalUsername: 'rob' });
  assert.equal(result.failed, 1);
  assert.deepEqual(retired, []);
});

test('transport error logging never includes the raw FCM token', async () => {
  const logs = [];
  const coordinator = makeCoordinator({
    devices: [candidate('nick', 'SUPER-SECRET-FCM-TOKEN')],
    logs,
    send: async () => {
      const error = new Error('boom SUPER-SECRET-FCM-TOKEN');
      error.code = 'messaging/internal-error';
      throw error;
    },
  });
  await coordinator.onMessageStored(message, { senderCanonicalUsername: 'rob' });
  assert.equal(JSON.stringify(logs).includes('SUPER-SECRET-FCM-TOKEN'), false);
});

test('sendRoomClear is a no-op boundary in PR A', async () => {
  const coordinator = makeCoordinator();
  assert.deepEqual(await coordinator.sendRoomClear(), { attempted: 0, sent: 0, failed: 0 });
});
