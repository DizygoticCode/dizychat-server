# Android Slice 2 PR A — Server Push Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the self-hosted server authority for Android push registration, per-device room subscriptions, account-wide read cursors, foreground/screen-on suppression leases, recipient selection, and an FCM transport boundary without changing Android UI behaviour yet.

**Architecture:** Keep DizyChat authoritative. Extend the existing durable mobile session with a safe session identifier, store push-device/subscription/read state in dedicated Mongo models, decide recipients in a pure policy/service layer, and invoke FCM only through an injected transport after a chat message has already been accepted. PR A exposes the authenticated server contracts PR B and PR C will consume, but it must remain fully functional with push disabled.

**Tech Stack:** Node.js 22, Express 4, Socket.IO 4.8.1, Mongoose 7.8.7, Node test runner, Firebase Admin SDK 14.3.0.

**Spec:** `docs/superpowers/specs/2026-09-05-android-slice2-push-design.md`

## Global Constraints

- Base implementation work from exact green `main` head `1bb08b03ba52015fe4862a812785b4143f270c30` plus the approved design/spec commit only; rebase/refresh from current `main` before implementation if `main` has moved.
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
- `src/push/push-device-service.js` — register/rotate/retire devices, subscribe/unsubscribe rooms, and update suppression leases.
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

**Modify**

- `src/auth/mobile-session-service.js` — return stable server-side mobile-session ID from issue/resolve while preserving all existing token semantics.
- `index.js` — wire models/services, authenticated HTTP contracts, room join/leave subscription hooks, read-state event/endpoint, and post-persist push dispatch.
- `package.json` / `package-lock.json` — add exact `firebase-admin@14.3.0` dependency.
- `.github/workflows/android-slice1-ci.yml` — rename only if desired in a later PR; for PR A keep the existing workflow and ensure `src/**`, `tests/**`, `index.js`, package files already trigger it.
- `docs/android-private-apk.md` — append server-side FCM configuration names and explicitly state credentials stay off Git/APK.

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
  const created = { _id: '507f1f77bcf86cd799439011' };
  const MobileSessionModel = {
    create: async () => created,
    findOne: async () => null,
    updateOne: async () => ({ modifiedCount: 0 }),
    updateMany: async () => ({ modifiedCount: 0 }),
  };
  const UserModel = { findOne: async () => null };
  const service = createMobileSessionService({ MobileSessionModel, UserModel, tokenFactory: () => 'abc' });
  const result = await service.issue({ kind: 'account', userId: 'u1', username: 'Rob', canonicalUsername: 'rob', role: 'user' });
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
  const UserModel = { findOne: async () => ({ _id: 'u1', username: 'Rob', canonicalUsername: 'rob', role: 'user', state: 'active' }) };
  const service = createMobileSessionService({ MobileSessionModel, UserModel });
  const result = await service.resolve('dcm1.test');
  assert.equal(result.sessionId, '507f1f77bcf86cd799439012');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:
```bash
node --test tests/push/mobile-session-id.test.js
```
Expected: FAIL because `sessionId` is not currently returned.

- [ ] **Step 3: Implement the minimal session-ID return contract**

