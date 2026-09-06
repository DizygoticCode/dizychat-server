'use strict';

const { createFcmTransport } = require('./transports/fcm-transport');
const { createNullTransport } = require('./transports/null-transport');

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

const readFcmConfig = (env = process.env) => ({
  enabled: ENABLED_VALUES.has(String(env.DIZYCHAT_FCM_ENABLED || '').trim().toLowerCase()),
  projectId: String(env.DIZYCHAT_FIREBASE_PROJECT_ID || '').trim(),
});

const createDefaultMessagingFactory = () => async ({ projectId = '' } = {}) => {
  const {
    applicationDefault,
    getApp,
    getApps,
    initializeApp,
  } = require('firebase-admin/app');
  const { getMessaging } = require('firebase-admin/messaging');

  const app = getApps().length > 0
    ? getApp()
    : initializeApp({
        credential: applicationDefault(),
        ...(projectId ? { projectId } : {}),
      });
  return getMessaging(app);
};

const createConfiguredPushTransport = ({
  config = readFcmConfig(),
  messagingFactory,
} = {}) => {
  if (!config.enabled) return createNullTransport();
  return createFcmTransport({
    projectId: config.projectId,
    messagingFactory: messagingFactory || createDefaultMessagingFactory(),
  });
};

module.exports = {
  createConfiguredPushTransport,
  readFcmConfig,
};
