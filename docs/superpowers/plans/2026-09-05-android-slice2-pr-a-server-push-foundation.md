# Android Slice 2 PR A — Server Push Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the self-hosted server authority for Android push registration, per-device room subscriptions, account-wide read cursors, foreground/screen-on suppression leases, recipient selection, and an FCM transport boundary without changing Android notification UI yet.

**Architecture:** Keep DizyChat authoritative. Extend the existing durable mobile session with a safe server-side session ID, persist push-device/subscription/read state in dedicated Mongo models, decide recipients in a pure policy/service layer, and invoke FCM only through an injected transport after a chat message is already accepted. The sender's authenticated canonical identity is passed separately from the persisted display message so own-account suppression is exact for registered users while guest messages can still notify subscribed accounts.

**Tech Stack:** Node.js 22, Express 4.21.2, Socket.IO 4.8.1, Mongoose 7.8.7, Node test runner, Firebase Admin SDK 14.3.0.

**Spec:** `docs/superpowers/specs/2026-09-05-android-slice2-push-design.md`

## Global Constraints

- Base implementation work from exact green `main` head `1bb08b03ba52015fe4862a812785b4143f270c30` plus the approved design/spec commit only; refresh from current `main` before implementation if `main` has moved.
- FCM is transport only. DizyChat remains authoritative for identity, room membership, subscriptions, read state, notification eligibility, reply authorization, and message storage.
- Never store or send raw mobile-session tokens in push models, FCM payloads, logs, or notification data.
- Chat persistence and Socket.IO publication must not depend on FCM success.
- Push disabled/unconfigured must be a supported normal server state.
- Browser activity alone never suppresses an Android push.
- Suppression is per device and only valid while a short-lived `foreground + screen interactive` lease is fresh.
- Read state is account+room, monotonic, and separate from the existing global `Message.status` field.
- One account may have multiple Android devices with independent room subscriptions.
- Use TDD and make a focused commit after each task.
- Do not hand-edit `package-lock.json`; update it only through `npm install firebase-admin@14.3.0 --save-exact`.

---

## File Structure

**Create**

- `src/models/push-device.js` — one Android installation bound to one durable mobile session and current FCM token.
- `src/models/push-room-subscription.js` — persistent per-device room subscription.
- `src/models/room-read-cursor.js` — monotonic account+room read cursor.
- `src/push/push-device-service.js` — register/rotate/retire devices, subscribe/unsubscribe rooms, query active subscriptions, update suppression leases, and disable revoked sessions.
- `src/push/read-state-service.js` — monotonic read-cursor advance/query operations.
- `src/push/notification-policy.js` — pure recipient eligibility and safe preview construction.
- `src/push/push-coordinator.js` — orchestrate post-persist message push without coupling chat persistence to FCM.
- `src/push/fcm-config.js` — parse enable/project/credential configuration.
- `src/push/transports/fcm-transport.js` — Firebase Admin direct-token transport.
- `src/push/transports/null-transport.js` — disabled/no-op transport.
- `tests/push/mobile-session-id.test.js`
- `tests/push/push-device-service.test.js`
- `tests/push/read-state-service.test.js`
- `tests/push/notification-policy.test.js`
- `tests/push/fcm-transport.test.js`
- `tests/push/push-coordinator.test.js`
- `tests/push/push-http-contract.test.js`
- `tests/push/message-push-integration.test.js`

**Modify**

- `src/auth/mobile-session-service.js` — return stable server-side mobile-session ID from issue/resolve while preserving existing token semantics.
- `index.js` — preserve mobile-session metadata on sockets, wire models/services, authenticated HTTP contracts, successful room join/explicit Leave subscription hooks, read-state endpoint, logout/revocation disablement, and post-persist push dispatch.
- `package.json` / `package-lock.json` — add exact `firebase-admin@14.3.0` dependency.
- `docs/android-private-apk.md` — document server-side FCM configuration names and credential boundary.

---

### Task 1: Expose a Safe Mobile Session Identifier

**Files:**
- Modify: `src/auth/mobile-session-service.js`
- Test: `tests/push/mobile-session-id.test.js`

**Interfaces:**
- Consumes: existing `MobileSessionModel.create/findOne` and current mobile token format.
- Produces: `issue(...).sessionId: string` and `resolve(token).sessionId: string`; no token hash is exposed.

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileSessionService } = require('../../src/auth/mobile-session-service');

test('issue returns the persisted mobile session id without exposing tokenHash', async () => {
  const MobileSessionModel = {
    create: async () => ({ _id: '507f1f77bcf86cd799439011' }),
    findOne: async () => null,
    updateOne: async () => ({ modifiedCount: 0 }),
    updateMany: async () => ({ modifiedCount: 0 }),
  };
  const UserModel = { findOne: async () => null };
  const service = createMobileSessionService({ MobileSessionModel, UserModel, tokenFactory: () => 'abc' });
  const result = await service.issue({
    kind: 'account', userId: 'u1', username: 'Rob', canonicalUsername: 'rob', role: 'user',
  });
  assert.equal(result.sessionId, '507f1f77bcf86cd799439011');
  assert.equal(Object.hasOwn(result, 'tokenHash'), false);
});

