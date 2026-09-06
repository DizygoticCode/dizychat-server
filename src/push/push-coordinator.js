'use strict';

const {
  buildPushIntent,
  buildReadControlIntent,
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

  const sendToDevice = async (intent, device, result) => {
    const token = String(device?.fcmToken || '');
    result.attempted += 1;
    try {
      await transport.send(intent, token);
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      const code = String(error?.code || 'unexpected');
      const permanent = error?.permanent === true;
      logger.warn?.('[Push] transport send failed', { code, permanent });
      if (permanent) {
        try {
          await pushDeviceService.retireToken(token, code || 'permanent-error');
        } catch (retireError) {
          logger.warn?.('[Push] token retirement failed', {
            code: String(retireError?.code || 'unexpected'),
          });
        }
      }
    }
  };

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
      await sendToDevice(intent, device, result);
    }

    return result;
  };

  const sendRoomClear = async ({ canonicalUsername, room, cursor } = {}) => {
    const normalizedRoom = String(room || '').trim();
    if (!normalizedRoom || !cursor) return { attempted: 0, sent: 0, failed: 0 };

    const devices = await pushDeviceService.listAccountDevices(canonicalUsername);
    const result = { attempted: 0, sent: 0, failed: 0 };

    for (const device of devices || []) {
      if (!device || device.disabledAt != null || !String(device.fcmToken || '').trim()) continue;
      const intent = buildReadControlIntent({ device, room: normalizedRoom, cursor });
      await sendToDevice(intent, device, result);
    }

    return result;
  };

  return {
    onMessageStored,
    sendRoomClear,
  };
};

module.exports = {
  createPushCoordinator,
};
