'use strict';

const {
  buildPushIntent,
  isDevicePushEligible,
} = require('./notification-policy');

const createPushCoordinator = ({
  pushDeviceService,
  readStateService,
  transport,
  logger = console,
  now = () => new Date(),
} = {}) => {
  if (!pushDeviceService || !readStateService || !transport || typeof transport.send !== 'function') {
    throw new TypeError('push coordinator dependencies are required');
  }

  const onMessageStored = async (message, { senderCanonicalUsername = '' } = {}) => {
    const room = String(message?.room || '').trim();
    if (!room) return { attempted: 0, sent: 0, failed: 0 };

    const candidates = await pushDeviceService.listRoomDevices(room);
    const result = { attempted: 0, sent: 0, failed: 0 };

    for (const candidate of candidates || []) {
      const device = candidate?.device;
      const subscription = candidate?.subscription;
      if (!device || !subscription) continue;

      let readCursor = null;
      try {
        readCursor = await readStateService.getCursor({
          canonicalUsername: device.canonicalUsername,
          room,
        });
      } catch (error) {
        logger.warn?.('[Push] read cursor lookup failed', {
          code: String(error?.code || 'unexpected'),
        });
        continue;
      }

      if (!isDevicePushEligible({
        device,
        subscription,
        senderCanonicalUsername,
        readCursor,
        message,
        now: now(),
      })) continue;

      const intent = buildPushIntent({ device, message });
      result.attempted += 1;

      try {
        await transport.send(intent, String(device.fcmToken || ''));
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        const code = String(error?.code || 'unexpected');
        const permanent = error?.permanent === true;
        logger.warn?.('[Push] transport send failed', { code, permanent });
        if (permanent) {
          try {
            await pushDeviceService.retireToken(
              String(device.fcmToken || ''),
              code || 'permanent-error',
            );
          } catch (retireError) {
            logger.warn?.('[Push] token retirement failed', {
              code: String(retireError?.code || 'unexpected'),
            });
          }
        }
      }
    }

    return result;
  };

  const sendRoomClear = async () => ({ attempted: 0, sent: 0, failed: 0 });

  return {
    onMessageStored,
    sendRoomClear,
  };
};

module.exports = {
  createPushCoordinator,
};