test('resolve returns persisted mobile session id', async () => {
  const stored = { _id: '507f1f77bcf86cd799439012', canonicalUsername: 'rob', revokedAt: null };
  const MobileSessionModel = {
    create: async () => stored,
    findOne: async () => stored,
    updateOne: async () => ({ modifiedCount: 0 }),
    updateMany: async () => ({ modifiedCount: 0 }),
  };
  const UserModel = {
    findOne: async () => ({ _id: 'u1', username: 'Rob', canonicalUsername: 'rob', role: 'user', state: 'active' }),
  };
  const service = createMobileSessionService({ MobileSessionModel, UserModel });
  const result = await service.resolve('dcm1.test');
  assert.equal(result.sessionId, '507f1f77bcf86cd799439012');
  assert.equal(result.kind, 'mobile');
  assert.equal(result.principal.canonicalUsername, 'rob');
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/mobile-session-id.test.js
```

Expected: FAIL because `sessionId` is not returned today.

- [ ] **Step 3: Implement the exact return contract**

In `issue()` capture the created document and return explicit existing principal fields:

```js
const stored = await MobileSessionModel.create({
  tokenHash: hashMobileToken(token),
  canonicalUsername,
  userId: String(principal.userId || ''),
  deviceLabel,
  revokedAt: null,
});

return {
  token,
  sessionId: stored?._id ? String(stored._id) : '',
  kind: 'mobile',
  principal: {
    kind: 'account',
    userId: String(principal.userId || ''),
    username: String(principal.username || ''),
    canonicalUsername,
    role: String(principal.role || 'user'),
  },
};
```

In `resolve()` return:

```js
return {
  token,
  sessionId: stored?._id ? String(stored._id) : '',
  kind: 'mobile',
  principal,
};
```

Do not expose `tokenHash`.

- [ ] **Step 4: Run focused and existing auth tests**

```bash
node --test tests/push/mobile-session-id.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/mobile-session-service.js tests/push/mobile-session-id.test.js
git commit -m "refactor: expose safe mobile session id"
```

---

### Task 2: Add Push Device and Room Subscription Persistence

**Files:**
- Create: `src/models/push-device.js`
- Create: `src/models/push-room-subscription.js`
- Create: `src/push/push-device-service.js`
- Test: `tests/push/push-device-service.test.js`

**Interfaces:**
- Consumes: `{ sessionId, principal }` from mobile-session resolution.
- Produces:
  - `registerDevice({ sessionId, canonicalUsername, deviceId, fcmToken, deviceLabel })`
  - `subscribeRoom({ sessionId, canonicalUsername, deviceId, room })`
  - `unsubscribeRoom({ sessionId, deviceId, room })`
  - `findActiveSubscription({ sessionId, deviceId, room })`
  - `renewSuppressionLease({ sessionId, deviceId, ttlMs })`
  - `clearSuppressionLease({ sessionId, deviceId })`
  - `retireToken(fcmToken, reason)`
  - `disableSession(sessionId, reason)`
  - `disableUser(canonicalUsername, reason)`
  - `listRoomDevices(room) -> Array<{ device, subscription }>`

- [ ] **Step 1: Write failing service tests with in-memory model doubles**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushDeviceService } = require('../../src/push/push-device-service');

test('registerDevice binds device to the authenticated mobile session', async () => {
  const calls = [];
  const PushDeviceModel = {
    updateMany: async () => ({ modifiedCount: 0 }),
    findOneAndUpdate: async (filter, update, options) => {
      calls.push({ filter, update, options });
      return { sessionId: 's1', deviceId: 'dev1', fcmToken: 'new-token', canonicalUsername: 'rob' };
    },
  };
  const SubscriptionModel = {
    updateOne: async () => ({}), deleteOne: async () => ({}), deleteMany: async () => ({}), findOne: async () => null,
  };
  const service = createPushDeviceService({ PushDeviceModel, SubscriptionModel, now: () => new Date('2026-09-05T20:00:00Z') });
  const device = await service.registerDevice({ sessionId: 's1', canonicalUsername: 'rob', deviceId: 'dev1', fcmToken: 'new-token', deviceLabel: 'Pixel' });
  assert.equal(device.deviceId, 'dev1');
  assert.equal(calls[0].filter.sessionId, 's1');
  assert.equal(calls[0].filter.deviceId, 'dev1');
});

test('findActiveSubscription cannot cross session/device boundaries', async () => {
  const SubscriptionModel = {
    findOne: async (filter) => filter.sessionId === 's1' && filter.deviceId === 'dev1' && filter.room === 'ShittyChat'
      ? { ...filter, canonicalUsername: 'rob' }
      : null,
  };
  const PushDeviceModel = { findOne: async () => ({ sessionId: 's1', deviceId: 'dev1', disabledAt: null }) };
  const service = createPushDeviceService({ PushDeviceModel, SubscriptionModel });
  assert.ok(await service.findActiveSubscription({ sessionId: 's1', deviceId: 'dev1', room: 'ShittyChat' }));
  assert.equal(await service.findActiveSubscription({ sessionId: 's2', deviceId: 'dev1', room: 'ShittyChat' }), null);
});

test('disableSession disables only that session and deletes its subscriptions', async () => {
  const updates = [];
  const deletes = [];
  const PushDeviceModel = { updateMany: async (filter, update) => { updates.push({ filter, update }); return { modifiedCount: 1 }; } };
  const SubscriptionModel = { deleteMany: async (filter) => { deletes.push(filter); return { deletedCount: 1 }; } };
  const service = createPushDeviceService({ PushDeviceModel, SubscriptionModel, now: () => new Date('2026-09-05T20:00:00Z') });
  await service.disableSession('s1', 'logout');
  assert.deepEqual(updates[0].filter, { sessionId: 's1', disabledAt: null });
  assert.deepEqual(deletes[0], { sessionId: 's1' });
});
```

Add one table test proving two device IDs for `rob` can have different room subscriptions and one unsubscribe does not remove the other.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/push-device-service.test.js
```

Expected: FAIL because models/service do not exist.

- [ ] **Step 3: Create the Mongoose models**

`src/models/push-device.js`:

```js
'use strict';
const mongoose = require('mongoose');

const pushDeviceSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true, trim: true },
  canonicalUsername: { type: String, required: true, index: true, trim: true, lowercase: true },
  deviceId: { type: String, required: true, trim: true, maxlength: 128 },
  fcmToken: { type: String, required: true, trim: true },
  deviceLabel: { type: String, default: 'Android', maxlength: 120 },
  platform: { type: String, enum: ['android'], default: 'android' },
  suppressionLeaseExpiresAt: { type: Date, default: null, index: true },
  tokenRegisteredAt: { type: Date, required: true },
  disabledAt: { type: Date, default: null, index: true },
  disabledReason: { type: String, default: '', maxlength: 120 },
}, { timestamps: true });

