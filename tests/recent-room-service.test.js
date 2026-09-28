'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecentRoomService } = require('../src/rooms/recent-room-service');

class FakeRecentRoomModel {
  static records = [];

  static reset() {
    this.records = [];
  }

  static async updateOne(query, update) {
    let row = this.records.find((record) => record.userId === query.userId && record.room === query.room);
    if (!row) {
      row = { userId: query.userId, room: query.room };
      this.records.push(row);
    }
    Object.assign(row, update.$set);
  }

  static find(query) {
    let rows = this.records.filter((record) => record.userId === query.userId);
    return {
      sort() {
        rows.sort((a, b) => b.lastJoinedAt - a.lastJoinedAt || b.room.localeCompare(a.room));
        return this;
      },
      limit(max) {
        rows = rows.slice(0, max);
        return this;
      },
      async lean() {
        return rows.map((row) => ({ ...row }));
      },
    };
  }

  static async deleteMany(query) {
    this.records = this.records.filter((row) =>
      row.userId !== query.userId || (query.room && query.room.$nin.includes(row.room)));
  }
}

const roomNames = new Map([['DIZY', false], ['Private', true], ['General Chat', false]]);
const makeService = () => createRecentRoomService({
  RecentRoomModel: FakeRecentRoomModel,
  roomExists: (name) => roomNames.has(name),
  roomRequiresPassword: (name) => roomNames.get(name),
  maxRooms: 2,
});

test.beforeEach(() => FakeRecentRoomModel.reset());

test('stores only bounded room names under the authenticated account id', async () => {
  const service = makeService();
  await service.record('account-1', 'DIZY');
  await service.record('account-1', 'Private');
  const result = await service.list('account-1');
  assert.deepEqual(result.map((room) => room.name).sort(), ['DIZY', 'Private']);
  assert.equal(result.find((room) => room.name === 'Private').requiresPassword, true);
  assert.equal(FakeRecentRoomModel.records.length, 2);
  assert.ok(FakeRecentRoomModel.records.every((row) =>
    Object.keys(row).every((key) => ['userId', 'room', 'lastJoinedAt'].includes(key))));
});

test('caps the stored room history and isolates a second registered account', async () => {
  const service = makeService();
  await service.record('first', 'DIZY');
  await service.record('first', 'Private');
  await service.record('first', 'General Chat');
  await service.record('second', 'DIZY');
  assert.equal(FakeRecentRoomModel.records.filter((row) => row.userId === 'first').length, 2);
  assert.deepEqual((await service.list('second')).map((room) => room.name), ['DIZY']);
  await service.clear('first');
  assert.deepEqual(await service.list('first'), []);
  assert.deepEqual((await service.list('second')).map((room) => room.name), ['DIZY']);
});

test('does not reveal or store invalid room and user identifiers', async () => {
  const service = makeService();
  assert.deepEqual(await service.record('', 'DIZY'), []);
  assert.deepEqual(await service.record('first', ' Private '), []);
  assert.deepEqual(await service.record('first', 'X'.repeat(81)), []);
  assert.equal(FakeRecentRoomModel.records.length, 0);
});

test('does not list a deleted room, and password state is read from current authority', async () => {
  const service = makeService();
  await service.record('first', 'DIZY');
  roomNames.delete('DIZY');
  try {
    assert.deepEqual(await service.list('first'), []);
  } finally {
    roomNames.set('DIZY', false);
  }
});
