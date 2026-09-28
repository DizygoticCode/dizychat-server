'use strict';

const DEFAULT_MAX_ROOMS = 8;

const validUserId = (value) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
const validRoom = (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= 80 && value === value.trim();

const createRecentRoomService = ({
  RecentRoomModel,
  roomExists,
  roomRequiresPassword,
  maxRooms = DEFAULT_MAX_ROOMS,
} = {}) => {
  if (!RecentRoomModel || typeof RecentRoomModel.updateOne !== 'function'
      || typeof RecentRoomModel.find !== 'function'
      || typeof RecentRoomModel.deleteMany !== 'function') {
    throw new TypeError('RecentRoomModel with updateOne/find/deleteMany required');
  }
  if (typeof roomExists !== 'function' || typeof roomRequiresPassword !== 'function') {
    throw new TypeError('room existence and password authority required');
  }
  if (!Number.isInteger(maxRooms) || maxRooms < 1 || maxRooms > 20) {
    throw new RangeError('maxRooms must be between 1 and 20');
  }

  const sorted = async (userId, limit = maxRooms) =>
    RecentRoomModel.find({ userId })
      .sort({ lastJoinedAt: -1, _id: -1 })
      .limit(limit)
      .lean();

  const list = async (userId) => {
    if (!validUserId(userId)) return [];
    const rows = await sorted(userId);
    return rows
      .filter((row) => validRoom(row.room) && roomExists(row.room))
      .map((row) => ({
        name: row.room,
        requiresPassword: Boolean(roomRequiresPassword(row.room)),
      }));
  };

  const record = async (userId, room) => {
    if (!validUserId(userId) || !validRoom(room)) return [];
    // The caller must invoke record *only after successful server-side room
    // password and ban checks*. Recent metadata never grants room access.
    await RecentRoomModel.updateOne(
      { userId, room },
      { $set: { lastJoinedAt: new Date() }, $setOnInsert: { userId, room } },
      { upsert: true },
    );
    const recent = await sorted(userId);
    if (recent.length >= maxRooms) {
      await RecentRoomModel.deleteMany({
        userId,
        room: { $nin: recent.map((entry) => entry.room) },
      });
    }
    return list(userId);
  };

  const clear = async (userId) => {
    if (!validUserId(userId)) return;
    await RecentRoomModel.deleteMany({ userId });
  };

  return { list, record, clear };
};

module.exports = { DEFAULT_MAX_ROOMS, createRecentRoomService };
