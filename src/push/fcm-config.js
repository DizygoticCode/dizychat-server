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
  logger = console,
} = {}) => {
  if (!config.enabled) {
    logger.warn?.('[Push] FCM disabled; remote notifications will not be sent');
    return createNullTransport();
  }
  if (!config.projectId) {
    throw new Error('DIZYCHAT_FIREBASE_PROJECT_ID_REQUIRED');
  }
  if (!messagingFactory && !String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) {
    logger.warn?.('[Push] GOOGLE_APPLICATION_CREDENTIALS unset; Firebase Admin will rely on ambient ADC');
  }
  return createFcmTransport({
    projectId: config.projectId,
    messagingFactory: messagingFactory || createDefaultMessagingFactory(),
    logger,
  });
};

module.exports = {
  createDefaultMessagingFactory,
  createConfiguredPushTransport,
  readFcmConfig,
};
