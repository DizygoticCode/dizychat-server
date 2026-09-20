'use strict';

const { canonicalizeUsername } = require('../auth/identity');
const { buildActivityPreview, cleanActivityType } = require('./notification-policy');

const clean = (value) => String(value || '').trim();

const previewMessage = (message = {}) => {
  const text = clean(message.text).replace(/\s+/g, ' ').slice(0, 220);
  if (text) return text;
  if (message.fileName) return `Shared ${clean(message.fileName).slice(0, 120)}`;
  if (message.fileType) return 'Shared media';
  return 'New message';
};

const createWebPushCoordinator = ({
  subscriptionService,
  transport,
  logger = console,
} = {}) => {
  if (!subscriptionService || !transport || typeof transport.send !== 'function') {
    throw new TypeError('web push coordinator dependencies are required');
  }

  const onMessageStored = async (message, { senderCanonicalUsername = '' } = {}) => {
    const room = clean(message?.room);
    if (!room) return { attempted: 0, sent: 0, failed: 0 };

    const senderCanonical = canonicalizeUsername(senderCanonicalUsername);
    const sender = clean(message?.user) || 'DizyChat';
    const messageId = clean(message?._id || message?.id);
    const subscriptions = await subscriptionService.listRoomSubscriptions(room);
    const result = { attempted: 0, sent: 0, failed: 0 };

    for (const subscription of subscriptions || []) {
      if (senderCanonical && canonicalizeUsername(subscription?.canonicalUsername) === senderCanonical) {
        continue;
      }

      result.attempted += 1;
      const payload = {
        type: 'message',
        title: `${sender} · ${room}`,
        body: previewMessage(message),
        room,
        messageId,
        tag: `dizychat:${room}`,
        url: `/login.html?room=${encodeURIComponent(room)}${messageId ? `&messageId=${encodeURIComponent(messageId)}` : ''}`,
      };

      try {
        const response = await transport.send(subscription, payload);
        if (response?.skipped === true) {
          logger.warn?.('[WebPush] transport skipped send', {
            reason: String(response.reason || 'skipped'),
          });
          continue;
        }
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        const statusCode = Number(error?.statusCode || 0);
        logger.warn?.('[WebPush] send failed', {
          statusCode: Number.isFinite(statusCode) ? statusCode : 0,
        });
        if (statusCode === 404 || statusCode === 410) {
          try {
            await subscriptionService.retireEndpoint(
              subscription.endpoint,
              statusCode === 410 ? 'push-endpoint-gone' : 'push-endpoint-not-found',
            );
          } catch (retireError) {
            logger.warn?.('[WebPush] endpoint retirement failed', {
              code: String(retireError?.code || 'unexpected'),
            });
          }
        }
      }
    }

    return result;
  };

  const onActivityStarted = async (activity, { senderCanonicalUsername = '' } = {}) => {
    const room = clean(activity?.room);
    const activityType = cleanActivityType(activity?.activityType);
    const activityId = clean(activity?.activityId);
    if (!room || !activityType || !activityId) return { attempted: 0, sent: 0, failed: 0 };

    const senderCanonical = canonicalizeUsername(senderCanonicalUsername);
    const sender = clean(activity?.sender) || 'Someone';
    const subscriptions = await subscriptionService.listRoomSubscriptions(room);
    const result = { attempted: 0, sent: 0, failed: 0 };

    for (const subscription of subscriptions || []) {
      if (senderCanonical && canonicalizeUsername(subscription?.canonicalUsername) === senderCanonical) {
        continue;
      }

      result.attempted += 1;
      const payload = {
        type: 'activity',
        title: `${sender} · ${room}`,
        body: `${buildActivityPreview(activityType)} · Tap to open DizyChat`,
        room,
        messageId: '',
        activityType,
        activityId,
        tag: `dizychat:activity:${room}:${activityType}:${activityId}`,
        url: `/login.html?room=${encodeURIComponent(room)}&activity=${encodeURIComponent(activityType)}`,
      };

      try {
        const response = await transport.send(subscription, payload);
        if (response?.skipped === true) {
          logger.warn?.('[WebPush] transport skipped activity send', {
            reason: String(response.reason || 'skipped'),
          });
          continue;
        }
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        const statusCode = Number(error?.statusCode || 0);
        logger.warn?.('[WebPush] activity send failed', {
          statusCode: Number.isFinite(statusCode) ? statusCode : 0,
        });
        if (statusCode === 404 || statusCode === 410) {
          try {
            await subscriptionService.retireEndpoint(
              subscription.endpoint,
              statusCode === 410 ? 'push-endpoint-gone' : 'push-endpoint-not-found',
            );
          } catch (retireError) {
            logger.warn?.('[WebPush] endpoint retirement failed', {
              code: String(retireError?.code || 'unexpected'),
            });
          }
        }
      }
    }

    return result;
  };

  return { onMessageStored, onActivityStarted };
};

module.exports = {
  createWebPushCoordinator,
  previewMessage,
};