pushDeviceSchema.index({ sessionId: 1, deviceId: 1 }, { unique: true });
pushDeviceSchema.index({ fcmToken: 1 }, { unique: true });
module.exports = mongoose.models.PushDevice || mongoose.model('PushDevice', pushDeviceSchema);
```

`src/models/push-room-subscription.js`:

```js
'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true, trim: true },
  deviceId: { type: String, required: true, index: true, trim: true, maxlength: 128 },
  canonicalUsername: { type: String, required: true, index: true, trim: true, lowercase: true },
  room: { type: String, required: true, index: true, trim: true, maxlength: 80 },
}, { timestamps: true });
schema.index({ sessionId: 1, deviceId: 1, room: 1 }, { unique: true });
module.exports = mongoose.models.PushRoomSubscription || mongoose.model('PushRoomSubscription', schema);
```

- [ ] **Step 4: Implement the concrete service methods**

Use these helpers:

```js
const requireString = (value, label, max) => {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new TypeError(`${label} is invalid`);
  return result;
};
const asDate = (value) => value instanceof Date ? new Date(value.getTime()) : new Date(value);
```

`registerDevice()` retires any *other* record holding the incoming token, then upserts the authenticated session/device:

```js
await PushDeviceModel.updateMany(
  { fcmToken, $or: [{ sessionId: { $ne: sessionId } }, { deviceId: { $ne: deviceId } }], disabledAt: null },
  { $set: { disabledAt: current, disabledReason: 'token-rotated' } }
);
return PushDeviceModel.findOneAndUpdate(
  { sessionId, deviceId },
  { $set: { canonicalUsername, fcmToken, deviceLabel, platform: 'android', tokenRegisteredAt: current, disabledAt: null, disabledReason: '' } },
  { upsert: true, new: true, setDefaultsOnInsert: true }
);
```

`subscribeRoom()` first proves the active device exists for the same `sessionId/deviceId`, then upserts:

```js
const device = await PushDeviceModel.findOne({ sessionId, deviceId, disabledAt: null });
if (!device) throw Object.assign(new Error('Push device is not registered'), { code: 'PUSH_DEVICE_NOT_FOUND' });
return SubscriptionModel.updateOne(
  { sessionId, deviceId, room },
  { $set: { canonicalUsername } },
  { upsert: true }
);
```

`unsubscribeRoom()`:

```js
return SubscriptionModel.deleteOne({ sessionId, deviceId, room });
```

`findActiveSubscription()`:

```js
const subscription = await SubscriptionModel.findOne({ sessionId, deviceId, room });
if (!subscription) return null;
const device = await PushDeviceModel.findOne({ sessionId, deviceId, disabledAt: null });
return device ? subscription : null;
```

`renewSuppressionLease()` and `clearSuppressionLease()`:

```js
const expiresAt = new Date(current.getTime() + ttlMs);
await PushDeviceModel.updateOne({ sessionId, deviceId, disabledAt: null }, { $set: { suppressionLeaseExpiresAt: expiresAt } });
await PushDeviceModel.updateOne({ sessionId, deviceId, disabledAt: null }, { $set: { suppressionLeaseExpiresAt: null } });
```

`retireToken()`:

```js
await PushDeviceModel.updateMany(
  { fcmToken, disabledAt: null },
  { $set: { disabledAt: current, disabledReason: reason, suppressionLeaseExpiresAt: null } }
);
```

`disableSession()` and `disableUser()` must both disable device rows and delete their subscriptions with the same scope:

```js
await PushDeviceModel.updateMany({ sessionId, disabledAt: null }, { $set: { disabledAt: current, disabledReason: reason, suppressionLeaseExpiresAt: null } });
await SubscriptionModel.deleteMany({ sessionId });

