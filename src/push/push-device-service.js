'use strict';

const { canonicalizeUsername } = require('../auth/identity');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const serviceError = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const cleanSessionId = (value) => {
  const sessionId = String(value || '').trim();
  if (!OBJECT_ID_PATTERN.test(sessionId)) throw serviceError('MOBILE_SESSION_INVALID');
  return sessionId;
};

const cleanDeviceId = (value) => {
  const deviceId = String(value || '').trim();
  if (!deviceId || deviceId.length > 128) throw serviceError('DEVICE_ID_INVALID');
  return deviceId;
};

const cleanRoom = (value) => {
  const room = String(value || '').trim();
  if (!room || room.length > 80) throw serviceError('ROOM_INVALID');
  return room;
};

const createPushDeviceService = ({
  PushDeviceModel,
  SubscriptionModel,
  MobileSessionModel,
  UserModel,
  now = () => new Date(),
} = {}) => {
  if (!PushDeviceModel || !SubscriptionModel || !MobileSessionModel || !UserModel) {
    throw new TypeError('push device models are required');
  }

  const currentDate = () => {
    const value = now();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('push device clock returned an invalid date');
    return date;
  };

  const assertActiveSessionAccount = async ({ sessionId, canonicalUsername }) => {
    const normalizedSessionId = cleanSessionId(sessionId);
    const canonical = canonicalizeUsername(canonicalUsername);
    if (!canonical) throw serviceError('DEVICE_ACCOUNT_MISMATCH');

    const session = await MobileSessionModel.findOne({
      _id: normalizedSessionId,
      canonicalUsername: canonical,
      revokedAt: null,
    });
    if (!session) throw serviceError('MOBILE_SESSION_INVALID');

    const account = await UserModel.findOne({ canonicalUsername: canonical, state: 'active' });
    if (!account) throw serviceError('ACCOUNT_INACTIVE');

    return { session, account, canonicalUsername: canonical };
  };

  const isStillActive = async (device) => {
    if (!device || device.disabledAt != null) return false;
    const sessionId = String(device.sessionId || '');
    const canonicalUsername = canonicalizeUsername(device.canonicalUsername);
    if (!OBJECT_ID_PATTERN.test(sessionId) || !canonicalUsername) return false;

    const session = await MobileSessionModel.findOne({
      _id: sessionId,
      canonicalUsername,
      revokedAt: null,
    });
    if (!session) return false;

    const account = await UserModel.findOne({ canonicalUsername, state: 'active' });
    return Boolean(account);
  };

  const registerDevice = async ({
    sessionId,
    canonicalUsername,
    deviceId,
    fcmToken,
    deviceLabel = 'Android',
  } = {}) => {
    const normalizedSessionId = cleanSessionId(sessionId);
    const canonical = canonicalizeUsername(canonicalUsername);
    const normalizedDeviceId = cleanDeviceId(deviceId);
    const token = String(fcmToken || '').trim();
    if (!token) throw serviceError('FCM_TOKEN_INVALID');

    await assertActiveSessionAccount({ sessionId: normalizedSessionId, canonicalUsername: canonical });

    const registeredAt = currentDate();
    await PushDeviceModel.updateMany(
      { fcmToken: token, disabledAt: null },
      {
        $set: {
          disabledAt: registeredAt,
          disabledReason: 'token-rotated',
          suppressionLeaseExpiresAt: null,
        },
      },
    );

    return PushDeviceModel.findOneAndUpdate(
      { sessionId: normalizedSessionId, deviceId: normalizedDeviceId },
      {
        $setOnInsert: {
          sessionId: normalizedSessionId,
          deviceId: normalizedDeviceId,
        },
        $set: {
          canonicalUsername: canonical,
          fcmToken: token,
          deviceLabel: String(deviceLabel || 'Android').trim().slice(0, 120) || 'Android',
          platform: 'android',
          tokenRegisteredAt: registeredAt,
          disabledAt: null,
          disabledReason: '',
          suppressionLeaseExpiresAt: null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  };

  const findRegisteredDevice = async ({ sessionId, deviceId } = {}) => {
    let normalizedSessionId;
    let normalizedDeviceId;
    try {
      normalizedSessionId = cleanSessionId(sessionId);
      normalizedDeviceId = cleanDeviceId(deviceId);
    } catch {
      return null;
    }

    const device = await PushDeviceModel.findOne({
      sessionId: normalizedSessionId,
      deviceId: normalizedDeviceId,
      disabledAt: null,
    });
    if (!device || !(await isStillActive(device))) return null;
    return device;
  };

  const subscribeRoom = async ({ sessionId, canonicalUsername, deviceId, room } = {}) => {
    const normalizedSessionId = cleanSessionId(sessionId);
    const canonical = canonicalizeUsername(canonicalUsername);
    const normalizedDeviceId = cleanDeviceId(deviceId);
    const normalizedRoom = cleanRoom(room);

    await assertActiveSessionAccount({ sessionId: normalizedSessionId, canonicalUsername: canonical });
    const device = await PushDeviceModel.findOne({
      sessionId: normalizedSessionId,
      deviceId: normalizedDeviceId,
      disabledAt: null,
    });
    if (!device) throw serviceError('DEVICE_NOT_REGISTERED');
    if (canonicalizeUsername(device.canonicalUsername) !== canonical) {
      throw serviceError('DEVICE_ACCOUNT_MISMATCH');
    }
    if (!(await isStillActive(device))) throw serviceError('DEVICE_NOT_REGISTERED');

    return SubscriptionModel.findOneAndUpdate(
      { sessionId: normalizedSessionId, deviceId: normalizedDeviceId, room: normalizedRoom },
      {
        $setOnInsert: {
          sessionId: normalizedSessionId,
          deviceId: normalizedDeviceId,
          room: normalizedRoom,
        },
        $set: { canonicalUsername: canonical },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  };

  const unsubscribeRoom = async ({ sessionId, deviceId, room } = {}) => {
    const normalizedSessionId = cleanSessionId(sessionId);
    const normalizedDeviceId = cleanDeviceId(deviceId);
    const normalizedRoom = cleanRoom(room);
    return SubscriptionModel.deleteOne({
      sessionId: normalizedSessionId,
      deviceId: normalizedDeviceId,
      room: normalizedRoom,
    });
  };

  const findActiveSubscription = async ({ sessionId, deviceId, room } = {}) => {
    let normalizedSessionId;
    let normalizedDeviceId;
    let normalizedRoom;
    try {
      normalizedSessionId = cleanSessionId(sessionId);
      normalizedDeviceId = cleanDeviceId(deviceId);
      normalizedRoom = cleanRoom(room);
    } catch {
      return null;
    }

    const subscription = await SubscriptionModel.findOne({
      sessionId: normalizedSessionId,
      deviceId: normalizedDeviceId,
      room: normalizedRoom,
    });
    if (!subscription) return null;

    const device = await findRegisteredDevice({
      sessionId: normalizedSessionId,
      deviceId: normalizedDeviceId,
    });
    if (!device) return null;
    if (canonicalizeUsername(device.canonicalUsername) !== canonicalizeUsername(subscription.canonicalUsername)) {
      return null;
    }
    return subscription;
  };

  const renewSuppressionLease = async ({ sessionId, deviceId, ttlMs } = {}) => {
    const device = await findRegisteredDevice({ sessionId, deviceId });
    if (!device) throw serviceError('DEVICE_NOT_REGISTERED');
    const ttl = Number(ttlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) throw serviceError('LEASE_TTL_INVALID');
    const expiresAt = new Date(currentDate().getTime() + ttl);
    await PushDeviceModel.updateOne(
      { sessionId: String(device.sessionId), deviceId: String(device.deviceId), disabledAt: null },
      { $set: { suppressionLeaseExpiresAt: expiresAt } },
    );
    return expiresAt;
  };

  const clearSuppressionLease = async ({ sessionId, deviceId } = {}) => {
    const normalizedSessionId = cleanSessionId(sessionId);
    const normalizedDeviceId = cleanDeviceId(deviceId);
    return PushDeviceModel.updateOne(
      { sessionId: normalizedSessionId, deviceId: normalizedDeviceId, disabledAt: null },
      { $set: { suppressionLeaseExpiresAt: null } },
    );
  };

  const retireToken = async (fcmToken, reason = 'invalid-token') => {
    const token = String(fcmToken || '').trim();
    if (!token) return { modifiedCount: 0 };
    return PushDeviceModel.updateMany(
      { fcmToken: token, disabledAt: null },
      {
        $set: {
          disabledAt: currentDate(),
          disabledReason: String(reason || 'invalid-token').slice(0, 120),
          suppressionLeaseExpiresAt: null,
        },
      },
    );
  };

  const disableSession = async (sessionId, reason = 'session-revoked') => {
    const normalizedSessionId = cleanSessionId(sessionId);
    const disabledAt = currentDate();
    const devices = await PushDeviceModel.updateMany(
      { sessionId: normalizedSessionId, disabledAt: null },
      {
        $set: {
          disabledAt,
          disabledReason: String(reason || 'session-revoked').slice(0, 120),
          suppressionLeaseExpiresAt: null,
        },
      },
    );
    await SubscriptionModel.deleteMany({ sessionId: normalizedSessionId });
    return devices;
  };

  const disableUser = async (username, reason = 'account-revoked') => {
    const canonicalUsername = canonicalizeUsername(username);
    if (!canonicalUsername) return { modifiedCount: 0 };
    const devices = await PushDeviceModel.updateMany(
      { canonicalUsername, disabledAt: null },
      {
        $set: {
          disabledAt: currentDate(),
          disabledReason: String(reason || 'account-revoked').slice(0, 120),
          suppressionLeaseExpiresAt: null,
        },
      },
    );
    await SubscriptionModel.deleteMany({ canonicalUsername });
    return devices;
  };

  const listRoomDevices = async (room) => {
    const normalizedRoom = cleanRoom(room);
    const subscriptions = await SubscriptionModel.find({ room: normalizedRoom });
    const candidates = [];
    for (const subscription of subscriptions || []) {
      const device = await PushDeviceModel.findOne({
        sessionId: String(subscription.sessionId || ''),
        deviceId: String(subscription.deviceId || ''),
        disabledAt: null,
      });
      if (!device || !(await isStillActive(device))) continue;
      if (canonicalizeUsername(device.canonicalUsername) !== canonicalizeUsername(subscription.canonicalUsername)) continue;
      candidates.push({ device, subscription });
    }
    return candidates;
  };

  return {
    registerDevice,
    findRegisteredDevice,
    subscribeRoom,
    unsubscribeRoom,
    findActiveSubscription,
    renewSuppressionLease,
    clearSuppressionLease,
    retireToken,
    disableSession,
    disableUser,
    listRoomDevices,
  };
};

module.exports = {
  createPushDeviceService,
};
