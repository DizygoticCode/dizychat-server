# Android Slice 2 PR A — Server Push Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the self-hosted server authority for Android push registration, per-device room subscriptions, account-wide read cursors, foreground/screen-on suppression leases, recipient selection, and an FCM transport boundary without changing Android notification UI yet.

**Architecture:** DizyChat remains authoritative. Extend the existing durable mobile session with a safe server-side session ID, persist push-device/subscription/read state in dedicated Mongo models, validate that every candidate still belongs to a non-revoked mobile session and active account, decide eligibility in a pure policy layer, and invoke FCM only after a chat message is already accepted. Pass the authenticated sender canonical username separately from the persisted display message so own-account suppression is exact for registered users and never guessed from guest display names.

**Tech Stack:** Node.js 22, Express 4.21.2, Socket.IO 4.8.1, Mongoose 7.8.7, Node test runner, Firebase Admin SDK 14.3.0.

**Spec:** `docs/superpowers/specs/2026-09-05-android-slice2-push-design.md`

## Global Constraints

- Start from exact green `main`; design base was `1bb08b03ba52015fe4862a812785b4143f270c30`, but refresh if `main` has moved before implementation.
- FCM is transport only. DizyChat owns identity, session validity, room membership, subscriptions, read state, eligibility, reply authorization, and message storage.
- Raw mobile tokens never enter push models, FCM payloads, logs, or notification data.
- Push disabled/unconfigured is a supported server state.
- Chat persistence/Socket.IO publication never waits on or fails because of FCM.
- Browser presence never suppresses Android push.
- Suppression is per device and valid only while a short-lived `foreground + screen interactive` lease is fresh.
- Read state is account+room, monotonic, and separate from global `Message.status`.
- One account may have multiple Android devices with independent room subscriptions.
- Use TDD and focused commits.
- Do not hand-edit `package-lock.json`; update it through `npm install firebase-admin@14.3.0 --save-exact` only.

---

## File Structure

**Create**

- `src/models/push-device.js`
- `src/models/push-room-subscription.js`
- `src/models/room-read-cursor.js`
- `src/push/push-device-service.js`
- `src/push/read-state-service.js`
- `src/push/notification-policy.js`
- `src/push/push-coordinator.js`
- `src/push/fcm-config.js`
- `src/push/transports/fcm-transport.js`
- `src/push/transports/null-transport.js`
- `tests/push/mobile-session-id.test.js`
- `tests/push/push-device-service.test.js`
- `tests/push/read-state-service.test.js`
- `tests/push/notification-policy.test.js`
- `tests/push/push-coordinator.test.js`
- `tests/push/fcm-transport.test.js`
- `tests/push/push-http-contract.test.js`
- `tests/push/message-push-integration.test.js`

**Modify**

- `src/auth/mobile-session-service.js`
- `index.js`
- `package.json`
- `package-lock.json` via npm
- `docs/android-private-apk.md`

---

### Task 1: Expose a Safe Server-Side Mobile Session ID

**Files:**
- Modify: `src/auth/mobile-session-service.js`
- Test: `tests/push/mobile-session-id.test.js`

**Contract:** `issue()` and `resolve()` return `sessionId` equal to persisted `MobileSession._id`; no token hash is exposed and existing token/principal semantics remain unchanged.

- [ ] **Step 1: Write RED tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileSessionService } = require('../../src/auth/mobile-session-service');

