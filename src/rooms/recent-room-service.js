'use strict';

// Account-scoped room navigation metadata only. Never store a room password,
// account token, access grant, membership claim or message content here.
const MAX_RECENT_ROOMS = 8;
const normalizeRoom = (value) => typeof value === 'string'
  ? value.trim().slice(0, 80)
  : '';

const accountFilter = (principal) => (
  principal?.kind === 'account'
  && typeof principal.userId === 'string'
  && principal.userId
  && typeof principal.canonicalUsername === 'string'
  && principal.canonicalUsername
)
  ? {
    _id: principal.userId,
    canonicalUsername: principal.canonicalUsername,
    state: 'active',
  }
  : null;

const roomNames = (account) => {
  const entries = Array.isArray(account?.recentRooms) ? account.recentRooms : [];
  const names = [];
  for (const entry of entries) {
    const name = normalizeRoom(entry?.name);
    if (!name || names.includes(name)) continue;
    names.push(name);
    if (names.length === MAX_RECENT_ROOMS) break;
  }
  return names;
};

const createRecentRoomService = ({ UserModel } = {}) => {
  if (!UserModel || typeof UserModel.findOne !== 'function') {
    throw new TypeError('UserModel.findOne is required');
  }

  const activeAccount = async (principal) => {
    const filter = accountFilter(principal);
    return filter ? UserModel.findOne(filter) : null;
  };

  const list = async (principal) => {
    const account = await activeAccount(principal);
    return account ? roomNames(account) : null;
  };

  const record = async (principal, roomValue) => {
    const name = normalizeRoom(roomValue);
    if (!name) return null;
    const account = await activeAccount(principal);
    if (!account) return null;
    const previousEntries = Array.isArray(account.recentRooms) ? account.recentRooms : [];
    account.recentRooms = [
      { name, joinedAt: new Date() },
      ...roomNames(account).filter((room) => room !== name).map((room) => ({
        name: room,
        joinedAt: previousEntries.find((entry) => entry?.name === room)?.joinedAt || new Date(),
      })),
    ].slice(0, MAX_RECENT_ROOMS);
    await account.save();
    return roomNames(account);
  };

  const forget = async (principal, roomValue) => {
    const name = normalizeRoom(roomValue);
    if (!name) return null;
    const account = await activeAccount(principal);
    if (!account) return null;
    account.recentRooms = (Array.isArray(account.recentRooms) ? account.recentRooms : [])
      .filter((entry) => normalizeRoom(entry?.name) !== name)
      .slice(0, MAX_RECENT_ROOMS);
    await account.save();
    return roomNames(account);
  };

  return { list, record, forget };
};

module.exports = { MAX_RECENT_ROOMS, createRecentRoomService };
