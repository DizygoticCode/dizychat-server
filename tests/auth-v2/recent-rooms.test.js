'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_RECENT_ROOMS, createRecentRoomService } = require('../../src/rooms/recent-room-service');

class FakeUserModel {
  static docs = [];
  static async findOne(filter) {
    return this.docs.find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) || null;
  }
}
const principal = (id) => ({
  kind: 'account', userId: id, canonicalUsername: id, role: 'user',
});
const account = (id) => ({
  _id: id, canonicalUsername: id, state: 'active', recentRooms: [],
  async save() { this.saves = (this.saves || 0) + 1; },
});
const service = createRecentRoomService({ UserModel: FakeUserModel });

test('a guest, a fabricated user id and a disabled account cannot read or change history', async () => {
  FakeUserModel.docs = [account('alice'), account('disabled')];
  FakeUserModel.docs[1].state = 'disabled';
  assert.equal(await service.list({ kind: 'guest', username: 'alice' }), null);
  assert.equal(await service.record({ kind: 'guest', username: 'alice' }, 'Private'), null);
  assert.equal(await service.list(principal('missing')), null);
  assert.equal(await service.list(principal('disabled')), null);
  assert.equal(await service.record(principal('disabled'), 'Private'), null);
  assert.deepEqual(FakeUserModel.docs[0].recentRooms, []);
});

test('only bounded successful room names are stored per account, without caller payloads', async () => {
  const alice = account('alice');
  const bob = account('bob');
  FakeUserModel.docs = [alice, bob];
  for (let i = 0; i < 12; i++) {
    await service.record(principal('alice'), 'Room ' + i);
  }
  assert.deepEqual(await service.list(principal('alice')), [
    'Room 11', 'Room 10', 'Room 9', 'Room 8',
    'Room 7', 'Room 6', 'Room 5', 'Room 4',
  ]);
  assert.equal(alice.recentRooms.length, MAX_RECENT_ROOMS);
  assert.equal(await service.list(principal('bob')).then((names) => names.length), 0);
  const previousDate = alice.recentRooms[3].joinedAt;
  await service.record(principal('alice'), 'Room 8');
  assert.equal(alice.recentRooms[0].name, 'Room 8');
  assert.equal(alice.recentRooms[3].name, 'Room 9');
  assert.ok(alice.recentRooms[3].joinedAt instanceof Date);
  assert.ok(previousDate instanceof Date);
  assert.equal(JSON.stringify(alice.recentRooms).includes('password'), false);
  assert.equal(JSON.stringify(alice.recentRooms).includes('token'), false);
  assert.ok(alice.recentRooms.every((entry) => Object.keys(entry).sort().join(',') === 'joinedAt,name'));
});

test('forgetting a room is account-scoped and never changes other accounts', async () => {
  const alice = account('alice');
  const bob = account('bob');
  FakeUserModel.docs = [alice, bob];
  await service.record(principal('alice'), 'Private');
  await service.record(principal('bob'), 'Private');
  assert.deepEqual(await service.forget(principal('alice'), 'Private'), []);
  assert.deepEqual(await service.list(principal('bob')), ['Private']);
  assert.equal(await service.forget(principal('alice'), '  '), null);
});

test('storage errors propagate for fail-closed socket handlers, not fake success', async () => {
  const alice = account('alice');
  alice.save = async () => { throw new Error('storage unavailable'); };
  FakeUserModel.docs = [alice];
  await assert.rejects(service.record(principal('alice'), 'Private'), /storage unavailable/);
});

test('server recent-room routes revalidate the live account session and contain no room credential', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '../../server-core.js'), 'utf8');
  const start = server.indexOf("socket.on('recent rooms get'");
  const end = server.indexOf("socket.on('account logout'", start);
  const handlers = server.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(handlers, /resolveRecentRoomsPrincipal\(socket\)/);
  assert.match(handlers, /recentRoomService\.list\(principal\)/);
  assert.match(handlers, /recentRoomService\.forget\(principal, name\)/);
  assert.doesNotMatch(handlers, /password|socket\.handshake\.auth|socket\.principal\.username/);
  const join = server.slice(server.indexOf("socket.on('join room'"), server.indexOf("socket.on('leave room'"));
  assert.ok(join.indexOf("roomPasswordService.claimOrVerify(roomName, providedPassword)")
    < join.indexOf("recentRoomService.record(principal, roomName)"));
  assert.ok(join.indexOf("if (bannedSet && bannedSet.has(canonicalUser))")
    < join.indexOf("recentRoomService.record(principal, roomName)"));
  assert.ok(join.indexOf("socket.emit('join room success')")
    < join.indexOf("recentRoomService.record(principal, roomName)"));
});
