'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadStateService, compareCursor } = require('../../src/push/read-state-service');

const identity = { canonicalUsername: 'rob', room: 'ShittyChat' };
const older = { ...identity, messageId: '000000000000000000000001', timestamp: '2026-09-05T20:00:04.000Z' };
const newer = { ...identity, messageId: '000000000000000000000002', timestamp: '2026-09-05T20:00:05.000Z' };

function model(seed = null, hooks = {}) {
  let doc = seed ? { ...seed } : null;
  return {
    get doc() { return doc; },
    set doc(value) { doc = value ? { ...value } : null; },
    async findOne(query) {
      if (hooks.findOne) return hooks.findOne(query, doc);
      if (!doc) return null;
      return doc.canonicalUsername === query.canonicalUsername && doc.room === query.room ? { ...doc } : null;
    },
    async create(input) {
      if (hooks.create) return hooks.create(input, { get: () => doc, set: (value) => { doc = { ...value }; } });
      if (doc) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      doc = { ...input };
      return { ...doc };
    },
    async findOneAndUpdate(query, update) {
      if (hooks.findOneAndUpdate) return hooks.findOneAndUpdate(query, update, { get: () => doc, set: (value) => { doc = { ...value }; } });
      if (!doc) return null;
      if (String(doc.messageId) !== String(query.messageId)) return null;
      if (new Date(doc.messageTimestamp).getTime() !== new Date(query.messageTimestamp).getTime()) return null;
      doc = { ...doc, ...(update.$set || {}) };
      return { ...doc };
    },
  };
}

const serviceFor = (RoomReadCursorModel) => createReadStateService({ RoomReadCursorModel });

test('malformed message id is rejected', async () => {
  const service = serviceFor(model());
  await assert.rejects(
    () => service.advanceCursor({ ...identity, messageId: 'bad', timestamp: '2026-09-05T20:00:00Z' }),
    /messageId/i,
  );
});

test('older timestamp cannot move cursor backwards', async () => {
  const RoomReadCursorModel = model({
    ...identity,
    messageId: 'ffffffffffffffffffffffff',
    messageTimestamp: new Date('2026-09-05T20:00:05.000Z'),
  });
  const result = await serviceFor(RoomReadCursorModel).advanceCursor(older);
  assert.equal(result.advanced, false);
  assert.equal(RoomReadCursorModel.doc.messageId, 'ffffffffffffffffffffffff');
});

test('equal timestamp uses lowercase ObjectId lexical tie-break', () => {
  const a = { messageId: '00000000000000000000000a', timestamp: '2026-09-05T20:00:00Z' };
  const b = { messageId: '00000000000000000000000B', timestamp: '2026-09-05T20:00:00Z' };
  assert.ok(compareCursor(a, b) < 0);
  assert.ok(compareCursor(b, a) > 0);
});

test('newer cursor advances with compare-and-swap', async () => {
  const RoomReadCursorModel = model({
    ...identity,
    messageId: older.messageId,
    messageTimestamp: new Date(older.timestamp),
  });
  const result = await serviceFor(RoomReadCursorModel).advanceCursor(newer);
  assert.equal(result.advanced, true);
  assert.equal(RoomReadCursorModel.doc.messageId, newer.messageId);
});

test('CAS loser reloads and never overwrites a farther cursor', async () => {
  let firstUpdate = true;
  const farthest = {
    ...identity,
    messageId: 'ffffffffffffffffffffffff',
    messageTimestamp: new Date('2026-09-05T20:00:10.000Z'),
  };
  const RoomReadCursorModel = model({
    ...identity,
    messageId: older.messageId,
    messageTimestamp: new Date(older.timestamp),
  }, {
    findOneAndUpdate: async (_query, _update, state) => {
      if (firstUpdate) {
        firstUpdate = false;
        state.set(farthest);
        return null;
      }
      throw new Error('second update must not occur after farther cursor is observed');
    },
  });
  const result = await serviceFor(RoomReadCursorModel).advanceCursor(newer);
  assert.equal(result.advanced, false);
  assert.equal(RoomReadCursorModel.doc.messageId, farthest.messageId);
});

test('concurrent absent-row insert reloads duplicate and preserves farther cursor', async () => {
  const farthest = {
    ...identity,
    messageId: 'ffffffffffffffffffffffff',
    messageTimestamp: new Date('2026-09-05T20:00:10.000Z'),
  };
  let raced = false;
  const RoomReadCursorModel = model(null, {
    create: async (_input, state) => {
      if (!raced) {
        raced = true;
        state.set(farthest);
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      throw new Error('candidate must not retry insert over existing farther row');
    },
  });
  const result = await serviceFor(RoomReadCursorModel).advanceCursor(newer);
  assert.equal(result.advanced, false);
  assert.equal(RoomReadCursorModel.doc.messageId, farthest.messageId);
});

test('getCursor returns account+room cursor only', async () => {
  const RoomReadCursorModel = model({
    ...identity,
    messageId: newer.messageId,
    messageTimestamp: new Date(newer.timestamp),
  });
  assert.equal((await serviceFor(RoomReadCursorModel).getCursor(identity)).messageId, newer.messageId);
  assert.equal(await serviceFor(RoomReadCursorModel).getCursor({ canonicalUsername: 'nick', room: 'ShittyChat' }), null);
});
