'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFcmTransport } = require('../../src/push/transports/fcm-transport');

test('actual send logs token fingerprint and Firebase acceptance id without token or message content', async () => {
  const logs = [];
  const transport = createFcmTransport({ projectId: 'dizychat', logger: { info: (...args) => logs.push(args) },
    messagingFactory: () => ({ send: async () => 'projects/dizychat/messages/123' }) });
  const result = await transport.send({ type: 'message', messageId: 'abc', preview: 'PRIVATE_BODY' }, ' test-token ');
  assert.equal(result, 'projects/dizychat/messages/123');
  assert.equal(logs.length, 2);
  assert.equal(logs[0][1].tokenFingerprint, '4c5dc9b77089');
  assert.equal(logs[1][1].firebaseMessageId, result);
  assert.equal(logs[1][1].tokenFingerprint, logs[0][1].tokenFingerprint);
  assert.equal(JSON.stringify(logs).includes('test-token'), false);
  assert.equal(JSON.stringify(logs).includes('PRIVATE_BODY'), false);
});

test('diagnostic logger failure cannot turn an accepted send into a failed send', async () => {
  const transport = createFcmTransport({ logger: { info: () => { throw Error('logger down'); } },
    messagingFactory: () => ({ send: async () => 'accepted' }) });
  assert.equal(await transport.send({}, 'test-token'), 'accepted');
});

test('failed send logs only safe code, never Firebase error text containing token', async () => {
  const logs = [];
  const transport = createFcmTransport({ logger: { info: (...args) => logs.push(args) },
    messagingFactory: () => ({ send: async () => { const e = Error('SECRET_TOKEN'); e.code = 'messaging/server-unavailable'; throw e; } }) });
  await assert.rejects(transport.send({}, 'SECRET_TOKEN'));
  assert.equal(logs.at(-1)[1].code, 'messaging/server-unavailable');
  assert.equal(JSON.stringify(logs).includes('SECRET_TOKEN'), false);
});
