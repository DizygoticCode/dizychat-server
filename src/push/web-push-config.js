'use strict';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

const readWebPushConfig = (env = process.env) => ({
  enabled: ENABLED_VALUES.has(String(env.DIZYCHAT_WEB_PUSH_ENABLED || '').trim().toLowerCase()),
  publicKey: String(env.DIZYCHAT_WEB_PUSH_VAPID_PUBLIC_KEY || '').trim(),
  privateKey: String(env.DIZYCHAT_WEB_PUSH_VAPID_PRIVATE_KEY || '').trim(),
  subject: String(env.DIZYCHAT_WEB_PUSH_SUBJECT || '').trim(),
});

const createConfiguredWebPushTransport = ({
  config = readWebPushConfig(),
  webPushModule,
  logger = console,
} = {}) => {
  if (!config.enabled) {
    logger.warn?.('[WebPush] disabled; Home Screen/browser background notifications will not be sent');
    return {
      enabled: false,
      publicKey: '',
      async send() {
        return { skipped: true, reason: 'web-push-disabled' };
      },
    };
  }

  if (!config.publicKey || !config.privateKey || !config.subject) {
    throw new Error('DIZYCHAT_WEB_PUSH_CONFIG_REQUIRED');
  }
  if (!/^mailto:|^https:/i.test(config.subject)) {
    throw new Error('DIZYCHAT_WEB_PUSH_SUBJECT_INVALID');
  }

  const webPush = webPushModule || require('web-push');
  webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  return {
    enabled: true,
    publicKey: config.publicKey,
    async send(subscription, payload) {
      return webPush.sendNotification(
        {
          endpoint: String(subscription?.endpoint || ''),
          keys: {
            p256dh: String(subscription?.p256dh || ''),
            auth: String(subscription?.auth || ''),
          },
        },
        JSON.stringify(payload || {}),
        {
          TTL: 120,
          urgency: 'high',
        },
      );
    },
  };
};

module.exports = {
  readWebPushConfig,
  createConfiguredWebPushTransport,
};
