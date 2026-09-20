'use strict';

const crypto = require('node:crypto');

const safeSecretEqual = (left, right) => {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const resolveCallTokenGrant = ({
  io,
  room,
  socketId,
  nonce,
} = {}) => {
  const targetRoom = String(room || '').trim();
  const targetSocketId = String(socketId || '').trim();
  const suppliedNonce = String(nonce || '').trim();

  if (!targetRoom || !targetSocketId || !suppliedNonce) {
    return { ok: false, code: 'CALL_GRANT_REQUIRED' };
  }

  const socket = io?.of?.('/')?.sockets?.get?.(targetSocketId) || null;
  if (!socket) {
    return { ok: false, code: 'CALL_GRANT_SOCKET_MISSING' };
  }

  if (String(socket.currentRoom || '').trim() !== targetRoom) {
    return { ok: false, code: 'CALL_GRANT_ROOM_MISMATCH' };
  }

  if (!safeSecretEqual(socket.callTokenNonce, suppliedNonce)) {
    return { ok: false, code: 'CALL_GRANT_NONCE_INVALID' };
  }

  const username = String(socket.username || '').trim();
  if (!username) {
    return { ok: false, code: 'CALL_GRANT_IDENTITY_MISSING' };
  }

  return {
    ok: true,
    code: 'CALL_GRANT_OK',
    socket,
    room: targetRoom,
    username,
  };
};

module.exports = {
  resolveCallTokenGrant,
  safeSecretEqual,
};