await PushDeviceModel.updateMany({ canonicalUsername, disabledAt: null }, { $set: { disabledAt: current, disabledReason: reason, suppressionLeaseExpiresAt: null } });
await SubscriptionModel.deleteMany({ canonicalUsername });
```

`listRoomDevices(room)` returns paired active rows, not raw subscriptions:

```js
const subscriptions = await SubscriptionModel.find({ room });
const results = [];
for (const subscription of subscriptions) {
  const device = await PushDeviceModel.findOne({
    sessionId: subscription.sessionId,
    deviceId: subscription.deviceId,
    disabledAt: null,
  });
  if (device) results.push({ device, subscription });
}
return results;
```

Implement with a batched `$or` query if convenient, but preserve this exact output/eligibility contract.

- [ ] **Step 5: Run GREEN**

```bash
node --test tests/push/push-device-service.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/models/push-device.js src/models/push-room-subscription.js src/push/push-device-service.js tests/push/push-device-service.test.js
git commit -m "feat: add push device subscriptions"
```

---

### Task 3: Add Monotonic Account+Room Read Cursors

**Files:**
- Create: `src/models/room-read-cursor.js`
- Create: `src/push/read-state-service.js`
- Test: `tests/push/read-state-service.test.js`

**Interfaces:**
- `getCursor({ canonicalUsername, room }) -> null | { messageId, timestamp }`
- `advanceCursor({ canonicalUsername, room, messageId, timestamp }) -> { advanced, cursor }`
- `isUnread({ canonicalUsername, room, messageId, timestamp }) -> boolean`
- Message IDs must match `/^[a-f0-9]{24}$/i` because the current Message `_id` is Mongo ObjectId.
- Ordering: timestamp first, then lowercase 24-character ObjectId string lexicographically when timestamps are equal.

- [ ] **Step 1: Write RED monotonic-order tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadStateService } = require('../../src/push/read-state-service');

test('advanceCursor rejects malformed message ids', async () => {
  const service = createReadStateService({ RoomReadCursorModel: makeCursorModel(null) });
  await assert.rejects(
    () => service.advanceCursor({ canonicalUsername: 'rob', room: 'ShittyChat', messageId: 'not-an-objectid', timestamp: '2026-09-05T20:00:00Z' }),
    /messageId/i
  );
});

test('advanceCursor cannot move backwards by timestamp', async () => {
  const current = { messageId: 'ffffffffffffffffffffffff', messageTimestamp: new Date('2026-09-05T20:00:05Z') };
  const service = createReadStateService({ RoomReadCursorModel: makeCursorModel(current) });
  const result = await service.advanceCursor({ canonicalUsername: 'rob', room: 'ShittyChat', messageId: '000000000000000000000001', timestamp: '2026-09-05T20:00:04Z' });
  assert.equal(result.advanced, false);
  assert.equal(result.cursor.messageId, current.messageId);
});

test('equal timestamp advances only to greater ObjectId string', async () => {
  const service = createReadStateService({ RoomReadCursorModel: makeCursorModel({ messageId: '000000000000000000000001', messageTimestamp: new Date('2026-09-05T20:00:05Z') }) });
  const result = await service.advanceCursor({ canonicalUsername: 'rob', room: 'ShittyChat', messageId: '000000000000000000000002', timestamp: '2026-09-05T20:00:05Z' });
  assert.equal(result.advanced, true);
});
```

The file defines deterministic `makeCursorModel()` methods for `findOne` and compare-and-swap `findOneAndUpdate`; no live Mongo is required.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/read-state-service.test.js
```

Expected: FAIL.

- [ ] **Step 3: Create model and service**

Model:

```js
const schema = new mongoose.Schema({
  canonicalUsername: { type: String, required: true, index: true, trim: true, lowercase: true },
  room: { type: String, required: true, index: true, trim: true, maxlength: 80 },
  messageId: { type: String, required: true, trim: true, minlength: 24, maxlength: 24, match: /^[a-f0-9]{24}$/i },
  messageTimestamp: { type: Date, required: true, index: true },
}, { timestamps: true });
schema.index({ canonicalUsername: 1, room: 1 }, { unique: true });
```

Ordering helper:

```js
const compareCursor = (a, b) => {
  const at = new Date(a.timestamp ?? a.messageTimestamp).getTime();
  const bt = new Date(b.timestamp ?? b.messageTimestamp).getTime();
  if (at !== bt) return at - bt;
  return String(a.messageId).toLowerCase().localeCompare(String(b.messageId).toLowerCase());
};
```

Use compare-then-CAS semantics: read current, return without mutation when candidate is not greater, otherwise `findOneAndUpdate` with a filter that still matches the observed `messageId/messageTimestamp` (or an upsert when no row exists). If a concurrent writer wins, reload and retry once. Never use an unconditional `$set` that can race the cursor backwards.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/push/read-state-service.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/models/room-read-cursor.js src/push/read-state-service.js tests/push/read-state-service.test.js
git commit -m "feat: add room read cursors"
```

---

### Task 4: Implement Pure Notification Eligibility and Safe Preview Policy

**Files:**
- Create: `src/push/notification-policy.js`
- Test: `tests/push/notification-policy.test.js`

**Interfaces:**
- `isDevicePushEligible({ device, subscription, senderCanonicalUsername, readCursor, message, now })`
- `buildSafePreview(message)`
- `buildPushIntent({ device, message })`

- [ ] **Step 1: Write table-driven RED tests**

```js
const baseDevice = {
  canonicalUsername: 'rob', fcmToken: 'token', disabledAt: null, suppressionLeaseExpiresAt: null,
};
const message = { _id: '507f1f77bcf86cd799439011', room: 'ShittyChat', user: 'Nick', text: 'hello', timestamp: new Date('2026-09-05T20:00:00Z') };

assert.equal(isDevicePushEligible({ device: baseDevice, subscription: { room: 'ShittyChat' }, senderCanonicalUsername: 'nick', readCursor: null, message, now: new Date('2026-09-05T20:00:01Z') }), true);
assert.equal(isDevicePushEligible({ device: baseDevice, subscription: { room: 'ShittyChat' }, senderCanonicalUsername: 'rob', readCursor: null, message, now: new Date('2026-09-05T20:00:01Z') }), false);
assert.equal(isDevicePushEligible({ device: { ...baseDevice, suppressionLeaseExpiresAt: new Date('2026-09-05T20:00:10Z') }, subscription: { room: 'ShittyChat' }, senderCanonicalUsername: 'nick', readCursor: null, message, now: new Date('2026-09-05T20:00:01Z') }), false);
assert.equal(isDevicePushEligible({ device: { ...baseDevice, suppressionLeaseExpiresAt: new Date('2026-09-05T19:59:59Z') }, subscription: { room: 'ShittyChat' }, senderCanonicalUsername: 'nick', readCursor: null, message, now: new Date('2026-09-05T20:00:01Z') }), true);
```

