'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isScryptHash } = require('../src/auth/passwords');
let createRoomPasswordService;
try {
  ({ createRoomPasswordService } = require('../src/rooms/room-password-service'));
} catch (_error) {
  createRoomPasswordService = null;
}

class FakeRoomModel {
  static rows = new Map();

  static reset() {
    this.rows = new Map();
  }

  static async find() {
    return Array.from(this.rows.values()).map((row) => ({ ...row }));
  }

  static async findOne(query) {
    const row = this.rows.get(query.name);
    return row ? { ...row } : null;
  }

  static async create(doc) {
    if (this.rows.has(doc.name)) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    const row = { name: doc.name, passwordHash: doc.passwordHash || '' };
    this.rows.set(doc.name, row);
    return { ...row };
  }

  static async updateOne(query, update, options = {}) {
    const existing = this.rows.get(query.name);
    if (existing) return { acknowledged: true, matchedCount: 1, upsertedCount: 0 };
    if (!options.upsert) return { acknowledged: true, matchedCount: 0, upsertedCount: 0 };
    const insert = { name: query.name, ...(update.$setOnInsert || {}) };
    this.rows.set(query.name, insert);
    return { acknowledged: true, matchedCount: 0, upsertedCount: 1 };
  }
}

const makeService = () => {
  assert.equal(typeof createRoomPasswordService, 'function', 'room password persistence service must exist');
  return createRoomPasswordService({ RoomModel: FakeRoomModel });
};

test.beforeEach(() => {
  FakeRoomModel.reset();
});

test('first protected join stores a salted hash and never plaintext', async () => {
  const service = makeService();
  const result = await service.claimOrVerify('ShittyChat', 'shit123');

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(isScryptHash(result.passwordHash), true);
  assert.notEqual(result.passwordHash, 'shit123');
  assert.equal(FakeRoomModel.rows.get('ShittyChat').passwordHash, result.passwordHash);
});

test('protected room password survives a service restart', async () => {
  const service1 = makeService();
  await service1.claimOrVerify('ShittyChat', 'shit123');

  const service2 = makeService();
  const accepted = await service2.claimOrVerify('ShittyChat', 'shit123');
  const rejected = await service2.claimOrVerify('ShittyChat', 'wrong');

  assert.equal(accepted.ok, true);
  assert.equal(accepted.created, false);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.created, false);
});

test('unprotected room remains unprotected after restart and cannot be redefined', async () => {
  const service1 = makeService();
  const initial = await service1.claimOrVerify('Open Room', '');
  assert.equal(initial.ok, true);
  assert.equal(initial.passwordHash, '');

  const service2 = makeService();
  const blankJoin = await service2.claimOrVerify('Open Room', '');
  const takeover = await service2.claimOrVerify('Open Room', 'new-password');

  assert.equal(blankJoin.ok, true);
  assert.equal(takeover.ok, false);
  assert.equal(FakeRoomModel.rows.get('Open Room').passwordHash, '');
});

test('ensuring persistent rooms never overwrites an existing protected password', async () => {
  const service = makeService();
  const protectedRoom = await service.claimOrVerify('General Chat', 'secret');

  await service.ensureRooms(['General Chat', 'AJN Chat']);

  assert.equal(FakeRoomModel.rows.get('General Chat').passwordHash, protectedRoom.passwordHash);
  assert.equal(FakeRoomModel.rows.get('AJN Chat').passwordHash, '');
});

test('duplicate first-join race refetches authority and verifies against the winner', async () => {
  const service = makeService();
  const originalCreate = FakeRoomModel.create.bind(FakeRoomModel);
  let first = true;
  FakeRoomModel.create = async (doc) => {
    if (first) {
      first = false;
      await originalCreate({ name: doc.name, passwordHash: doc.passwordHash });
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    return originalCreate(doc);
  };

  try {
    const result = await service.claimOrVerify('Race Room', 'race-pass');
    assert.equal(result.ok, true);
    assert.equal(result.created, false);
  } finally {
    FakeRoomModel.create = originalCreate;
  }
});


test('public DIZY room is seeded even while empty without changing room password authority', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server-core.js'), 'utf8');
  const match = server.match(/const PERSISTENT_ROOMS = (\\[[\\s\\S]*?\\]);/);
  assert.ok(match, 'server must declare persistent room names');
  const persistentRooms = JSON.parse(match[1].replace(/'/g, '"'));
  assert.ok(persistentRooms.includes('DIZY'), 'DIZY room must persist even when empty');
  assert.match(server, /PERSISTENT_ROOMS\\.forEach\\(\\(room\\) => \\{/);
  assert.match(server, /if \\(requiresPassword\\) return;/);

  const service = makeService();
  await service.ensureRooms(persistentRooms);
  assert.equal(FakeRoomModel.rows.get('DIZY').passwordHash, '');
  const publicJoin = await service.claimOrVerify('DIZY', '');
  assert.equal(publicJoin.ok, true);

  FakeRoomModel.reset();
  const protectedRoom = await service.claimOrVerify('DIZY', 'private-password');
  await service.ensureRooms(persistentRooms);
  assert.equal(FakeRoomModel.rows.get('DIZY').passwordHash, protectedRoom.passwordHash);
  assert.equal((await service.claimOrVerify('DIZY', '')).ok, false,
    'a pre-existing protected room must never be changed into a public room');
});
