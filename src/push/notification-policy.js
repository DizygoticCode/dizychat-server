'use strict';

const crypto = require('crypto');
const { canonicalizeUsername } = require('../auth/identity');
const { compareCursor } = require('./read-state-service');

const MAX_PREVIEW_LENGTH = 160;

const buildSafePreview = (message = {}) => {
  const text = String(message.text || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, MAX_PREVIEW_LENGTH);

  if (!message.fileUrl) return '';
  const fileType = String(message.fileType || '').toLowerCase();
  if (fileType.startsWith('image/')) return 'sent an image';
  if (fileType.startsWith('audio/')) return 'sent a voice message';
  if (fileType.startsWith('video/')) return 'sent a video';
  return 'sent a file';
};

const buildNotificationKey = (canonicalUsername, room) => {
  const canonical = canonicalizeUsername(canonicalUsername);
  const normalizedRoom = String(room || '').trim();
  return crypto
    .createHash('sha256')
    .update(`${canonical}\0${normalizedRoom}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
};

const isDevicePushEligible = ({
  device,
  subscription,
  senderCanonicalUsername = '',
  readCursor = null,
  message,
  now = new Date(),
} = {}) => {
  if (!device || device.disabledAt != null || !String(device.fcmToken || '').trim()) return false;
  if (!subscription) return false;

  const senderCanonical = canonicalizeUsername(senderCanonicalUsername);
  const recipientCanonical = canonicalizeUsername(device.canonicalUsername);
  if (senderCanonical && recipientCanonical && senderCanonical === recipientCanonical) return false;

  const current = now instanceof Date ? now : new Date(now);
  const lease = device.suppressionLeaseExpiresAt == null
    ? null
    : new Date(device.suppressionLeaseExpiresAt);
  if (lease && !Number.isNaN(lease.getTime()) && lease.getTime() > current.getTime()) return false;

  if (readCursor) {
    try {
      const messageCursor = {
        messageId: String(message?._id || message?.id || ''),
        timestamp: message?.timestamp,
      };
      if (compareCursor(messageCursor, readCursor) <= 0) return false;
    } catch {
      return false;
    }
  }

  return true;
};

const buildPushIntent = ({ device, message } = {}) => {
  const timestamp = message?.timestamp instanceof Date
    ? message.timestamp.toISOString()
    : new Date(message?.timestamp).toISOString();
  return {
    type: 'message',
    room: String(message?.room || ''),
    messageId: String(message?._id || message?.id || ''),
    sender: String(message?.user || ''),
    preview: buildSafePreview(message),
    notificationKey: buildNotificationKey(device?.canonicalUsername, message?.room),
    timestamp,
  };
};

const buildReadControlIntent = ({ device, room, cursor } = {}) => ({
  type: 'read-control',
  room: String(room || '').trim(),
  messageId: String(cursor?.messageId || '').trim().toLowerCase(),
  sender: '',
  preview: '',
  notificationKey: buildNotificationKey(device?.canonicalUsername, room),
  timestamp: cursor?.messageTimestamp instanceof Date
    ? cursor.messageTimestamp.toISOString()
    : new Date(cursor?.messageTimestamp).toISOString(),
});

module.exports = {
  MAX_PREVIEW_LENGTH,
  buildNotificationKey,
  buildPushIntent,
  buildReadControlIntent,
  buildSafePreview,
  isDevicePushEligible,
};
