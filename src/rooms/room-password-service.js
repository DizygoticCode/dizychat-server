'use strict';

const { hashPassword, verifyPassword } = require('../auth/passwords');

const createRoomPasswordService = ({ RoomModel }) => {
  if (!RoomModel) throw new TypeError('RoomModel is required');

  const normaliseRoomName = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, 80);
  };

  const normalisePassword = (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, 120);
  };

  const toResult = (document, providedPassword, created = false) => {
    const passwordHash = typeof document?.passwordHash === 'string' ? document.passwordHash : '';
    const ok = passwordHash
      ? verifyPassword(providedPassword, passwordHash)
      : providedPassword === '';
    return { ok, created, passwordHash };
  };

  const loadAll = async () => {
    const documents = await RoomModel.find({});
    const passwords = new Map();
    for (const document of documents || []) {
      const name = normaliseRoomName(document?.name);
      if (!name) continue;
      passwords.set(name, typeof document?.passwordHash === 'string' ? document.passwordHash : '');
    }
    return passwords;
  };

  const ensureRooms = async (roomNames) => {
    const uniqueNames = new Set(
      (Array.isArray(roomNames) ? roomNames : [])
        .map(normaliseRoomName)
        .filter(Boolean)
    );

    for (const name of uniqueNames) {
      await RoomModel.updateOne(
        { name },
        { $setOnInsert: { name, passwordHash: '' } },
        { upsert: true }
      );
    }
  };

  const claimOrVerify = async (roomName, rawPassword) => {
    const name = normaliseRoomName(roomName);
    if (!name) throw new TypeError('room name is required');
    const providedPassword = normalisePassword(rawPassword);

    const existing = await RoomModel.findOne({ name });
    if (existing) return toResult(existing, providedPassword, false);

    const passwordHash = providedPassword ? hashPassword(providedPassword) : '';
    try {
      const created = await RoomModel.create({ name, passwordHash });
      return toResult(created, providedPassword, true);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const winner = await RoomModel.findOne({ name });
      if (!winner) throw error;
      return toResult(winner, providedPassword, false);
    }
  };

  return {
    loadAll,
    ensureRooms,
    claimOrVerify,
  };
};

module.exports = { createRoomPasswordService };
