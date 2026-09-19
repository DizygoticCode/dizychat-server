'use strict';

const { tokenFingerprint, trace } = require('../fcm-diagnostics');

const ALLOWED_DATA_KEYS = [
  'type',
  'room',
  'messageId',
  'sender',
  'preview',
  'notificationKey',
  'timestamp',
];

const PERMANENT_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const createFcmTransport = ({ projectId = '', messagingFactory, logger = console } = {}) => {
  if (typeof messagingFactory !== 'function') {
    throw new TypeError('messagingFactory is required');
  }

  const send = async (intent = {}, token) => {
    const targetToken = String(token || '').trim();
    if (!targetToken) {
      const error = new Error('FCM_TOKEN_INVALID');
      error.code = 'FCM_TOKEN_INVALID';
      error.permanent = true;
      throw error;
    }

    const data = {};
    for (const key of ALLOWED_DATA_KEYS) {
      data[key] = String(intent[key] ?? '');
    }

    const identity = { tokenFingerprint: tokenFingerprint(targetToken), projectId: String(projectId || '').trim(), type: data.type, messageId: data.messageId };
    try {
      const messaging = await messagingFactory({ projectId: String(projectId || '').trim() });
      if (!messaging || typeof messaging.send !== 'function') {
        throw new TypeError('Firebase messaging client with send() is required');
      }
      const message = { token: targetToken, data };
      if (data.type === 'message') {
        const sender = data.sender.trim() || 'DizyChat';
        const room = data.room.trim();
        const preview = data.preview.trim() || 'New message';
        message.notification = {
          title: room ? `${sender} · ${room}` : sender,
          body: preview,
        };
        message.android = {
          priority: 'high',
          notification: {
            channelId: 'dizychat_messages_v1',
            proxy: 'allow',
          },
        };
      }
      trace(logger, 'send-attempt', identity);
      const firebaseMessageId = await messaging.send(message);
      trace(logger, 'send-accepted', { ...identity, firebaseMessageId });
      return firebaseMessageId;
    } catch (error) {
      const code = String(error?.code || 'messaging/internal-error');
      trace(logger, 'send-failed', { ...identity, code });
      error.code = code;
      error.permanent = PERMANENT_TOKEN_CODES.has(code);
      throw error;
    }
  };

  return { send };
};

module.exports = {
  ALLOWED_DATA_KEYS,
  PERMANENT_TOKEN_CODES,
  createFcmTransport,
};