Add tests proving browser presence is not an input, a cleared/expired lease (screen off/background) is eligible, read messages are ineligible, two devices are evaluated independently, and attachment-only previews return exactly `sent an image`, `sent a voice message`, `sent a video`, or `sent a file` without including `fileUrl`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/notification-policy.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement pure policy**

```js
const isLeaseFresh = (device, now) => {
  const expiry = device?.suppressionLeaseExpiresAt ? new Date(device.suppressionLeaseExpiresAt).getTime() : 0;
  return Number.isFinite(expiry) && expiry > new Date(now).getTime();
};

const isDevicePushEligible = ({ device, subscription, senderCanonicalUsername = '', readCursor, message, now = new Date() }) => {
  if (!device || device.disabledAt || !device.fcmToken || !subscription) return false;
  const targetUser = String(device.canonicalUsername || '').trim().toLowerCase();
  const sender = String(senderCanonicalUsername || '').trim().toLowerCase();
  if (sender && targetUser && sender === targetUser) return false;
  if (isLeaseFresh(device, now)) return false;
  if (readCursor && compareMessageToCursor(message, readCursor) <= 0) return false;
  return true;
};
```

Guest messages deliberately pass `senderCanonicalUsername: ''`; the persisted guest display `message.user` must never be guessed into account identity for own-message suppression.

`buildPushIntent()` includes only `room`, `messageId`, `sender`, `preview`, `notificationKey`, `timestamp`; it never copies a session token, FCM token, canonical username, room password, or service credential into the payload intent.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/push/notification-policy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/push/notification-policy.js tests/push/notification-policy.test.js
git commit -m "feat: define push eligibility policy"
```

---

### Task 5: Add an Injected Push Coordinator with Explicit Sender Identity

**Files:**
- Create: `src/push/push-coordinator.js`
- Test: `tests/push/push-coordinator.test.js`

**Interfaces:**
- Consumes: `pushDeviceService.listRoomDevices(room)`, `readStateService.getCursor(...)`, `transport.send(intent, token)`.
- Produces:
  - `onMessageStored(message, { senderCanonicalUsername = '' } = {}) -> Promise<{ attempted, sent, failed }>`
  - `sendRoomClear({ canonicalUsername, room, throughMessageId })` reserved for PR C control-message wiring.

- [ ] **Step 1: Write RED tests with a fake transport**

```js
test('authenticated sender identity suppresses only same-account device', async () => {
  const delivered = [];
  const coordinator = createPushCoordinator({
    pushDeviceService: fakeDevices([
      { canonicalUsername: 'rob', deviceId: 'r1', fcmToken: 'rob-token' },
      { canonicalUsername: 'nick', deviceId: 'n1', fcmToken: 'nick-token' },
    ]),
    readStateService: { getCursor: async () => null },
    transport: { send: async (_intent, token) => delivered.push(token) },
    now: () => new Date('2026-09-05T20:00:00Z'),
  });
  await coordinator.onMessageStored(message, { senderCanonicalUsername: 'rob' });
  assert.deepEqual(delivered, ['nick-token']);
});

test('guest sender has no account canonical identity and may notify subscribed accounts', async () => {
  const delivered = [];
  const coordinator = createPushCoordinator({
    pushDeviceService: fakeDevices([{ canonicalUsername: 'rob', deviceId: 'r1', fcmToken: 'rob-token' }]),
    readStateService: { getCursor: async () => null },
    transport: { send: async (_intent, token) => delivered.push(token) },
  });
  await coordinator.onMessageStored({ ...message, user: 'Guest-abcd' }, { senderCanonicalUsername: '' });
  assert.deepEqual(delivered, ['rob-token']);
});

test('permanent token failure retires only that token', async () => {
  const retired = [];
  const transport = { send: async () => { const error = new Error('gone'); error.code = 'messaging/registration-token-not-registered'; error.permanent = true; throw error; } };
  const coordinator = createPushCoordinator({
    pushDeviceService: { ...fakeDevices([{ canonicalUsername: 'nick', deviceId: 'n1', fcmToken: 'bad-token' }]), retireToken: async (token, reason) => retired.push({ token, reason }) },
    readStateService: { getCursor: async () => null }, transport,
  });
  const result = await coordinator.onMessageStored(message, { senderCanonicalUsername: 'rob' });
  assert.equal(result.failed, 1);
  assert.equal(retired[0].token, 'bad-token');
});
```

Add a test where one account has two devices and only the fresh-lease device is suppressed.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/push-coordinator.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement coordinator without identity guessing**

```js
const createPushCoordinator = ({ pushDeviceService, readStateService, transport, now = () => new Date(), logger = console }) => {
  const onMessageStored = async (message, { senderCanonicalUsername = '' } = {}) => {
    const candidates = await pushDeviceService.listRoomDevices(message.room);
    let attempted = 0;
    let sent = 0;
    let failed = 0;
    await Promise.all(candidates.map(async ({ device, subscription }) => {
      const readCursor = await readStateService.getCursor({ canonicalUsername: device.canonicalUsername, room: message.room });
      if (!isDevicePushEligible({ device, subscription, senderCanonicalUsername, readCursor, message, now: now() })) return;
      attempted += 1;
      try {
        await transport.send(buildPushIntent({ device, message }), device.fcmToken);
        sent += 1;
      } catch (error) {
        failed += 1;
        if (error?.permanent) await pushDeviceService.retireToken(device.fcmToken, error.code || 'permanent-fcm-error');
        logger.warn?.('[Push] delivery failed', { code: error?.code || 'unknown', permanent: Boolean(error?.permanent) });
      }
    }));
    return { attempted, sent, failed };
  };

  const sendRoomClear = async () => ({ attempted: 0, sent: 0, failed: 0 });
  return { onMessageStored, sendRoomClear };
};
```

Do not log FCM tokens.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/push/push-coordinator.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/push/push-coordinator.js tests/push/push-coordinator.test.js
git commit -m "feat: add push coordinator"
```

