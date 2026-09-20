'use strict';

const { canonicalizeUsername } = require('../auth/identity');

const normalizeRoomName = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 80);
};

const resolveCurrentSocketRoom = (socket, requestedRoom) => {
  const currentRoom = normalizeRoomName(socket?.currentRoom);
  if (!currentRoom) return '';

  const requested = normalizeRoomName(requestedRoom);
  if (requested && requested !== currentRoom) return '';

  return currentRoom;
};

const resolveSocketUsername = (socket) => {
  if (typeof socket?.username !== 'string') return '';
  return socket.username.trim().slice(0, 60);
};

const isMessageAuthor = (message, username) => {
  const actor = canonicalizeUsername(username);
  const author = canonicalizeUsername(message?.user);
  return Boolean(actor && author && actor === author);
};

module.exports = {
  isMessageAuthor,
  normalizeRoomName,
  resolveCurrentSocketRoom,
  resolveSocketUsername,
};