test('issue returns persisted session id without tokenHash', async () => {
  const MobileSessionModel = {
    create: async () => ({ _id: '507f1f77bcf86cd799439011' }),
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

test('resolve returns persisted session id', async () => {
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
  assert.equal(result.kind, 'mobile');
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/mobile-session-id.test.js
```

- [ ] **Step 3: Implement**

Capture created row in `issue()`:

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
  sessionId: String(stored._id),
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

Return `sessionId: String(stored._id)` from `resolve()` alongside existing `token`, `kind`, `principal`.

- [ ] **Step 4: Run GREEN/full auth regression and commit**

```bash
node --test tests/push/mobile-session-id.test.js
npm test
git add src/auth/mobile-session-service.js tests/push/mobile-session-id.test.js
git commit -m "refactor: expose safe mobile session id"
```

---

### Task 2: Persist Push Devices and Per-Device Room Subscriptions

**Files:**
- Create: `src/models/push-device.js`
- Create: `src/models/push-room-subscription.js`
- Create: `src/push/push-device-service.js`
- Test: `tests/push/push-device-service.test.js`

**Service dependencies:** `PushDeviceModel`, `SubscriptionModel`, `MobileSessionModel`, `UserModel`, `now`.

**Methods:**
- `registerDevice({ sessionId, canonicalUsername, deviceId, fcmToken, deviceLabel })`
- `findRegisteredDevice({ sessionId, deviceId })`
- `subscribeRoom({ sessionId, canonicalUsername, deviceId, room })`
- `unsubscribeRoom({ sessionId, deviceId, room })`
- `findActiveSubscription({ sessionId, deviceId, room })`
- `renewSuppressionLease({ sessionId, deviceId, ttlMs })`
- `clearSuppressionLease({ sessionId, deviceId })`
- `retireToken(fcmToken, reason)`
- `disableSession(sessionId, reason)`
- `disableUser(canonicalUsername, reason)`
- `listRoomDevices(room) -> [{ device, subscription }]`

- [ ] **Step 1: Write RED tests**

Tests must prove:

```js
const device = await service.registerDevice({
  sessionId: '507f1f77bcf86cd799439011', canonicalUsername: 'rob',
  deviceId: 'dev1', fcmToken: 'token1', deviceLabel: 'Pixel',
});
assert.equal(device.deviceId, 'dev1');

assert.ok(await service.findActiveSubscription({
  sessionId: '507f1f77bcf86cd799439011', deviceId: 'dev1', room: 'ShittyChat',
}));
assert.equal(await service.findActiveSubscription({
  sessionId: '507f1f77bcf86cd799439099', deviceId: 'dev1', room: 'ShittyChat',
}), null);
```

Add explicit cases:
- registering against nonexistent/revoked mobile session fails;
- registering when account is not active fails;
- token rotation from one device to another does not violate unique index;
- two devices on same account retain independent room subscriptions;
- disableSession removes only that session's subscriptions;
- disableUser disables all that account's device rows/subscriptions;
- `listRoomDevices` excludes a device if the push row is enabled but its `MobileSession.revokedAt` has since changed;
- `listRoomDevices` excludes an account whose `User.state !== 'active'` even if push/session rows were not yet cleaned up.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/push-device-service.test.js
```

- [ ] **Step 3: Create models**

`src/models/push-device.js`:

```js
'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true, trim: true, match: /^[a-f0-9]{24}$/i },
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

schema.index({ sessionId: 1, deviceId: 1 }, { unique: true });
schema.index(
  { fcmToken: 1 },
  { unique: true, partialFilterExpression: { disabledAt: null } }
);
module.exports = mongoose.models.PushDevice || mongoose.model('PushDevice', schema);
```

The partial unique token index is required: a retired row may retain its historical token, while only one **active** device may own that token.

`src/models/push-room-subscription.js`:

```js
'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true, trim: true, match: /^[a-f0-9]{24}$/i },
  deviceId: { type: String, required: true, index: true, trim: true, maxlength: 128 },
  canonicalUsername: { type: String, required: true, index: true, trim: true, lowercase: true },
  room: { type: String, required: true, index: true, trim: true, maxlength: 80 },
}, { timestamps: true });
schema.index({ sessionId: 1, deviceId: 1, room: 1 }, { unique: true });
module.exports = mongoose.models.PushRoomSubscription || mongoose.model('PushRoomSubscription', schema);
```

- [ ] **Step 4: Implement session/account validation helpers**

```js
const assertActiveSessionAccount = async ({ sessionId, canonicalUsername }) => {
  const session = await MobileSessionModel.findOne({
    _id: sessionId,
    canonicalUsername,
    revokedAt: null,
  });
  if (!session) throw coded('MOBILE_SESSION_INVALID');
  const user = await UserModel.findOne({ canonicalUsername, state: 'active' });
  if (!user) throw coded('ACCOUNT_INACTIVE');
  return { session, user };
};

const isStillActive = async (device) => {
  const session = await MobileSessionModel.findOne({
    _id: device.sessionId,
    canonicalUsername: device.canonicalUsername,
    revokedAt: null,
  });
  if (!session) return false;
  return Boolean(await UserModel.findOne({
    canonicalUsername: device.canonicalUsername,
    state: 'active',
  }));
};
```

- [ ] **Step 5: Implement concrete mutations/queries**

`registerDevice()` validates session/account, retires any *other active* row holding incoming token, then upserts `{ sessionId, deviceId }` with current token and `disabledAt:null`.

`findRegisteredDevice()`:

```js
const device = await PushDeviceModel.findOne({ sessionId, deviceId, disabledAt: null });
if (!device) return null;
return await isStillActive(device) ? device : null;
```

`subscribeRoom()` must call `findRegisteredDevice()` first and require that returned row's canonical username equals the requested canonical username before subscription upsert.

`unsubscribeRoom()` deletes exactly `{ sessionId, deviceId, room }`.

`findActiveSubscription()` loads subscription, then calls `findRegisteredDevice()`; return null when either side is missing/inactive.

Lease mutation:

```js
await PushDeviceModel.updateOne(
  { sessionId, deviceId, disabledAt: null },
  { $set: { suppressionLeaseExpiresAt: new Date(now().getTime() + ttlMs) } }
);
await PushDeviceModel.updateOne(
  { sessionId, deviceId, disabledAt: null },
  { $set: { suppressionLeaseExpiresAt: null } }
);
```

`retireToken()` sets `disabledAt`, `disabledReason`, clears lease on active rows with that token.

`disableSession()` disables rows matching session and deletes subscriptions `{ sessionId }`.

`disableUser()` disables rows matching canonical username and deletes subscriptions `{ canonicalUsername }`.

`listRoomDevices(room)` loads room subscriptions, finds same-session/device active push rows, then **re-validates mobile session + account state** with `isStillActive()` before returning `{ device, subscription }`.

- [ ] **Step 6: Run GREEN and commit**

```bash
node --test tests/push/push-device-service.test.js
git add src/models/push-device.js src/models/push-room-subscription.js src/push/push-device-service.js tests/push/push-device-service.test.js
git commit -m "feat: add push device subscriptions"
```

---

### Task 3: Add Monotonic Account+Room Read Cursors

**Files:**
- Create: `src/models/room-read-cursor.js`
- Create: `src/push/read-state-service.js`
- Test: `tests/push/read-state-service.test.js`

**Contract:** ObjectId-shaped message IDs only; cursor compares timestamp first then lowercase 24-char ObjectId string; cursor never moves backward under concurrent calls.

- [ ] **Step 1: Write RED tests**

```js
test('malformed message id is rejected', async () => {
  await assert.rejects(
    () => service.advanceCursor({ canonicalUsername: 'rob', room: 'ShittyChat', messageId: 'bad', timestamp: '2026-09-05T20:00:00Z' }),
    /messageId/i
  );
});

test('older timestamp cannot move cursor backwards', async () => {
  const current = { messageId: 'ffffffffffffffffffffffff', messageTimestamp: new Date('2026-09-05T20:00:05Z') };
  const result = await makeService(current).advanceCursor({
    canonicalUsername: 'rob', room: 'ShittyChat',
    messageId: '000000000000000000000001', timestamp: '2026-09-05T20:00:04Z',
  });
  assert.equal(result.advanced, false);
});
```

Add equal-timestamp tie-break test and simulated CAS race test where another writer advances further before update.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/read-state-service.test.js
```

- [ ] **Step 3: Create model**

```js
const schema = new mongoose.Schema({
  canonicalUsername: { type: String, required: true, index: true, trim: true, lowercase: true },
  room: { type: String, required: true, index: true, trim: true, maxlength: 80 },
  messageId: { type: String, required: true, trim: true, minlength: 24, maxlength: 24, match: /^[a-f0-9]{24}$/i },
  messageTimestamp: { type: Date, required: true, index: true },
}, { timestamps: true });
schema.index({ canonicalUsername: 1, room: 1 }, { unique: true });
```

- [ ] **Step 4: Implement compare + CAS service**

```js
const compareCursor = (a, b) => {
  const at = new Date(a.timestamp ?? a.messageTimestamp).getTime();
  const bt = new Date(b.timestamp ?? b.messageTimestamp).getTime();
  if (at !== bt) return at - bt;
  return String(a.messageId).toLowerCase().localeCompare(String(b.messageId).toLowerCase());
};
```

Flow: validate inputs; read current; return unchanged when candidate <= current; otherwise `findOneAndUpdate` with a filter matching the observed `messageId/messageTimestamp`, or an upsert for absent row. If CAS loses, reload and retry once. Never unconditional `$set` over a newer cursor.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test tests/push/read-state-service.test.js
git add src/models/room-read-cursor.js src/push/read-state-service.js tests/push/read-state-service.test.js
git commit -m "feat: add room read cursors"
```

---

### Task 4: Implement Pure Eligibility + Safe Preview Policy

**Files:**
- Create: `src/push/notification-policy.js`
- Test: `tests/push/notification-policy.test.js`

**Contract:** policy receives already session/account-valid device candidates; it evaluates subscription, own-account sender, lease freshness, read cursor, and safe preview only.

- [ ] **Step 1: Write RED table tests**

Prove:
- subscribed background device => eligible;
- sender canonical == target account canonical => ineligible;
- sender canonical empty (guest) does **not** trigger own-account suppression;
- fresh lease => ineligible;
- stale/cleared lease => eligible;
- disabled/no-token/no-subscription => ineligible;
- message at/before read cursor => ineligible;
- browser presence is not an input;
- image/audio/video/file attachment-only labels are safe human strings and never raw URL.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/notification-policy.test.js
```

- [ ] **Step 3: Implement**

```js
const isDevicePushEligible = ({
  device, subscription, senderCanonicalUsername = '', readCursor, message, now = new Date(),
}) => {
  if (!device || device.disabledAt || !device.fcmToken || !subscription) return false;
  const target = String(device.canonicalUsername || '').trim().toLowerCase();
  const sender = String(senderCanonicalUsername || '').trim().toLowerCase();
  if (sender && target && sender === target) return false;
  const lease = device.suppressionLeaseExpiresAt ? new Date(device.suppressionLeaseExpiresAt).getTime() : 0;
  if (Number.isFinite(lease) && lease > new Date(now).getTime()) return false;
  if (readCursor && compareMessageToCursor(message, readCursor) <= 0) return false;
  return true;
};
```

`buildPushIntent({ device, message })` returns only room, messageId, sender display, safe preview, account+room opaque notification key, timestamp. It does not return `device`, `fcmToken`, canonical username, auth data, or password.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test tests/push/notification-policy.test.js
git add src/push/notification-policy.js tests/push/notification-policy.test.js
git commit -m "feat: define push eligibility policy"
```

---

### Task 5: Add Push Coordinator with Explicit Authenticated Sender Identity

**Files:**
- Create: `src/push/push-coordinator.js`
- Test: `tests/push/push-coordinator.test.js`

**Interface:**
`onMessageStored(message, { senderCanonicalUsername = '' } = {}) -> { attempted, sent, failed }`.

- [ ] **Step 1: Write RED tests**

```js
test('same-account registered sender is excluded using explicit canonical identity', async () => {
  const sent = [];
  const coordinator = makeCoordinator({
    devices: [device('rob', 'rob-token'), device('nick', 'nick-token')],
    send: async (_intent, token) => sent.push(token),
  });
  await coordinator.onMessageStored(message, { senderCanonicalUsername: 'rob' });
  assert.deepEqual(sent, ['nick-token']);
});

test('guest display name is not guessed into account identity', async () => {
  const sent = [];
  const coordinator = makeCoordinator({ devices: [device('rob', 'rob-token')], send: async (_intent, token) => sent.push(token) });
  await coordinator.onMessageStored({ ...message, user: 'Guest-abcd' }, { senderCanonicalUsername: '' });
  assert.deepEqual(sent, ['rob-token']);
});
```

Add tests for independent two-device lease state, permanent invalid-token retirement, temporary failure preserving registration, and no FCM token logging.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/push-coordinator.test.js
```

- [ ] **Step 3: Implement**

For each `listRoomDevices(message.room)` candidate, load account read cursor, run pure eligibility with explicit sender canonical, send intent to token. On `error.permanent === true`, retire only that token. Log error code/permanent flag, never token.

Provide `sendRoomClear()` as a no-op interface returning zero counts in PR A; PR C replaces it with real control delivery.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test tests/push/push-coordinator.test.js
git add src/push/push-coordinator.js tests/push/push-coordinator.test.js
git commit -m "feat: add push coordinator"
```

---

### Task 6: Add Firebase Admin Transport + Disabled Boundary

**Files:**
- Create: `src/push/fcm-config.js`
- Create: `src/push/transports/fcm-transport.js`
- Create: `src/push/transports/null-transport.js`
- Modify: `package.json`, npm-managed `package-lock.json`
- Modify: `docs/android-private-apk.md`
- Test: `tests/push/fcm-transport.test.js`

- [ ] **Step 1: Install exact dependency**

```bash
npm install firebase-admin@14.3.0 --save-exact
```

- [ ] **Step 2: Write RED tests**

Prove:
- config disabled => null transport/no network;
- permanent codes such as `messaging/registration-token-not-registered` are mapped to `error.permanent = true`;
- temporary errors are non-permanent;
- serialized payload contains no auth/server/signing secrets;
- transport accepts injected `messagingFactory` so tests never contact Firebase.

- [ ] **Step 3: Implement config**

```js
const readFcmConfig = (env = process.env) => ({
  enabled: ['1', 'true', 'yes', 'on'].includes(String(env.DIZYCHAT_FCM_ENABLED || '').trim().toLowerCase()),
  projectId: String(env.DIZYCHAT_FIREBASE_PROJECT_ID || '').trim(),
});
```

Server credential contract:

```text
DIZYCHAT_FCM_ENABLED=true
DIZYCHAT_FIREBASE_PROJECT_ID=<project id>
GOOGLE_APPLICATION_CREDENTIALS=/etc/dizychat/firebase-service-account.json
```

Production transport uses `firebase-admin/app` `applicationDefault()/initializeApp()` and `firebase-admin/messaging` `getMessaging()`. Null transport implements same `send()`/`sendControl()` methods and resolves without network.

- [ ] **Step 4: Run GREEN + lockfile integrity**

```bash
node --test tests/push/fcm-transport.test.js
npm test
npm ci --ignore-scripts
```

- [ ] **Step 5: Document server-only credential boundary and commit**

`docs/android-private-apk.md` must state service-account credentials exist only on self-hosted server and are never committed/packaged in APK.

```bash
git add package.json package-lock.json src/push/fcm-config.js src/push/transports/fcm-transport.js src/push/transports/null-transport.js tests/push/fcm-transport.test.js docs/android-private-apk.md
git commit -m "feat: add server FCM transport"
```

---

### Task 7: Wire Socket Mobile Metadata, HTTP Contracts, Room Hooks, and Revocation

**Files:**
- Modify: `index.js`
- Test: `tests/push/push-http-contract.test.js`

**HTTP contracts:**
- `POST /api/mobile/push/register` mobile only `{ deviceId, fcmToken, deviceLabel }`
- `POST /api/mobile/push/presence` mobile only `{ deviceId, interactive, ttlMs }`
- `POST /api/read-state/mark` authenticated account `{ room, messageId }`
- `GET /api/read-state?room=<room>` authenticated account

- [ ] **Step 1: Write RED HTTP/socket tests**

Prove:
- no bearer => 401 register;
- browser bearer => 403 register/presence;
- mobile bearer => 200;
- mobile handshake/login/session refresh preserves server-side `mobileSessionId` without exposing it in ack;
- browser socket has empty `mobileSessionId`;
- presence TTL is server-capped;
- message ID/room mismatch is rejected;
- rejected room password never subscribes;
- successful native join subscribes only registered same-session device;
- explicit Leave unsubscribes only same-session/device/room;
- disconnect does not unsubscribe;
- logout disables session push state;
- account-wide mobile revoke disables all that account's push state.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/push-http-contract.test.js
```

- [ ] **Step 3: Preserve session metadata on sockets**

Initialize:

```js
socket.principal = null;
socket.accountSessionToken = '';
socket.mobileSessionId = '';
socket.mobileDeviceId = '';
```

Whenever `resolveAccountSessionToken()` succeeds during handshake/account login/account session refresh:

```js
socket.principal = session.principal;
socket.accountSessionToken = session.token;
socket.mobileSessionId = session.kind === 'mobile' ? String(session.sessionId || '') : '';
```

Clear mobile fields on failed session/logout. Do not add `sessionId` to auth ack JSON.

- [ ] **Step 4: Add HTTP auth helpers and endpoints**

Read bearer token; `requireHttpAccount()` resolves browser or mobile account. `requireHttpMobileAccount()` additionally requires `session.kind === 'mobile' && session.sessionId`.

Presence TTL:

```js
const PRESENCE_LEASE_MAX_MS = 90_000;
const raw = Number(req.body?.ttlMs ?? 45_000);
const ttlMs = Math.min(Math.max(Number.isFinite(raw) ? raw : 45_000, 5_000), PRESENCE_LEASE_MAX_MS);
```

Read mark validates 24-char ObjectId, loads persisted Message, verifies room, and passes persisted timestamp to read service. Never trust client timestamp.

- [ ] **Step 5: Bind subscription only after accepted join**

Change current handler signature to `socket.on('join room', async (payload = {}) => { ... })` and read `deviceId` without disturbing existing browser fields.

Run all existing password/account/ban admission checks first. After socket successfully joins:

```js
if (socket.mobileSessionId && deviceId && socket.principal?.kind === 'account') {
  const device = await pushDeviceService.findRegisteredDevice({
    sessionId: socket.mobileSessionId,
    deviceId,
  });
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

No standalone client subscription claim is trusted.

- [ ] **Step 6: Explicit Leave only**

Normalize current Leave object and, when native device ID matches `socket.mobileDeviceId`, unsubscribe exact session/device/room before current `removeSocketFromRoom`. Do not unsubscribe in disconnect handler.

- [ ] **Step 7: Couple revocation to push disablement**

For mobile token logout/revoke, resolve current mobile session first, revoke it, then `pushDeviceService.disableSession(sessionId, reason)`. For account-wide `mobileAccountSessions.revokeUser(canonicalUsername)`, also call `pushDeviceService.disableUser(canonicalUsername, 'account-revoked')`.

Defense in depth remains in `listRoomDevices()`: even if cleanup fails or account state changes outside this path, revoked/inactive sessions are filtered before push.

- [ ] **Step 8: Run GREEN/full suite and commit**

```bash
node --test tests/push/push-http-contract.test.js tests/push/push-device-service.test.js tests/push/read-state-service.test.js
npm test
git add index.js tests/push/push-http-contract.test.js
git commit -m "feat: expose authenticated push state contracts"
```

---

### Task 8: Dispatch Push After Persistence with Explicit Sender Canonical Identity

**Files:**
- Modify: `index.js`
- Test: `tests/push/message-push-integration.test.js`

- [ ] **Step 1: Write RED tests**

Prove:
- coordinator rejection cannot undo accepted/published message;
- registered sender passes `socket.principal.canonicalUsername`;
- guest passes empty sender canonical;
- coordinator called exactly once per accepted stored message.

```js
test('registered sender canonical is passed explicitly', async () => {
  const calls = [];
  const pushCoordinator = { onMessageStored: async (message, meta) => calls.push({ message, meta }) };
  await exerciseChatMessagePath({
    pushCoordinator,
    principal: { kind: 'account', username: 'Rob', canonicalUsername: 'rob' },
    text: 'hello',
  });
  assert.equal(calls[0].meta.senderCanonicalUsername, 'rob');
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/message-push-integration.test.js
```

- [ ] **Step 3: Wire fire-and-forget post-persist dispatch**

After current `await newMsg.save()` and normal room publication/delivery-status path:

```js
const senderCanonicalUsername = socket.principal?.kind === 'account'
  ? String(socket.principal.canonicalUsername || '')
  : '';

void pushCoordinator.onMessageStored(
  newMsg.toJSON ? newMsg.toJSON() : newMsg,
  { senderCanonicalUsername }
).catch((error) => {
  console.warn('[Push] post-message dispatch failed', { code: error?.code || 'unexpected' });
});
```

Never derive account identity from `newMsg.user`. Do not await FCM before message acceptance.

- [ ] **Step 4: Run GREEN/full suite and commit**

```bash
node --test tests/push/message-push-integration.test.js tests/push/push-coordinator.test.js
npm test
git add index.js tests/push/message-push-integration.test.js
git commit -m "feat: dispatch push after stored messages"
```

---

### Task 9: Exact-Head PR A Gate

- [ ] **Step 1: Deterministic/dependency gate**

```bash
npm ci
npm test
```

- [ ] **Step 2: Android regression build with push unconfigured**

```bash
npm run android:prepare
npx cap sync android
cd android && ./gradlew assembleDebug --no-daemon
```

Expected: existing debug APK still builds; PR B adds Android client Firebase config.

- [ ] **Step 3: Secret scan**

```bash
git grep -nE 'BEGIN PRIVATE KEY|private_key_id|dcm1\.[A-Za-z0-9_-]{8,}|mongodb(\+srv)?://[^[:space:]]+:[^[:space:]]+@' -- ':!docs/superpowers/**'
```

Expected: no committed credential material/hard-coded mobile token.

- [ ] **Step 4: Exact head/diff**

```bash
git rev-parse HEAD
git status --short
git diff --stat origin/main...HEAD
```

- [ ] **Step 5: Draft PR via connected GitHub**

Record exact head SHA and require deterministic/Android CI on that SHA. Any later commit invalidates earlier green evidence and requires the gate again.

---

## PR A Acceptance Boundary

PR A is complete only when exact final-head evidence proves:

- safe mobile session ID exists server-side without token-hash exposure;
- every push candidate is backed by active PushDevice + non-revoked MobileSession + active User;
- token rotation is compatible with retired historical rows via active-only unique token index;
- subscriptions are same-session/same-device and created only after successful room admission;
- explicit Leave unsubscribes; disconnect/background does not;
- logout/revocation disables push state and recipient filtering independently defends against stale cleanup;
- read cursor is account+room, ObjectId-valid, monotonic under races;
- foreground lease suppresses only target device; stale/cleared lease is eligible;
- own-account suppression uses explicit authenticated sender canonical; guest display names are never guessed into account identity;
- FCM credentials stay outside Git/APK;
- permanent bad token retires only that registration; temporary transport failure preserves state;
- push disabled/failing never breaks/duplicates chat persistence or Socket.IO;
- `npm test`, Capacitor sync, and Android debug build pass on exact final head.
