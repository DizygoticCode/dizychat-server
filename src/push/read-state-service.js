'use strict';

const { canonicalizeUsername } = require('../auth/identity');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const MAX_ADVANCE_ATTEMPTS = 16;

const normalizeCursor = (cursor = {}) => {
  const messageId = String(cursor.messageId || '').trim().toLowerCase();
  const rawTimestamp = cursor.messageTimestamp ?? cursor.timestamp;
  const timestamp = rawTimestamp instanceof Date ? new Date(rawTimestamp.getTime()) : new Date(rawTimestamp);
  if (!OBJECT_ID_PATTERN.test(messageId)) throw new TypeError('messageId must be a 24-character ObjectId');
  if (Number.isNaN(timestamp.getTime())) throw new TypeError('timestamp must be a valid date');
  return { messageId, timestamp };
};

const compareCursor = (left, right) => {
  const a = normalizeCursor(left);
  const b = normalizeCursor(right);
  const timeDifference = a.timestamp.getTime() - b.timestamp.getTime();
  if (timeDifference !== 0) return timeDifference < 0 ? -1 : 1;
  if (a.messageId === b.messageId) return 0;
  return a.messageId < b.messageId ? -1 : 1;
};

const normalizeIdentity = ({ canonicalUsername, room } = {}) => {
  const canonical = canonicalizeUsername(canonicalUsername);
  const normalizedRoom = String(room || '').trim();
  if (!canonical) throw new TypeError('canonicalUsername is required');
  if (!normalizedRoom) throw new TypeError('room is required');
  return { canonicalUsername: canonical, room: normalizedRoom };
};

const createReadStateService = ({ RoomReadCursorModel } = {}) => {
  if (!RoomReadCursorModel || typeof RoomReadCursorModel.findOne !== 'function'
      || typeof RoomReadCursorModel.create !== 'function'
      || typeof RoomReadCursorModel.findOneAndUpdate !== 'function') {
    throw new TypeError('RoomReadCursorModel with findOne/create/findOneAndUpdate is required');
  }

  const getCursor = async (identity) => {
    const normalized = normalizeIdentity(identity);
    return RoomReadCursorModel.findOne(normalized);
  };

  const advanceCursor = async (input = {}) => {
    const identity = normalizeIdentity(input);
    const candidate = normalizeCursor(input);

    for (let attempt = 0; attempt < MAX_ADVANCE_ATTEMPTS; attempt += 1) {
      const observed = await RoomReadCursorModel.findOne(identity);

      if (!observed) {
        try {
          const created = await RoomReadCursorModel.create({
            ...identity,
            messageId: candidate.messageId,
            messageTimestamp: candidate.timestamp,
          });
          return { advanced: true, cursor: created };
        } catch (error) {
          if (Number(error?.code) === 11000) continue;
          throw error;
        }
      }

      const observedCursor = {
        messageId: observed.messageId,
        messageTimestamp: observed.messageTimestamp,
      };
      if (compareCursor(candidate, observedCursor) <= 0) {
        return { advanced: false, cursor: observed };
      }

      const updated = await RoomReadCursorModel.findOneAndUpdate(
        {
          ...identity,
          messageId: String(observed.messageId),
          messageTimestamp: observed.messageTimestamp,
        },
        {
          $set: {
            messageId: candidate.messageId,
            messageTimestamp: candidate.timestamp,
          },
        },
        { new: true },
      );
      if (updated) return { advanced: true, cursor: updated };
    }

    const finalCursor = await RoomReadCursorModel.findOne(identity);
    if (finalCursor && compareCursor(candidate, finalCursor) <= 0) {
      return { advanced: false, cursor: finalCursor };
    }
    const error = new Error('READ_CURSOR_CONTENTION');
    error.code = 'READ_CURSOR_CONTENTION';
    throw error;
  };

  return {
    advanceCursor,
    getCursor,
  };
};

module.exports = {
  compareCursor,
  createReadStateService,
};