---

### Task 6: Add FCM Transport and Disabled Configuration Boundary

**Files:**
- Create: `src/push/fcm-config.js`
- Create: `src/push/transports/fcm-transport.js`
- Create: `src/push/transports/null-transport.js`
- Modify: `package.json`
- Modify: `package-lock.json` through npm only
- Test: `tests/push/fcm-transport.test.js`
- Modify: `docs/android-private-apk.md`

**Interfaces:**
- `readFcmConfig(env) -> { enabled, projectId }`
- `createFcmTransport({ config, messagingFactory }) -> { send(intent, token), sendControl(data, token) }`
- `createNullTransport() -> same interface, resolves without network`

- [ ] **Step 1: Install the exact server dependency**

```bash
npm install firebase-admin@14.3.0 --save-exact
```

Expected: dependency changes are npm-managed in `package.json` and `package-lock.json` only.

- [ ] **Step 2: Write RED tests**

```js
test('FCM transport maps invalid-token error as permanent', async () => {
  const messaging = { send: async () => { const error = new Error('gone'); error.code = 'messaging/registration-token-not-registered'; throw error; } };
  const transport = createFcmTransport({ config: { enabled: true, projectId: 'dizychat' }, messagingFactory: () => messaging });
  await assert.rejects(
    () => transport.send({ room: 'ShittyChat', messageId: '507f1f77bcf86cd799439011', sender: 'Nick', preview: 'yo', notificationKey: 'room-key', timestamp: '2026-09-05T20:00:00Z' }, 'token'),
    (error) => error.permanent === true
  );
});

test('push payload cannot contain auth or service credentials', async () => {
  let captured;
  const messaging = { send: async (payload) => { captured = payload; return 'ok'; } };
  const transport = createFcmTransport({ config: { enabled: true, projectId: 'dizychat' }, messagingFactory: () => messaging });
  await transport.send({ room: 'ShittyChat', messageId: '507f1f77bcf86cd799439011', sender: 'Nick', preview: 'yo', notificationKey: 'room-key', timestamp: '2026-09-05T20:00:00Z' }, 'token');
  const serialized = JSON.stringify(captured);
  for (const forbidden of ['sessionToken', 'private_key', 'roomPassword', 'canonicalUsername']) assert.equal(serialized.includes(forbidden), false);
});
```

- [ ] **Step 3: Run RED**

```bash
node --test tests/push/fcm-transport.test.js
```

Expected: FAIL.

- [ ] **Step 4: Implement configuration and transport**

Configuration:

```js
const readFcmConfig = (env = process.env) => ({
  enabled: ['1', 'true', 'yes', 'on'].includes(String(env.DIZYCHAT_FCM_ENABLED || '').trim().toLowerCase()),
  projectId: String(env.DIZYCHAT_FIREBASE_PROJECT_ID || '').trim(),
});
```

Production credential contract:

```text
DIZYCHAT_FCM_ENABLED=true
DIZYCHAT_FIREBASE_PROJECT_ID=<firebase project id>
GOOGLE_APPLICATION_CREDENTIALS=/etc/dizychat/firebase-service-account.json
```

Initialize Firebase Admin through application-default credentials:

```js
const { applicationDefault, initializeApp, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: config.projectId });
const messaging = getMessaging(app);
```

The credential JSON stays on the self-hosted server with restrictive permissions and is never copied into the repo or APK.

- [ ] **Step 5: Run GREEN and lockfile reproducibility**

```bash
node --test tests/push/fcm-transport.test.js
npm test
npm ci --ignore-scripts
```

Expected: PASS.

- [ ] **Step 6: Document the external credential boundary**

Append to `docs/android-private-apk.md`:

```text
Firebase service-account credentials exist only on the self-hosted DizyChat server. They are never committed, placed in Android public assets, or packaged in the APK. The server reads DIZYCHAT_FCM_ENABLED, DIZYCHAT_FIREBASE_PROJECT_ID, and GOOGLE_APPLICATION_CREDENTIALS.
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/push/fcm-config.js src/push/transports/fcm-transport.js src/push/transports/null-transport.js tests/push/fcm-transport.test.js docs/android-private-apk.md
git commit -m "feat: add server FCM transport"
```

---

### Task 7: Wire Mobile Session Metadata, Push HTTP Contracts, Room Subscription Hooks, and Revocation

**Files:**
- Modify: `index.js`
- Test: `tests/push/push-http-contract.test.js`

**Interfaces:**
- Socket fields after auth:
  - `socket.principal`
  - `socket.accountSessionToken`
  - `socket.mobileSessionId` — non-empty only for valid mobile session.
  - `socket.mobileDeviceId` — set from validated native join payload when that device belongs to the authenticated mobile session.
- `POST /api/mobile/push/register` — mobile session only; body `{ deviceId, fcmToken, deviceLabel }`.
- `POST /api/mobile/push/presence` — mobile session only; body `{ deviceId, interactive, ttlMs }`.
- `POST /api/read-state/mark` — authenticated account; body `{ room, messageId }`.
- `GET /api/read-state?room=<room>` — authenticated account.

- [ ] **Step 1: Write RED socket/auth/HTTP tests**

Tests must prove:

```js
assert.equal((await post('/api/mobile/push/register', {}, null)).status, 401);
assert.equal((await post('/api/mobile/push/register', { deviceId: 'd1', fcmToken: 't1' }, browserToken)).status, 403);
assert.equal((await post('/api/mobile/push/register', { deviceId: 'd1', fcmToken: 't1' }, mobileToken)).status, 200);
assert.equal((await post('/api/mobile/push/presence', { deviceId: 'd1', interactive: false }, mobileToken)).status, 200);
```

