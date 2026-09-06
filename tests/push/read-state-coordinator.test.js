'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadStateCoordinator } = require('../../src/push/read-state-coordinator');

const cursor = {
  messageId: '507f1f77bcf86cd799439099',
  messageTimestamp: new Date('2026-09-06T12:00:00.000Z'),
};
const input = {
  canonicalUsername: 'nick',
  room: 'General Chat',
  messageId: cursor.messageId,
  messageTimestamp: cursor.messageTimestamp,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('real advancement schedules one read-control with the authoritative cursor', async () => {
  const controls = [];
  const coordinator = createReadStateCoordinator({
    readStateService: {
      advanceCursor: async () => ({ advanced: true, cursor }),
      getCursor: async () => cursor,
    },
    pushCoordinator: {
      sendRoomClear: async (control) => { controls.push(control); },
    },
    logger: { warn() {} },
  });
  const result = await coordinator.advance(input);
  await tick();
  assert.equal(result.advanced, true);
  assert.deepEqual(controls, [{ canonicalUsername: 'nick', room: 'General Chat', cursor }]);
});

test('equal or older cursor does not send read-control', async () => {
  const controls = [];
  const coordinator = createReadStateCoordinator({
    readStateService: {
      advanceCursor: async () => ({ advanced: false, cursor }),
      getCursor: async () => cursor,
    },
    pushCoordinator: { sendRoomClear: async (control) => controls.push(control) },
    logger: { warn() {} },
  });
  await coordinator.advance(input);
  await tick();
  assert.deepEqual(controls, []);
});

test('read-control failure cannot fail successful cursor advancement', async () => {
  const logs = [];
  const coordinator = createReadStateCoordinator({
    readStateService: {
      advanceCursor: async () => ({ advanced: true, cursor }),
      getCursor: async () => cursor,
    },
    pushCoordinator: {
      sendRoomClear: async () => {
        const error = new Error('FCM down');
        error.code = 'messaging/server-unavailable';
        throw error;
      },
    },
    logger: { warn: (...args) => logs.push(args) },
  });
  const result = await coordinator.advance(input);
  await tick();
  assert.equal(result.advanced, true);
  assert.equal(logs.length, 1);
  assert.equal(JSON.stringify(logs).includes('messaging/server-unavailable'), true);
});

test('getCursor remains a direct read of the authoritative account-room cursor', async () => {
  const calls = [];
  const coordinator = createReadStateCoordinator({
    readStateService: {
      advanceCursor: async () => ({ advanced: false, cursor }),
      getCursor: async (identity) => { calls.push(identity); return cursor; },
    },
    pushCoordinator: { sendRoomClear: async () => {} },
  });
  assert.equal(await coordinator.getCursor({ canonicalUsername: 'nick', room: 'General Chat' }), cursor);
  assert.deepEqual(calls, [{ canonicalUsername: 'nick', room: 'General Chat' }]);
});