Change `issue()` to capture the created document and return its `_id`, and change `resolve()` to return the stored document `_id`:

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
  principal: { /* existing principal fields unchanged */ },
};
```

and:

```js
return {
  token,
  sessionId: stored?._id ? String(stored._id) : '',
  kind: 'mobile',
  principal,
};
```

Do not expose `tokenHash`.

- [ ] **Step 4: Run focused and existing mobile-session tests**

```bash
node --test tests/push/mobile-session-id.test.js tests/android-secure-session.test.js tests/auth-v2/*.test.js
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
  - `subscribeRoom({ sessionId, deviceId, room })`
  - `unsubscribeRoom({ sessionId, deviceId, room })`
  - `renewSuppressionLease({ sessionId, deviceId, ttlMs })`
  - `clearSuppressionLease({ sessionId, deviceId })`
  - `retireToken(fcmToken, reason)`
  - `disableSession(sessionId)`
  - `listRoomDevices(room)`

- [ ] **Step 1: Write failing service tests with in-memory model doubles**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushDeviceService } = require('../../src/push/push-device-service');

test('registerDevice binds device to the authenticated mobile session and rotates token', async () => {
  const calls = [];
  const PushDeviceModel = {
    findOneAndUpdate: async (filter, update, options) => {
      calls.push({ filter, update, options });
      return { sessionId: 's1', deviceId: 'dev1', fcmToken: 'new-token', canonicalUsername: 'rob' };
    },
    updateMany: async () => ({ modifiedCount: 0 }),
  };
  const SubscriptionModel = { updateOne: async () => ({}), deleteOne: async () => ({}), deleteMany: async () => ({}) };
  const service = createPushDeviceService({ PushDeviceModel, SubscriptionModel, now: () => new Date('2026-09-05T20:00:00Z') });
  const device = await service.registerDevice({ sessionId: 's1', canonicalUsername: 'rob', deviceId: 'dev1', fcmToken: 'new-token', deviceLabel: 'Pixel' });
  assert.equal(device.deviceId, 'dev1');
  assert.equal(calls[0].filter.sessionId, 's1');
  assert.equal(calls[0].filter.deviceId, 'dev1');
});

test('subscribeRoom is scoped to the same session and device', async () => {
  const updates = [];
  const PushDeviceModel = { findOne: async () => ({ sessionId: 's1', deviceId: 'dev1', disabledAt: null }) };
  const SubscriptionModel = { updateOne: async (...args) => { updates.push(args); return {}; }, deleteOne: async () => ({}) };
  const service = createPushDeviceService({ PushDeviceModel, SubscriptionModel });
  await service.subscribeRoom({ sessionId: 's1', deviceId: 'dev1', room: 'ShittyChat' });
  assert.deepEqual(updates[0][0], { sessionId: 's1', deviceId: 'dev1', room: 'ShittyChat' });
});
```

Also add explicit tests that a mismatched `sessionId` cannot subscribe/unsubscribe another device, `disableSession()` retires all device rows/subscriptions for that session, and two devices for the same username remain independent.

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

- [ ] **Step 4: Implement `createPushDeviceService`**

Use strict validation and always constrain mutations by both `sessionId` and `deviceId`:

```js
const requireString = (value, label, max) => {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new TypeError(`${label} is invalid`);
  return result;
};

const createPushDeviceService = ({ PushDeviceModel, SubscriptionModel, now = () => new Date() } = {}) => {
  const registerDevice = async ({ sessionId, canonicalUsername, deviceId, fcmToken, deviceLabel = 'Android' }) => {
    const registeredAt = now();
    return PushDeviceModel.findOneAndUpdate(
      { sessionId: requireString(sessionId, 'sessionId', 128), deviceId: requireString(deviceId, 'deviceId', 128) },
      { $set: {
        canonicalUsername: requireString(canonicalUsername, 'canonicalUsername', 120).toLowerCase(),
        fcmToken: requireString(fcmToken, 'fcmToken', 4096),
        deviceLabel: requireString(deviceLabel, 'deviceLabel', 120),
        platform: 'android', tokenRegisteredAt: registeredAt, disabledAt: null, disabledReason: '',
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  };
  // implement the remaining methods using the exact signatures listed above
  return { registerDevice, subscribeRoom, unsubscribeRoom, renewSuppressionLease, clearSuppressionLease, retireToken, disableSession, listRoomDevices };
};
```

For token rotation, first retire any *other* active record holding the incoming token before the upsert so the unique token index cannot attach one FCM token to two devices.

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
- Produces:
  - `getCursor({ canonicalUsername, room }) -> null | { messageId, timestamp }`
  - `advanceCursor({ canonicalUsername, room, messageId, timestamp }) -> { advanced, cursor }`
  - `isUnread({ canonicalUsername, room, messageId, timestamp }) -> boolean`
- Ordering: compare `timestamp` first, then 24-character ObjectId string lexicographically when timestamps are equal.

- [ ] **Step 1: Write RED tests for monotonic ordering**

```js
test('advanceCursor cannot move backwards', async () => {
  const current = { messageId: 'ffffffffffffffffffffffff', timestamp: new Date('2026-09-05T20:00:05Z') };
  const model = makeCursorModel(current);
  const service = createReadStateService({ RoomReadCursorModel: model });
  const result = await service.advanceCursor({ canonicalUsername: 'rob', room: 'ShittyChat', messageId: '000000000000000000000001', timestamp: '2026-09-05T20:00:04Z' });
  assert.equal(result.advanced, false);
  assert.equal(result.cursor.messageId, current.messageId);
});

test('equal timestamp advances only to greater message id', async () => {
  // current ...001, candidate ...002 => advanced true; candidate ...000 => false
});
```

The test file must include a deterministic in-memory `makeCursorModel()` implementing `findOne` and `findOneAndUpdate` so no Mongo server is needed.

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
  messageId: { type: String, required: true, trim: true, maxlength: 24 },
  messageTimestamp: { type: Date, required: true, index: true },
}, { timestamps: true });
schema.index({ canonicalUsername: 1, room: 1 }, { unique: true });
```

Ordering helper:

```js
const compareCursor = (a, b) => {
  const at = new Date(a.timestamp).getTime();
  const bt = new Date(b.timestamp).getTime();
  if (at !== bt) return at - bt;
  return String(a.messageId).localeCompare(String(b.messageId));
};
```

Use compare-then-CAS semantics: read current, return without mutation if candidate is not greater, otherwise `findOneAndUpdate` with a predicate that still matches the observed cursor (or no row) and retry once if another writer won. Do not perform an unconditional `$set` that can race backwards.

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
- Produces:
  - `isDevicePushEligible({ device, subscription, senderCanonicalUsername, readCursor, message, now })`
  - `buildSafePreview(message)`
  - `buildPushIntent({ device, message })`

- [ ] **Step 1: Write table-driven RED tests**

```js
const cases = [
  ['subscribed background device', { subscribed: true, lease: null }, true],
  ['own account', { subscribed: true, sender: 'rob' }, false],
  ['fresh foreground lease', { subscribed: true, lease: '2026-09-05T20:00:10Z' }, false],
  ['stale foreground lease', { subscribed: true, lease: '2026-09-05T19:59:59Z' }, true],
  ['disabled device', { subscribed: true, disabled: true }, false],
];
```

Add explicit tests that browser presence is not an input at all, screen-off is represented by a cleared/expired lease and is eligible, read messages are ineligible, two devices are evaluated independently, and attachment-only previews return `sent an image`, `sent a voice message`, `sent a video`, or `sent a file` without returning `fileUrl`.

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

const isDevicePushEligible = ({ device, subscription, senderCanonicalUsername, readCursor, message, now = new Date() }) => {
  if (!device || device.disabledAt || !device.fcmToken) return false;
  if (!subscription) return false;
  if (String(device.canonicalUsername) === String(senderCanonicalUsername)) return false;
  if (isLeaseFresh(device, now)) return false;
  if (readCursor && compareMessageToCursor(message, readCursor) <= 0) return false;
  return true;
};
```

`buildPushIntent()` must include only display/routing fields such as `room`, `messageId`, `sender`, `preview`, `notificationKey`; explicitly omit every token/credential field.

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

### Task 5: Add an Injected Push Coordinator

**Files:**
- Create: `src/push/push-coordinator.js`
- Test: `tests/push/push-coordinator.test.js`

**Interfaces:**
- Consumes: `pushDeviceService.listRoomDevices(room)`, `readStateService.getCursor(...)`, `transport.send(intent, token)`.
- Produces: `onMessageStored(message) -> Promise<{ attempted, sent, failed }>` and `sendRoomClear({ canonicalUsername, room, throughMessageId })` for later PR C.

- [ ] **Step 1: Write RED tests with a fake transport**

```js
test('message persistence caller can fire-and-forget push failures', async () => {
  const sent = [];
  const transport = { send: async (intent, token) => { sent.push({ intent, token }); throw Object.assign(new Error('offline'), { permanent: false }); } };
  const coordinator = createPushCoordinator({ pushDeviceService, readStateService, transport, now: () => new Date('2026-09-05T20:00:00Z') });
  const result = await coordinator.onMessageStored(message);
  assert.equal(result.failed, 1);
  assert.equal(sent.length, 1);
});

test('permanent token failure retires only that token', async () => {
  // fake transport throws { permanent: true, code: 'messaging/registration-token-not-registered' }
  // assert pushDeviceService.retireToken(token, code) called once
});
```

Add a test proving one account with two devices can send to one and suppress the other based only on each device's lease/subscription state.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/push-coordinator.test.js
```
Expected: FAIL.

- [ ] **Step 3: Implement coordinator**

```js
const createPushCoordinator = ({ pushDeviceService, readStateService, transport, now = () => new Date(), logger = console }) => {
  const onMessageStored = async (message) => {
    const candidates = await pushDeviceService.listRoomDevices(message.room);
    let attempted = 0, sent = 0, failed = 0;
    await Promise.all(candidates.map(async ({ device, subscription }) => {
      const readCursor = await readStateService.getCursor({ canonicalUsername: device.canonicalUsername, room: message.room });
      if (!isDevicePushEligible({ device, subscription, senderCanonicalUsername: message.canonicalUsername || message.userCanonical || message.user, readCursor, message, now: now() })) return;
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
- `createFcmTransport({ config, credentialProvider, messagingFactory }) -> { send(intent, token), sendControl(data, token) }`
- `createNullTransport() -> same interface, resolves without network`

- [ ] **Step 1: Install the exact server dependency**

```bash
npm install firebase-admin@14.3.0 --save-exact
```
Expected: only `package.json` and npm-managed `package-lock.json` dependency graph changes.

- [ ] **Step 2: Write RED tests**

```js
test('FCM transport maps permanent invalid-token errors', async () => {
  const messaging = { send: async () => { const error = new Error('gone'); error.code = 'messaging/registration-token-not-registered'; throw error; } };
  const transport = createFcmTransport({ config: { enabled: true, projectId: 'dizychat' }, messagingFactory: () => messaging });
  await assert.rejects(() => transport.send({ room: 'ShittyChat', messageId: 'm1', sender: 'Nick', preview: 'yo' }, 'token'), (error) => error.permanent === true);
});

test('push payload never includes mobile session or firebase credentials', async () => {
  let captured;
  const messaging = { send: async (payload) => { captured = payload; return 'ok'; } };
  const transport = createFcmTransport({ config: { enabled: true, projectId: 'dizychat' }, messagingFactory: () => messaging });
  await transport.send({ room: 'ShittyChat', messageId: 'm1', sender: 'Nick', preview: 'yo' }, 'token');
  const serialized = JSON.stringify(captured);
  assert.equal(serialized.includes('sessionToken'), false);
  assert.equal(serialized.includes('private_key'), false);
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

The JSON credential file lives on the self-hosted server with restrictive permissions and is never copied into the repo or APK.

Transport initialization should use:

```js
const { applicationDefault, initializeApp, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: config.projectId });
const messaging = getMessaging(app);
```

Use Android `collapseKey`/notification `tag` keyed by room for later one-notification-per-room behaviour, but PR A does not yet render custom Android actions.

- [ ] **Step 5: Run GREEN and dependency integrity check**

```bash
node --test tests/push/fcm-transport.test.js
npm test
npm ci --ignore-scripts
```
Expected: PASS; `npm ci` reproduces lockfile cleanly.

- [ ] **Step 6: Document the external credential boundary**

Add to `docs/android-private-apk.md` the three environment names above and this invariant:

```text
Firebase service-account credentials exist only on the self-hosted DizyChat server. They are never committed, placed in GitHub Actions for debug APK builds, embedded in public assets, or packaged in the APK.
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/push/fcm-config.js src/push/transports/fcm-transport.js src/push/transports/null-transport.js tests/push/fcm-transport.test.js docs/android-private-apk.md
git commit -m "feat: add server FCM transport"
```

---

### Task 7: Wire Authenticated Push/Read Contracts into the Server

**Files:**
- Modify: `index.js`
- Test: `tests/push/push-http-contract.test.js`

**Interfaces:**
- `POST /api/mobile/push/register` — mobile session only; body `{ deviceId, fcmToken, deviceLabel }`.
- `POST /api/mobile/push/presence` — mobile session only; body `{ deviceId, interactive, ttlMs }`; `interactive=false` clears lease, `interactive=true` renews a capped lease.
- `POST /api/read-state/mark` — any authenticated account session; body `{ room, messageId }`; server loads the target message to obtain authoritative timestamp/room before advancing cursor.
- `GET /api/read-state?room=<room>` — authenticated account session.
- Existing successful Android room join/leave path persists/removes device subscription only after room access has already succeeded.

- [ ] **Step 1: Write RED HTTP/auth contract tests**

Use an exported app factory or the repo's existing server-test seam; do not start a real production listener. Assert:

```js
assert.equal((await post('/api/mobile/push/register', {}, null)).status, 401);
assert.equal((await post('/api/mobile/push/register', { deviceId: 'd1', fcmToken: 't1' }, browserToken)).status, 403);
assert.equal((await post('/api/mobile/push/register', { deviceId: 'd1', fcmToken: 't1' }, mobileToken)).status, 200);
assert.equal((await post('/api/mobile/push/presence', { deviceId: 'd1', interactive: false }, mobileToken)).status, 200);
```

Add tests proving `ttlMs` is server-capped (for example max 90 seconds), a device cannot mutate another mobile session's record, and `mark` rejects a `messageId` that does not belong to the requested room.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/push-http-contract.test.js
```
Expected: FAIL.

- [ ] **Step 3: Add small HTTP auth helpers in `index.js`**

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

If `resolveAccountSessionToken()` currently normalizes away `kind/sessionId`, preserve those fields when returning a mobile session.

- [ ] **Step 4: Add the three POST endpoints and read GET**

Use `express.json({ limit: '32kb' })` on `/api/mobile/push/*` and `/api/read-state/*` if JSON middleware is not already globally installed. Validate every string length before calling services.

Presence rule:

```js
const PRESENCE_LEASE_MAX_MS = 90_000;
const requested = Number(req.body?.ttlMs || 45_000);
const ttlMs = Math.min(Math.max(requested, 5_000), PRESENCE_LEASE_MAX_MS);
if (req.body?.interactive === true) await pushDeviceService.renewSuppressionLease({ sessionId: session.sessionId, deviceId, ttlMs });
else await pushDeviceService.clearSuppressionLease({ sessionId: session.sessionId, deviceId });
```

Read mark rule: load `Message.findById(messageId)`, verify `message.room === room`, then call `advanceCursor()` with the authoritative persisted timestamp.

- [ ] **Step 5: Hook device subscriptions to successful room admission/leave**

Do not trust a standalone client claim that it joined a room. Extend the existing native join payload/socket context with `deviceId`; only after the existing room-password/account authorization path accepts the join call:

```js
if (socket.data?.principal?.kind === 'account' && socket.data?.mobileSessionId && socket.data?.deviceId) {
  await pushDeviceService.subscribeRoom({
    sessionId: socket.data.mobileSessionId,
    deviceId: socket.data.deviceId,
    room: acceptedRoomName,
  });
}
```

On the existing explicit Leave-room path, call `unsubscribeRoom` for that device+room. A transient socket disconnect must **not** unsubscribe: background/killed apps still need pushes. Logout/revocation disables the mobile session/device instead.

- [ ] **Step 6: Run focused GREEN tests**

```bash
node --test tests/push/push-http-contract.test.js tests/push/push-device-service.test.js tests/push/read-state-service.test.js
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add index.js tests/push/push-http-contract.test.js
git commit -m "feat: expose authenticated push state contracts"
```

---

### Task 8: Dispatch Push Only After Message Persistence and Preserve Chat on Failure

**Files:**
- Modify: `index.js`
- Test: `tests/push/push-coordinator.test.js`
- Test: add focused integration coverage in `tests/push/push-http-contract.test.js` or a new `tests/push/message-push-integration.test.js`

**Interfaces:**
- Existing `chat message` storage/publication remains authoritative.
- New call site: `void pushCoordinator.onMessageStored(savedMessage).catch(...)` **after** successful persistence/publication boundary.

- [ ] **Step 1: Write RED integration test**

```js
test('FCM rejection cannot reject or duplicate an accepted chat message', async () => {
  const pushCoordinator = { onMessageStored: async () => { throw new Error('FCM down'); } };
  const result = await exerciseChatMessagePath({ pushCoordinator, text: 'hello' });
  assert.equal(result.persistedCount, 1);
  assert.equal(result.socketPublishedCount, 1);
  assert.equal(result.clientAckAccepted, true);
});
```

Add a companion test that a successful push coordinator is called exactly once with the persisted message ID, room, sender identity, text/file metadata, and timestamp.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/message-push-integration.test.js
```
Expected: FAIL until the chat path exposes/injects the coordinator seam.

- [ ] **Step 3: Wire fire-and-forget dispatch after accepted message storage**

At the exact existing boundary where the stored message document is finalized:

```js
const storedMessage = toPlainMessage(savedMessage);
io.to(roomName).emit('chat message', storedMessage);

void pushCoordinator.onMessageStored(storedMessage).catch((error) => {
  console.warn('[Push] post-message dispatch failed', { code: error?.code || 'unexpected' });
});
```

Do not `await` push before acknowledging/publishing the chat message. Preserve all current reply/file/reaction semantics.

- [ ] **Step 4: Run GREEN and full deterministic suite**

```bash
node --test tests/push/message-push-integration.test.js
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

**Files:**
- No feature changes unless a failing gate proves a defect.

- [ ] **Step 1: Verify dependency tree and deterministic tests**

```bash
npm ci
npm test
```
Expected: PASS.

- [ ] **Step 2: Verify Android packaging still works with push unconfigured**

```bash
npm run android:prepare
npx cap sync android
cd android
./gradlew assembleDebug --no-daemon
```
Expected: debug APK builds successfully without `google-services.json` or server Firebase credentials. The existing Gradle message that push will not work without `google-services.json` is acceptable for this PR because PR B adds the client Firebase configuration boundary.

- [ ] **Step 3: Secret/payload scan**

```bash
git grep -nE 'private_key|BEGIN PRIVATE KEY|dcm1\.|GOOGLE_APPLICATION_CREDENTIALS=.+' -- ':!docs/superpowers/**'
```
Expected: no committed credential material and no hard-coded mobile token. Environment variable *names* are allowed; credential *values* are not.

- [ ] **Step 4: Confirm exact head and diff scope**

```bash
git rev-parse HEAD
git diff --stat origin/main...HEAD
git status --short
```
Expected: clean working tree; diff contains only PR A server foundation, tests, dependency lock update, and documentation.

- [ ] **Step 5: Push branch/open draft PR and require CI on exact final SHA**

Use the connected GitHub app for PR operations. Do not merge from a locally green result alone. Record exact head SHA in the PR body, wait for the Android/deterministic workflow on that SHA, and stop before merge if any later commit changes the head.

---

## PR A Acceptance Boundary

PR A is complete only when the exact final head proves all of the following:

- mobile session IDs are exposed server-side without leaking token hashes;
- push devices are session-bound and token rotation is deterministic;
- room subscriptions are per device and only created after successful room admission;
- explicit Leave removes that device's subscription but disconnect/background does not;
- read cursors are account+room and monotonic;
- fresh foreground+interactive lease suppresses only that device;
- stale/cleared lease remains push eligible;
- own-account messages are excluded;
- disabled/revoked session devices are excluded;
- FCM credentials are external to Git/APK;
- permanent token failures retire only the bad registration;
- temporary transport failures preserve state;
- chat storage/publication works identically with FCM disabled or failing;
- `npm test`, Capacitor sync, and Android debug build pass on the exact final head.
