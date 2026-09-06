'use strict';

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

const createFcmTransport = ({ projectId = '', messagingFactory } = {}) => {
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

    try {
      const messaging = await messagingFactory({ projectId: String(projectId || '').trim() });
      if (!messaging || typeof messaging.send !== 'function') {
        throw new TypeError('Firebase messaging client with send() is required');
      }
      return await messaging.send({ token: targetToken, data });
    } catch (error) {
      const code = String(error?.code || 'messaging/internal-error');
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
