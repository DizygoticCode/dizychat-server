'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFcmConfig, createConfiguredPushTransport } = require('../../src/push/fcm-config');
const { createFcmTransport } = require('../../src/push/transports/fcm-transport');

const intent = {
  room: 'ShittyChat',
  messageId: '507f1f77bcf86cd799439099',
  sender: 'Rob',
  preview: 'hello',
  notificationKey: '0123456789abcdef01234567',
  timestamp: '2026-09-05T20:00:10.000Z',
};

test('disabled config returns null transport without creating Firebase messaging', async () => {
  let created = 0;
  const config = readFcmConfig({ DIZYCHAT_FCM_ENABLED: 'false' });
  const transport = createConfiguredPushTransport({
    config,
    messagingFactory: () => { created += 1; return { send: async () => {} }; },
  });
  await transport.send(intent, 'token');
  assert.equal(created, 0);
});

test('enabled transport serializes only allowlisted data and token envelope', async () => {
  const payloads = [];
  const transport = createFcmTransport({
    projectId: 'dizychat-test',
    messagingFactory: () => ({ send: async (payload) => { payloads.push(payload); return 'ok'; } }),
  });
  await transport.send({ ...intent, authToken: 'NOPE', password: 'NOPE2', serverSecret: 'NOPE3' }, 'fcm-token');
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].token, 'fcm-token');
  assert.deepEqual(Object.keys(payloads[0].data).sort(), ['messageId', 'notificationKey', 'preview', 'room', 'sender', 'timestamp'].sort());
  const serialized = JSON.stringify(payloads[0]);
  assert.equal(serialized.includes('NOPE'), false);
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('serverSecret'), false);
});

test('registration-token-not-registered is classified permanent', async () => {
  const transport = createFcmTransport({
    messagingFactory: () => ({ send: async () => { const error = new Error('gone'); error.code = 'messaging/registration-token-not-registered'; throw error; } }),
  });
  await assert.rejects(
    () => transport.send(intent, 'bad-token'),
    (error) => error.code === 'messaging/registration-token-not-registered' && error.permanent === true,
  );
});

test('temporary Firebase errors are non-permanent', async () => {
  const transport = createFcmTransport({
    messagingFactory: () => ({ send: async () => { const error = new Error('unavailable'); error.code = 'messaging/server-unavailable'; throw error; } }),
  });
  await assert.rejects(
    () => transport.send(intent, 'token'),
    (error) => error.code === 'messaging/server-unavailable' && error.permanent === false,
  );
});

test('config parser requires explicit enable and preserves project id', () => {
  assert.deepEqual(readFcmConfig({ DIZYCHAT_FCM_ENABLED: 'yes', DIZYCHAT_FIREBASE_PROJECT_ID: ' abc ' }), { enabled: true, projectId: 'abc' });
  assert.equal(readFcmConfig({ DIZYCHAT_FCM_ENABLED: 'no' }).enabled, false);
});
