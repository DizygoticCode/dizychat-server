'use strict';

const crypto = require('crypto');
const { canonicalizeUsername } = require('../auth/identity');

const MAX_ROOMS = 100;
const MAX_LEASE_MS = 90_000;

const serviceError = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const cleanEndpoint = (value) => {
  const endpoint = String(value || '').trim();
  if (!endpoint || endpoint.length > 4096) throw serviceError('WEB_PUSH_ENDPOINT_INVALID');
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:') throw new Error('not https');
  } catch (_error) {
    throw serviceError('WEB_PUSH_ENDPOINT_INVALID');
  }
  return endpoint;
};

const cleanKey = (value, code, maxLength) => {
  const key = String(value || '').trim();
  if (!key || key.length > maxLength) throw serviceError(code);
  return key;
};

const cleanRoom = (value) => {
  const room = String(value || '').trim();
  if (!room || room.length > 80) throw serviceError('ROOM_INVALID');
  return room;
};

const endpointFingerprint = (value) => crypto
  .createHash('sha256')
  .update(String(value || '').trim(), 'utf8')
  .digest('hex')
  .slice(0, 12);

const createWebPushSubscriptionService = ({
  SubscriptionModel,
  UserModel,
  now = () => new Date(),
  logger = console,
} = {}) => {
  if (!SubscriptionModel || !UserModel) {
    throw new TypeError('web push subscription models are required');
  }

  const currentDate = () => {
    const value = now();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('web push clock returned an invalid date');
    return date;
  };

  const assertActiveAccount = async (canonicalUsername) => {
    const canonical = canonicalizeUsername(canonicalUsername);
    if (!canonical) throw serviceError('ACCOUNT_IDENTITY_REQUIRED');
    const account = await UserModel.findOne({ canonicalUsername: canonical, state: 'active' });
    if (!account) throw serviceError('ACCOUNT_INACTIVE');
    return canonical;
  };

  const registerSubscription = async ({
    canonicalUsername,
    subscription,
    deviceLabel = 'Web',
  } = {}) => {
    const canonical = await assertActiveAccount(canonicalUsername);
    const endpoint = cleanEndpoint(subscription?.endpoint);
    const p256dh = cleanKey(subscription?.keys?.p256dh, 'WEB_PUSH_P256DH_INVALID', 512);
    const auth = cleanKey(subscription?.keys?.auth, 'WEB_PUSH_AUTH_INVALID', 256);

    const registered = await SubscriptionModel.findOneAndUpdate(
      { endpoint },
      {
        $setOnInsert: { endpoint },
        $set: {
          canonicalUsername: canonical,
          p256dh,
          auth,
          deviceLabel: String(deviceLabel || 'Web').trim().slice(0, 120) || 'Web',
          disabledAt: null,
          disabledReason: '',
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    logger.info?.('[WebPush] subscription registered', {
      endpointFingerprint: endpointFingerprint(endpoint),
    });
    return registered;
  };

  const findOwned = async ({ canonicalUsername, endpoint } = {}) => {
    const canonical = canonicalizeUsername(canonicalUsername);
    if (!canonical) return null;
    let normalizedEndpoint;
    try {
      normalizedEndpoint = cleanEndpoint(endpoint);
    } catch {
      return null;
    }
    return SubscriptionModel.findOne({
      endpoint: normalizedEndpoint,
      canonicalUsername: canonical,
      disabledAt: null,
    });
  };

  const setRoomSubscription = async ({
    canonicalUsername,
    endpoint,
    room,
    subscribed = true,
  } = {}) => {
    const canonical = await assertActiveAccount(canonicalUsername);
    const normalizedEndpoint = cleanEndpoint(endpoint);
    const normalizedRoom = cleanRoom(room);
    const owned = await findOwned({ canonicalUsername: canonical, endpoint: normalizedEndpoint });
    if (!owned) throw serviceError('WEB_PUSH_SUBSCRIPTION_NOT_FOUND');

    if (subscribed) {
      const rooms = Array.isArray(owned.rooms) ? owned.rooms.map(String) : [];
      if (!rooms.includes(normalizedRoom) && rooms.length >= MAX_ROOMS) {
        throw serviceError('WEB_PUSH_ROOM_LIMIT');
      }
      return SubscriptionModel.updateOne(
        { _id: owned._id, disabledAt: null },
        { $addToSet: { rooms: normalizedRoom } },
      );
    }

    return SubscriptionModel.updateOne(
      { _id: owned._id, disabledAt: null },
      { $pull: { rooms: normalizedRoom } },
    );
  };

  const setPresence = async ({
    canonicalUsername,
    endpoint,
    interactive = false,
    ttlMs = 45_000,
  } = {}) => {
    const canonical = await assertActiveAccount(canonicalUsername);
    const normalizedEndpoint = cleanEndpoint(endpoint);
    const owned = await findOwned({ canonicalUsername: canonical, endpoint: normalizedEndpoint });
    if (!owned) throw serviceError('WEB_PUSH_SUBSCRIPTION_NOT_FOUND');

    const expiresAt = interactive
      ? new Date(currentDate().getTime() + Math.min(Math.max(Number(ttlMs) || 45_000, 5_000), MAX_LEASE_MS))
      : null;

    await SubscriptionModel.updateOne(
      { _id: owned._id, disabledAt: null },
      { $set: { suppressionLeaseExpiresAt: expiresAt } },
    );
    return expiresAt;
  };

  const disableSubscription = async ({
    canonicalUsername,
    endpoint,
    reason = 'signed-out',
  } = {}) => {
    const canonical = canonicalizeUsername(canonicalUsername);
    const normalizedEndpoint = cleanEndpoint(endpoint);
    if (!canonical) return { modifiedCount: 0 };
    return SubscriptionModel.updateOne(
      { canonicalUsername: canonical, endpoint: normalizedEndpoint, disabledAt: null },
      {
        $set: {
          disabledAt: currentDate(),
          disabledReason: String(reason || 'disabled').slice(0, 120),
          suppressionLeaseExpiresAt: null,
        },
      },
    );
  };

  const retireEndpoint = async (endpoint, reason = 'push-endpoint-expired') => {
    const normalizedEndpoint = cleanEndpoint(endpoint);
    return SubscriptionModel.updateOne(
      { endpoint: normalizedEndpoint, disabledAt: null },
      {
        $set: {
          disabledAt: currentDate(),
          disabledReason: String(reason || 'push-endpoint-expired').slice(0, 120),
          suppressionLeaseExpiresAt: null,
        },
      },
    );
  };

  const listRoomSubscriptions = async (room) => {
    const normalizedRoom = cleanRoom(room);
    const current = currentDate();
    const subscriptions = await SubscriptionModel.find({
      rooms: normalizedRoom,
      disabledAt: null,
    });

    const active = [];
    for (const subscription of subscriptions || []) {
      const canonical = canonicalizeUsername(subscription?.canonicalUsername);
      if (!canonical) continue;
      const account = await UserModel.findOne({ canonicalUsername: canonical, state: 'active' });
      if (!account) continue;
      const lease = subscription?.suppressionLeaseExpiresAt
        ? new Date(subscription.suppressionLeaseExpiresAt)
        : null;
      if (lease && !Number.isNaN(lease.getTime()) && lease > current) continue;
      active.push(subscription);
    }
    return active;
  };

  return {
    registerSubscription,
    setRoomSubscription,
    setPresence,
    disableSubscription,
    retireEndpoint,
    listRoomSubscriptions,
  };
};

module.exports = {
  createWebPushSubscriptionService,
  endpointFingerprint,
};