Also prove:
- mobile handshake/account-session refresh preserves `mobileSessionId`;
- browser handshake leaves `mobileSessionId === ''`;
- native accepted join stores `socket.mobileDeviceId` and subscribes exactly once;
- rejected room password never subscribes;
- explicit Leave unsubscribes only that `sessionId/deviceId/room`;
- disconnect does not unsubscribe;
- logout disables that mobile session's push rows/subscriptions;
- user-wide mobile-session revocation disables that user's push rows/subscriptions;
- `/api/read-state/mark` rejects a message not belonging to the requested room;
- presence `ttlMs` is capped by the server.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/push-http-contract.test.js
```

Expected: FAIL.

- [ ] **Step 3: Preserve mobile session metadata in the existing socket auth seams**

In `io.use` initialize and set:

```js
socket.principal = null;
socket.accountSessionToken = '';
socket.mobileSessionId = '';
const session = await resolveAccountSessionToken(sessionToken);
if (session) {
  socket.principal = session.principal;
  socket.accountSessionToken = session.token;
  socket.mobileSessionId = session.kind === 'mobile' ? String(session.sessionId || '') : '';
}
```

In successful `account login` and `account session` handlers repeat the same assignment from the newly issued/resolved session. When session resolution fails or logout completes, clear `socket.mobileSessionId` and `socket.mobileDeviceId` as well as principal/token.

Do not include `sessionId` in the client-facing auth ack.

- [ ] **Step 4: Add HTTP auth helpers**

```js
const readBearerToken = (req) => {
  const raw = String(req.headers.authorization || '').trim();
  return raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : '';
};

const requireHttpAccount = async (req, res) => {
  const session = await resolveAccountSessionToken(readBearerToken(req));
  if (!session?.principal) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  return session;
};

const requireHttpMobileAccount = async (req, res) => {
  const session = await requireHttpAccount(req, res);
  if (!session) return null;
  if (session.kind !== 'mobile' || !session.sessionId) {
    res.status(403).json({ error: 'Android mobile session required' });
    return null;
  }
  return session;
};
```

- [ ] **Step 5: Add register/presence/read endpoints**

Presence cap:

```js
const PRESENCE_LEASE_MAX_MS = 90_000;
const requested = Number(req.body?.ttlMs || 45_000);
const ttlMs = Math.min(Math.max(Number.isFinite(requested) ? requested : 45_000, 5_000), PRESENCE_LEASE_MAX_MS);
```

For read mark, validate `messageId` as ObjectId, load `Message.findById(messageId)`, require `msg.room === room`, then call `advanceCursor()` with the persisted message timestamp. Never trust a client-supplied timestamp.

- [ ] **Step 6: Extend current `join room`/`leave room` payloads without breaking browsers**

Change join handler signature from destructuring to payload normalization:

```js
socket.on('join room', async (payload = {}) => {
  const { room, username, password } = payload;
  const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim().slice(0, 128) : '';
```

Run the entire existing password/account/ban admission flow unchanged. Only after admission succeeds and the socket has joined the room:

```js
if (socket.mobileSessionId && deviceId && socket.principal?.kind === 'account') {
  const device = await pushDeviceService.findRegisteredDevice({ sessionId: socket.mobileSessionId, deviceId });
  if (device) {
    socket.mobileDeviceId = deviceId;
    await pushDeviceService.subscribeRoom({
      sessionId: socket.mobileSessionId,
      canonicalUsername: socket.principal.canonicalUsername,
      deviceId,
      room: roomName,
    });
  }
}
```

Add `findRegisteredDevice({ sessionId, deviceId })` to `push-device-service.js` in Task 2 if the join hook needs this explicit proof; it queries `{ sessionId, deviceId, disabledAt: null }` and returns the row or null.

Normalize current Leave handler so legacy browser `{ room }` and native `{ room, deviceId }` both work:

```js
socket.on('leave room', async (payload = {}) => {
  const room = typeof payload === 'string' ? payload : payload.room;
  const deviceId = typeof payload === 'object' && payload ? String(payload.deviceId || '').trim() : '';
  const target = normaliseRoomName(room) || socket.currentRoom;
  if (!target) return;
  if (socket.mobileSessionId && deviceId && deviceId === socket.mobileDeviceId) {
    await pushDeviceService.unsubscribeRoom({ sessionId: socket.mobileSessionId, deviceId, room: target });
  }
  removeSocketFromRoom(socket, target);
  emitRoomListUpdate();
});
```

Do not unsubscribe in `disconnect`.

- [ ] **Step 7: Disable push state on real mobile-session revocation paths**

Wrap token revocation so the mobile session ID is known before revoking, then disable its push state after successful revoke:

```js
const revokeMobileSessionAndPush = async (token, reason = 'revoked') => {
  const resolved = await mobileAccountSessions.resolve(token);
  const revoked = await mobileAccountSessions.revoke(token);
  if (revoked && resolved?.sessionId) await pushDeviceService.disableSession(resolved.sessionId, reason);
  return revoked;
};
```

Use it from `revokeAccountSessionToken()` for mobile tokens and the existing `account logout` flow. Wherever account-wide mobile sessions are revoked (managed-user disable/state change/revoke-user path), call both:

```js
await mobileAccountSessions.revokeUser(canonicalUsername);
await pushDeviceService.disableUser(canonicalUsername, 'account-revoked');
```

The tests must prove browser-session revocation does not accidentally disable unrelated Android sessions.

- [ ] **Step 8: Run GREEN**

```bash
node --test tests/push/push-http-contract.test.js tests/push/push-device-service.test.js tests/push/read-state-service.test.js
npm test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add index.js src/push/push-device-service.js tests/push/push-http-contract.test.js tests/push/push-device-service.test.js
git commit -m "feat: expose authenticated push state contracts"
```

---

### Task 8: Dispatch Push Only After Message Persistence with Exact Sender Identity

**Files:**
- Modify: `index.js`
- Test: `tests/push/message-push-integration.test.js`

**Interfaces:**
- Existing `chat message` storage/publication remains authoritative.
- Call: `pushCoordinator.onMessageStored(storedMessage, { senderCanonicalUsername })` after persistence/publication.
- Registered sender uses `socket.principal.canonicalUsername`; guest sender passes `''`.

- [ ] **Step 1: Write RED integration tests**

```js
test('FCM rejection cannot reject or duplicate accepted chat message', async () => {
  const pushCoordinator = { onMessageStored: async () => { throw new Error('FCM down'); } };
  const result = await exerciseChatMessagePath({ pushCoordinator, principal: { kind: 'account', canonicalUsername: 'rob', username: 'Rob' }, text: 'hello' });
  assert.equal(result.persistedCount, 1);
  assert.equal(result.socketPublishedCount, 1);
});

test('registered sender canonical identity is passed explicitly', async () => {
  const calls = [];
  const pushCoordinator = { onMessageStored: async (message, meta) => calls.push({ message, meta }) };
  await exerciseChatMessagePath({ pushCoordinator, principal: { kind: 'account', canonicalUsername: 'rob', username: 'Rob' }, text: 'hello' });
  assert.equal(calls[0].meta.senderCanonicalUsername, 'rob');
});

test('guest sender passes empty canonical account identity', async () => {
  const calls = [];
  const pushCoordinator = { onMessageStored: async (message, meta) => calls.push({ message, meta }) };
  await exerciseChatMessagePath({ pushCoordinator, principal: { kind: 'guest', canonicalUsername: 'guest-abcd', username: 'Guest-abcd' }, text: 'hello' });
  assert.equal(calls[0].meta.senderCanonicalUsername, '');
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/message-push-integration.test.js
```

Expected: FAIL until the message path has an injectable/coordinator seam.

- [ ] **Step 3: Wire fire-and-forget dispatch after accepted message storage/publication**

At the existing successful `chat message` boundary, after `await newMsg.save()` and normal Socket.IO publication/delivery-status work:

```js
const storedMessage = toPlainMessage(newMsg);
const senderCanonicalUsername = socket.principal?.kind === 'account'
  ? String(socket.principal.canonicalUsername || '')
  : '';

void pushCoordinator.onMessageStored(storedMessage, { senderCanonicalUsername }).catch((error) => {
  console.warn('[Push] post-message dispatch failed', { code: error?.code || 'unexpected' });
});
```

Do not derive account identity from `newMsg.user`. Do not `await` FCM before accepting/publishing the chat message.

- [ ] **Step 4: Run GREEN and full deterministic suite**

```bash
node --test tests/push/message-push-integration.test.js tests/push/push-coordinator.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.js tests/push/message-push-integration.test.js
git commit -m "feat: dispatch push after stored messages"
```

---

### Task 9: Exact-Head PR A Gate

**Files:** No feature changes unless a failing gate proves a defect.

- [ ] **Step 1: Verify dependency tree and deterministic tests**

```bash
npm ci
npm test
```

Expected: PASS.

- [ ] **Step 2: Verify Android packaging remains valid with push unconfigured**

```bash
npm run android:prepare
npx cap sync android
cd android
./gradlew assembleDebug --no-daemon
```

Expected: debug APK builds successfully without server Firebase credentials. PR B handles Android Firebase client configuration.

- [ ] **Step 3: Secret/payload scan**

```bash
git grep -nE 'BEGIN PRIVATE KEY|private_key_id|dcm1\.[A-Za-z0-9_-]{8,}|mongodb(\+srv)?://[^[:space:]]+:[^[:space:]]+@' -- ':!docs/superpowers/**'
```

Expected: no committed credential material or hard-coded mobile token. Environment variable names are allowed; credential values are not.

- [ ] **Step 4: Confirm exact head and diff scope**

```bash
git rev-parse HEAD
git diff --stat origin/main...HEAD
git status --short
```

Expected: clean working tree; diff contains only PR A server foundation, tests, npm-managed dependency update, and docs.

- [ ] **Step 5: Push/open draft PR and require CI on exact final SHA**

Use the connected GitHub app for PR operations. Record the exact head SHA in the PR body. If any later commit moves the head, require the new exact head to pass the full gate again before merge consideration.

---

## PR A Acceptance Boundary

PR A is complete only when the exact final head proves all of the following:

- mobile session IDs are available server-side without leaking token hashes;
- sockets preserve whether an authenticated session is mobile and its safe session ID;
- push devices are session-bound and token rotation is deterministic;
- active subscription lookups are scoped to the same session/device/room;
- room subscriptions are created only after successful room admission;
- explicit Leave removes only that device subscription; disconnect/background does not;
- logout/mobile-session revocation disables that session's push state; account-wide revoke disables that account's mobile push state;
- read cursors are account+room, ObjectId-valid, and monotonic;
- fresh foreground+interactive lease suppresses only that device; stale/cleared lease remains eligible;
- registered own-account messages are excluded using explicit authenticated canonical identity; guest display names are never guessed into account identity;
- FCM credentials are external to Git/APK;
- permanent token failures retire only the bad registration;
- temporary transport failures preserve state;
- chat storage/publication works identically with FCM disabled or failing;
- `npm test`, Capacitor sync, and Android debug build pass on the exact final head.
