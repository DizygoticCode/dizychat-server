# Android Slice 2 PR C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Android Slice 2 by making account+room read state reconcile Android notifications across browser reads, multiple Android devices, process restarts, and FCM delivery while preserving the PR B Reply/tap/auth/persistence paths.

**Architecture:** Keep DizyChat server read state authoritative. A focused server read-state coordinator advances the existing monotonic cursor and asynchronously emits a data-only read-control intent to all active Android devices for that account. Android persists only non-secret per-room notification state, renders a bounded MessagingStyle history, applies idempotent read controls, and exposes minimal Capacitor methods so the existing native runtime can reconcile persisted notifications against `/api/read-state` on startup/reconnect.

**Tech Stack:** Node.js 22, Express, Socket.IO, Mongoose, Firebase Admin/FCM, Capacitor 7.4.4, Android Java, AndroidX NotificationCompat, JUnit 4, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-06-android-slice2-pr-c-design.md`

## Global Constraints

- Base is exact merged `main` `0806a77b36268a8850747ff1abe5ec3f56984f17`.
- Preserve PR B native registration, permission timing, foreground/screen-interactive suppression, tap routing, Reply, Mark as read, encrypted bearer storage, and shared chat persistence.
- DizyChat server remains authoritative for authentication, room membership, message persistence, reply authorization, and account+room read state.
- FCM remains data-only transport; no bearer/session token, room password, Firebase credential, Mongo credential, signing secret, or server secret may enter FCM payloads.
- Read-control delivery is best-effort and must not fail or roll back a successful read-cursor advancement.
- Permanent FCM token errors retire only the affected token registration; temporary failures preserve device/session/subscription/read state.
- Browser behaviour remains unchanged except that an authenticated account actually reading a message now advances the existing account+room read cursor as required by Slice 2.
- One room retains one Android notification identity; another room must never be cleared or overwritten by that identity.
- Native notification state contains no authentication credential.
- Deterministic CI requires no live Firebase credential.
- No PR C merge until the exact final head passes deterministic tests, Android JVM tests, asset preparation, Capacitor sync, Gradle debug APK build/upload, and Self-Host/browser regressions.

---

### Task 1: Add server read-control intents and active-account device enumeration

**Files:**
- Modify: `src/push/notification-policy.js`
- Modify: `src/push/push-device-service.js`
- Modify: `src/push/push-coordinator.js`
- Modify: `src/push/transports/fcm-transport.js`
- Modify: `tests/push/push-device-service.test.js`
- Modify: `tests/push/push-coordinator.test.js`
- Modify: `tests/push/fcm-transport.test.js`

**Interfaces:**
- Produces: `buildReadControlIntent({ device, room, cursor }) -> { type, room, messageId, notificationKey, timestamp }`.
- Produces: `pushDeviceService.listAccountDevices(canonicalUsername) -> Array<PushDevice>` containing only active, non-disabled devices whose mobile session is still active.
- Produces: `pushCoordinator.sendRoomClear({ canonicalUsername, room, cursor }) -> { attempted, sent, failed }`.
- Extends: `transport.send(intent, token)` to allow explicit `type: "message" | "read-control"` while preserving the strict data allowlist.

- [ ] **Step 1: Write failing policy/transport tests for explicit intent kinds and secret exclusion**

Add tests equivalent to:

```js
const readIntent = {
  type: 'read-control',
  room: 'General Chat',
  messageId: '507f1f77bcf86cd799439099',
  notificationKey: '0123456789abcdef01234567',
  timestamp: '2026-09-06T12:00:00.000Z',
};

await transport.send({ ...readIntent, authToken: 'NOPE', roomPassword: 'NOPE2' }, 'phone-a');
assert.deepEqual(payloads[0], {
  token: 'phone-a',
  data: {
    type: 'read-control',
    room: 'General Chat',
    messageId: '507f1f77bcf86cd799439099',
    sender: '',
    preview: '',
    notificationKey: '0123456789abcdef01234567',
    timestamp: '2026-09-06T12:00:00.000Z',
  },
});
assert.equal(JSON.stringify(payloads[0]).includes('NOPE'), false);
```

Also update the ordinary message expectation to require `type: 'message'`.

- [ ] **Step 2: Run focused transport tests and verify RED**

Run:

```bash
node --test tests/push/fcm-transport.test.js
```

Expected: FAIL because `type` is not allowlisted/emitted yet.

- [ ] **Step 3: Add explicit intent type and read-control builder**

In `notification-policy.js`, make ordinary intents explicit and add the read-control builder:

```js
const buildPushIntent = ({ device, message } = {}) => ({
  type: 'message',
  room: String(message?.room || ''),
  messageId: String(message?._id || message?.id || ''),
  sender: String(message?.user || ''),
  preview: buildSafePreview(message),
  notificationKey: buildNotificationKey(device?.canonicalUsername, message?.room),
  timestamp: message?.timestamp instanceof Date
    ? message.timestamp.toISOString()
    : new Date(message?.timestamp).toISOString(),
});

const buildReadControlIntent = ({ device, room, cursor } = {}) => ({
  type: 'read-control',
  room: String(room || '').trim(),
  messageId: String(cursor?.messageId || '').trim().toLowerCase(),
  sender: '',
  preview: '',
  notificationKey: buildNotificationKey(device?.canonicalUsername, room),
  timestamp: cursor?.messageTimestamp instanceof Date
    ? cursor.messageTimestamp.toISOString()
    : new Date(cursor?.messageTimestamp).toISOString(),
});
```

Export `buildReadControlIntent` and add `'type'` to `ALLOWED_DATA_KEYS` in `fcm-transport.js`.

- [ ] **Step 4: Write failing device/coordinator tests for account-wide read control**

Add a device-service test proving `listAccountDevices('nick')` excludes disabled devices and devices whose `MobileSession` is revoked. Replace the old `sendRoomClear is a no-op` test with:

```js
test('sendRoomClear targets every active device for the account and correct room', async () => {
  const sent = [];
  const coordinator = makeCoordinator({
    accountDevices: [
      { canonicalUsername: 'nick', fcmToken: 'phone-a', disabledAt: null },
      { canonicalUsername: 'nick', fcmToken: 'phone-b', disabledAt: null },
    ],
    send: async (intent, token) => sent.push({ intent, token }),
  });
  const cursor = {
    messageId: '507f1f77bcf86cd799439099',
    messageTimestamp: new Date('2026-09-06T12:00:00.000Z'),
  };
  const result = await coordinator.sendRoomClear({ canonicalUsername: 'Nick', room: 'General Chat', cursor });
  assert.deepEqual(sent.map((entry) => entry.token), ['phone-a', 'phone-b']);
  assert.equal(sent.every((entry) => entry.intent.type === 'read-control'), true);
  assert.equal(sent.every((entry) => entry.intent.room === 'General Chat'), true);
  assert.deepEqual(result, { attempted: 2, sent: 2, failed: 0 });
});
```

Add permanent-error and temporary-error variants proving only permanent failures call `retireToken`.

- [ ] **Step 5: Run focused server tests and verify RED**

Run:

```bash
node --test tests/push/push-device-service.test.js tests/push/push-coordinator.test.js tests/push/fcm-transport.test.js
```

Expected: FAIL because account-device enumeration and real `sendRoomClear()` do not exist.

- [ ] **Step 6: Implement active-account enumeration and real `sendRoomClear()`**

Add `listAccountDevices()` using the existing `isStillActive(device)` mobile-session check:

```js
const listAccountDevices = async (username) => {
  const canonicalUsername = canonicalizeUsername(username);
  if (!canonicalUsername) return [];
  const devices = await PushDeviceModel.find({ canonicalUsername, disabledAt: null });
  const active = [];
  for (const device of devices || []) {
    if (await isStillActive(device)) active.push(device);
  }
  return active;
};
```

Implement `sendRoomClear()` by iterating those devices, building `buildReadControlIntent`, calling the same transport boundary, and using the same permanent-token retirement policy already used by `onMessageStored()`. Log only error codes/permanence, never raw FCM tokens.

- [ ] **Step 7: Run focused server tests and verify GREEN**

Run:

```bash
node --test tests/push/push-device-service.test.js tests/push/push-coordinator.test.js tests/push/fcm-transport.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/push/notification-policy.js src/push/push-device-service.js src/push/push-coordinator.js src/push/transports/fcm-transport.js tests/push/push-device-service.test.js tests/push/push-coordinator.test.js tests/push/fcm-transport.test.js
git commit -m "feat: add account read-control push delivery"
```

---

### Task 2: Make every authenticated read path advance one authoritative cursor

**Files:**
- Create: `src/push/read-state-coordinator.js`
- Modify: `index.js` around `/api/read-state/mark`, `/api/read-state`, and `socket.on('message read')`
- Create: `tests/push/read-state-coordinator.test.js`
- Modify: `tests/push/push-http-contract.test.js`

**Interfaces:**
- Consumes: `readStateService.advanceCursor(input)` and `pushCoordinator.sendRoomClear({ canonicalUsername, room, cursor })`.
- Produces: `createReadStateCoordinator({ readStateService, pushCoordinator, logger })` with `advance(input)` and `getCursor(identity)`.
- Contract: `advance()` returns the normal `advanceCursor` result immediately after scheduling best-effort read-control only when `result.advanced === true`.

- [ ] **Step 1: Write the failing coordinator tests**

Create `tests/push/read-state-coordinator.test.js` with three cases:

```js
test('real advancement schedules one read-control with the authoritative cursor', async () => {
  const controls = [];
  const coordinator = createReadStateCoordinator({
    readStateService: {
      advanceCursor: async () => ({ advanced: true, cursor }),
      getCursor: async () => cursor,
    },
    pushCoordinator: {
      sendRoomClear: async (input) => { controls.push(input); },
    },
    logger: { warn() {} },
  });
  const result = await coordinator.advance(input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.advanced, true);
  assert.deepEqual(controls, [{ canonicalUsername: 'nick', room: 'General Chat', cursor }]);
});

test('equal or older cursor does not send read-control', async () => {
  const controls = [];
  const coordinator = createReadStateCoordinator({
    readStateService: {
      advanceCursor: async () => ({ advanced: false, cursor }),
      getCursor: async () => cursor,
    },
    pushCoordinator: { sendRoomClear: async (input) => controls.push(input) },
    logger: { warn() {} },
  });
  await coordinator.advance(input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(controls, []);
});

test('read-control failure cannot fail successful cursor advancement', async () => {
  const coordinator = createReadStateCoordinator({
    readStateService: {
      advanceCursor: async () => ({ advanced: true, cursor }),
      getCursor: async () => cursor,
    },
    pushCoordinator: { sendRoomClear: async () => { throw new Error('FCM down'); } },
    logger: { warn() {} },
  });
  await assert.doesNotReject(() => coordinator.advance(input));
});
```

Use exact 24-character ObjectId strings and ISO timestamps in the fixture.

- [ ] **Step 2: Run the new coordinator test and verify RED**

```bash
node --test tests/push/read-state-coordinator.test.js
```

Expected: FAIL because `src/push/read-state-coordinator.js` does not exist.

- [ ] **Step 3: Implement the read-state coordinator**

Create:

```js
'use strict';

const createReadStateCoordinator = ({ readStateService, pushCoordinator, logger = console } = {}) => {
  if (!readStateService || !pushCoordinator) throw new TypeError('read-state coordinator dependencies are required');

  const advance = async (input = {}) => {
    const result = await readStateService.advanceCursor(input);
    if (result?.advanced === true && result.cursor) {
      void Promise.resolve(pushCoordinator.sendRoomClear({
        canonicalUsername: input.canonicalUsername,
        room: input.room,
        cursor: result.cursor,
      })).catch((error) => {
        logger.warn?.('[Push] read-control dispatch failed', { code: String(error?.code || 'unexpected') });
      });
    }
    return result;
  };

  return {
    advance,
    getCursor: (identity) => readStateService.getCursor(identity),
  };
};

module.exports = { createReadStateCoordinator };
```

- [ ] **Step 4: Write failing integration/static contracts for HTTP and Socket.IO**

Update `tests/push/push-http-contract.test.js` to require:

```js
assert.match(source, /createReadStateCoordinator\s*\(/);
assert.match(source, /app\.post\(['"]\/api\/read-state\/mark['"][\s\S]*readStateCoordinator\.advance/);
assert.match(source, /app\.get\(['"]\/api\/read-state['"][\s\S]*readStateCoordinator\.getCursor/);

const messageRead = handlerSlice('message read', 'edit message');
assert.match(messageRead, /socket\.principal\?\.kind\s*===\s*['"]account['"]/);
assert.match(messageRead, /readStateCoordinator\.advance/);
assert.doesNotMatch(messageRead, /if \(msg\.status === ['"]read['"]\) return;[\s\S]*readStateCoordinator\.advance/);
```

The last assertion prevents global legacy `Message.status` from short-circuiting another account's account-wide cursor advancement.

- [ ] **Step 5: Run focused integration tests and verify RED**

```bash
node --test tests/push/read-state-coordinator.test.js tests/push/push-http-contract.test.js
```

Expected: coordinator unit test passes after Step 3; HTTP/socket contract remains RED until `index.js` is wired.

- [ ] **Step 6: Wire `index.js` to the coordinator without removing legacy delivery receipts**

Instantiate `readStateCoordinator` next to `pushCoordinator`. Change `/api/read-state/mark` to call:

```js
const result = await readStateCoordinator.advance({
  canonicalUsername: req.accountPrincipal.canonicalUsername,
  room,
  messageId: String(persistedMessage._id),
  messageTimestamp: persistedMessage.timestamp,
});
```

Change `/api/read-state` to `readStateCoordinator.getCursor(...)`.

In `socket.on('message read')`, after message/room/deleted validation, advance the account cursor independently of the old global receipt:

```js
if (socket.principal?.kind === 'account') {
  try {
    await readStateCoordinator.advance({
      canonicalUsername: socket.principal.canonicalUsername,
      room: targetRoom,
      messageId: String(msg._id),
      messageTimestamp: msg.timestamp,
    });
  } catch (error) {
    console.warn('[Push] socket read cursor advance failed', { code: String(error?.code || 'unexpected') });
  }
}

const reader = socket.username || '';
if (msg.user !== reader && msg.status !== 'read') {
  msg.status = 'read';
  await msg.save();
  io.to(targetRoom).emit('message status', { id: msg._id, status: 'read' });
}
```

This preserves the old receipt while preventing it from being the account-read authority.

- [ ] **Step 7: Run focused tests and verify GREEN**

```bash
node --test tests/push/read-state-coordinator.test.js tests/push/push-http-contract.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/push/read-state-coordinator.js index.js tests/push/read-state-coordinator.test.js tests/push/push-http-contract.test.js
git commit -m "feat: converge account read-state propagation"
```

---

### Task 3: Add deterministic Android cursor ordering and collision-safe notification identity primitives

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/DizyNotificationCursor.java`
- Create: `android/app/src/main/java/com/chat/dizychat/DizyNotificationIdentity.java`
- Create: `android/app/src/test/java/com/chat/dizychat/DizyNotificationCursorTest.java`
- Create: `android/app/src/test/java/com/chat/dizychat/DizyNotificationIdentityTest.java`
- Modify: `.github/workflows/android-slice1-ci.yml`

**Interfaces:**
- Produces: `DizyNotificationCursor.compare(timestampA, messageIdA, timestampB, messageIdB)` using the same `(timestamp, ObjectId)` ordering as the server.
- Produces: `DizyNotificationIdentity.resolve(String notificationKey, IntFunction<String> ownerLookup)` returning a stable Android integer ID in DizyChat's reserved notification range and probing deterministically when occupied by another key.

- [ ] **Step 1: Write JVM tests first**

`DizyNotificationCursorTest` must prove newer timestamp wins, equal timestamp falls back to lowercase message-id lexical ordering, and equal tuple returns zero:

```java
@Test
public void compareMatchesServerTupleOrdering() {
    assertTrue(DizyNotificationCursor.compare(
            "2026-09-06T12:00:01.000Z", "507f1f77bcf86cd799439099",
            "2026-09-06T12:00:00.000Z", "507f1f77bcf86cd799439099") > 0);
    assertTrue(DizyNotificationCursor.compare(
            "2026-09-06T12:00:00.000Z", "507f1f77bcf86cd79943909a",
            "2026-09-06T12:00:00.000Z", "507f1f77bcf86cd799439099") > 0);
    assertEquals(0, DizyNotificationCursor.compare(
            "2026-09-06T12:00:00.000Z", "507f1f77bcf86cd799439099",
            "2026-09-06T12:00:00.000Z", "507F1F77BCF86CD799439099"));
}
```

`DizyNotificationIdentityTest` must prove deterministic base ID and one-step collision probing:

```java
@Test
public void collisionDoesNotReuseAnotherLogicalNotification() {
    String key = "0123456789abcdef01234567";
    int first = DizyNotificationIdentity.resolve(key, ignored -> null);
    int second = DizyNotificationIdentity.resolve(key, id -> id == first ? "different-key" : null);
    assertNotEquals(first, second);
    assertEquals(second, DizyNotificationIdentity.resolve(key, id -> id == first ? "different-key" : null));
}
```

- [ ] **Step 2: Make Android CI execute JVM tests and verify RED**

Change the Gradle build step to:

```yaml
      - name: Run Android JVM tests and build unsigned debug APK
        working-directory: android
        run: |
          chmod +x gradlew
          ./gradlew testDebugUnitTest assembleDebug --no-daemon
```

Run locally when available:

```bash
cd android && ./gradlew testDebugUnitTest --no-daemon
```

Expected: FAIL because the two Java production classes do not exist.

- [ ] **Step 3: Implement pure Java ordering and identity helpers**

`DizyNotificationCursor.compare()` must normalize message IDs to lowercase and compare canonical server ISO timestamp strings first. Invalid/blank timestamp input throws `IllegalArgumentException` so callers fail safe by retaining a notification instead of guessing it is read.

`DizyNotificationIdentity.resolve()` must derive the base candidate from SHA-256 of `notificationKey`, reserve the high nibble `0x12000000`, use only the lower 28 bits, and linear-probe within that 28-bit range while `ownerLookup` reports a different logical key.

- [ ] **Step 4: Run JVM tests and verify GREEN**

```bash
cd android && ./gradlew testDebugUnitTest --no-daemon
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add android/app/src/main/java/com/chat/dizychat/DizyNotificationCursor.java android/app/src/main/java/com/chat/dizychat/DizyNotificationIdentity.java android/app/src/test/java/com/chat/dizychat/DizyNotificationCursorTest.java android/app/src/test/java/com/chat/dizychat/DizyNotificationIdentityTest.java .github/workflows/android-slice1-ci.yml
git commit -m "test: add Android notification ordering contracts"
```

---

### Task 4: Persist per-room notification state and render MessagingStyle with idempotent read controls

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/DizyNotificationStateStore.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/DizyNotificationManager.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/DizyNotificationActionReceiver.java`
- Create: `tests/android-notification-reconciliation.test.js`
- Modify: `tests/android-push-client.test.js`

**Interfaces:**
- Produces: private per-room state keyed by server `notificationKey`, with at most `MAX_RECENT_MESSAGES = 8` unread entries.
- Produces: `recordMessage(context, room, messageId, sender, preview, notificationKey, timestamp) -> RoomState`.
- Produces: `applyReadCursor(context, room, notificationKey, messageId, timestamp) -> ReconcileResult` where result says `stale`, `cleared`, or `updated` and exposes remaining state when needed.
- Produces: `listRooms(context) -> List<String>` and `clearNotification(context, notificationId)` for successful notification Mark-as-read.
- Consumes: `DizyNotificationCursor` and `DizyNotificationIdentity` from Task 3.

- [ ] **Step 1: Write deterministic source/native contracts first**

Create `tests/android-notification-reconciliation.test.js` to require:

```js
const store = read('android/app/src/main/java/com/chat/dizychat/DizyNotificationStateStore.java');
assert.match(store, /MAX_RECENT_MESSAGES\s*=\s*8/);
assert.match(store, /notificationKey/);
assert.match(store, /latestMessageId/);
assert.match(store, /latestTimestamp/);
assert.match(store, /readMessageId/);
assert.match(store, /readTimestamp/);
assert.match(store, /DizyNotificationIdentity\.resolve/);
assert.match(store, /DizyNotificationCursor\.compare/);
assert.doesNotMatch(store, /Bearer|sessionToken|password/i);

const manager = read('android/app/src/main/java/com/chat/dizychat/DizyNotificationManager.java');
assert.match(manager, /NotificationCompat\.MessagingStyle/);
assert.match(manager, /DizyNotificationStateStore\.recordMessage/);
assert.match(manager, /applyReadControl/);
assert.doesNotMatch(manager, /notificationKey\.hashCode\(\)/);

const service = read('android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java');
assert.match(service, /read-control/);
assert.match(service, /applyReadControl/);
```

Update the existing PR B test to expect `MessagingStyle` instead of the old private `notificationId(identity)` hash-code function.

- [ ] **Step 2: Run deterministic native contracts and verify RED**

```bash
node --test tests/android-notification-reconciliation.test.js tests/android-push-client.test.js
```

Expected: FAIL because the state store/read-control/MessagingStyle path does not exist.

- [ ] **Step 3: Implement durable state storage**

Use a dedicated private SharedPreferences namespace such as `dizychat_notification_state_v1`. Persist JSON room records with only:

```json
{
  "notificationKey": "0123456789abcdef01234567",
  "notificationId": 301989889,
  "room": "General Chat",
  "latestMessageId": "507f1f77bcf86cd799439099",
  "latestTimestamp": "2026-09-06T12:00:00.000Z",
  "readMessageId": "",
  "readTimestamp": "",
  "messages": [
    {
      "messageId": "507f1f77bcf86cd799439099",
      "sender": "Rob",
      "preview": "hello",
      "timestamp": "2026-09-06T12:00:00.000Z"
    }
  ]
}
```

Persist both logical-key-to-ID and ID-to-logical-key ownership so `DizyNotificationIdentity.resolve()` can probe without reusing another room's ID. On corrupt JSON, remove only that room record/mapping.

`applyReadCursor()` must first reject a control whose tuple is <= the last applied read tuple. Then remove only entries whose `(timestamp, messageId)` tuple is <= the control tuple. If no entries remain, return the notification ID to cancel and remove the room record; otherwise update the state and preserve newer entries.

- [ ] **Step 4: Upgrade notification rendering and FCM dispatch**

In `DizyFirebaseMessagingService.onMessageReceived()`:

```java
String type = clean(data.get("type"));
if ("read-control".equals(type)) {
    DizyNotificationManager.applyReadControl(
            this,
            clean(data.get("room")),
            clean(data.get("messageId")),
            clean(data.get("notificationKey")),
            clean(data.get("timestamp"))
    );
    return;
}
```

Treat blank/`message` type as ordinary message for compatibility with any queued pre-PR-C payload.

In `DizyNotificationManager.showMessageNotification()`, record the message before rendering and build:

```java
NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle("You");
style.setConversationTitle(state.room);
for (DizyNotificationStateStore.Entry entry : state.messages) {
    style.addMessage(entry.preview, parseDisplayTime(entry.timestamp), entry.sender);
}
```

The content intent, Reply action, and Mark-as-read action must target `state.latestMessageId`; the notification ID must come from persisted state rather than `String.hashCode()`.

`applyReadControl()` cancels only the reconciled room when `cleared == true`; when newer entries remain, rebuild that same room notification using the surviving latest entry/actions.

- [ ] **Step 5: Make successful notification Mark-as-read remove matching local state**

Change the action receiver's successful Mark-as-read path from a raw `cancel(notificationId)` to a manager method that cancels the notification and removes the persisted room state for that notification ID. Keep Reply behaviour unchanged unless required by an observed test failure.

- [ ] **Step 6: Run deterministic contracts and Android JVM/build checks**

```bash
npm test
cd android && ./gradlew testDebugUnitTest assembleDebug --no-daemon
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add android/app/src/main/java/com/chat/dizychat/DizyNotificationStateStore.java android/app/src/main/java/com/chat/dizychat/DizyNotificationManager.java android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java android/app/src/main/java/com/chat/dizychat/DizyNotificationActionReceiver.java tests/android-notification-reconciliation.test.js tests/android-push-client.test.js
git commit -m "feat: reconcile durable Android room notifications"
```

---

### Task 5: Reconcile persisted notifications against authoritative server cursors on startup, reconnect, and foreground return

**Files:**
- Modify: `android/app/src/main/java/com/chat/dizychat/DizyPushPlugin.java`
- Modify: `public/mobile-push-runtime.js`
- Modify: `tests/android-push-client.test.js`
- Modify: `tests/android-notification-reconciliation.test.js`

**Interfaces:**
- Produces Capacitor `DizyPush.listNotificationRooms() -> { rooms: string[] }`.
- Produces Capacitor `DizyPush.applyReadCursor({ room, messageId, messageTimestamp }) -> { cleared: boolean }`.
- Produces JS `controller.reconcileNotifications() -> Promise<void>`.

- [ ] **Step 1: Extend the native JS harness with failing reconciliation tests**

Update `createNativeHarness()` with:

```js
listNotificationRooms: async () => ({ rooms: ['General Chat', 'Other Room'] }),
applyReadCursor: async (payload) => { pluginCalls.push(['applyReadCursor', payload]); return { cleared: true }; },
```

Teach the fake `fetch` to accept GET requests without trying to parse an absent body. Add a test:

```js
test('startup reconciliation fetches account read cursors and applies them natively', async () => {
  const harness = createNativeHarness();
  harness.win.fetch = async (url, init = {}) => {
    harness.fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        cursor: {
          room: url.includes('Other%20Room') ? 'Other Room' : 'General Chat',
          messageId: '507f1f77bcf86cd799439099',
          messageTimestamp: '2026-09-06T12:00:00.000Z',
        },
      }),
    };
  };
  const controller = createPushController(harness.win, {
    backendOrigin: 'https://backend.example',
    auth: harness.win.dizychatAuthV2,
  });
  await controller.onChatReady();
  const gets = harness.fetchCalls.filter((call) => call.init.method === 'GET');
  assert.equal(gets.length, 2);
  assert.equal(gets.every((call) => call.init.headers.Authorization === 'Bearer mobile-bearer'), true);
  assert.equal(harness.pluginCalls.filter(([name]) => name === 'applyReadCursor').length, 2);
});
```

Add cases proving missing bearer and failed GET retain notifications by making zero `applyReadCursor` calls.

- [ ] **Step 2: Run runtime tests and verify RED**

```bash
node --test tests/android-push-client.test.js tests/android-notification-reconciliation.test.js
```

Expected: FAIL because the plugin methods and `reconcileNotifications()` do not exist.

- [ ] **Step 3: Add the two minimal Capacitor methods**

`listNotificationRooms` delegates to `DizyNotificationStateStore.listRooms(getContext())` and returns a JS array.

`applyReadCursor` validates non-empty room/messageId/messageTimestamp, delegates to `DizyNotificationManager.applyReadControl(...)`, and resolves `{ cleared: boolean }`. It must not accept or persist auth material.

- [ ] **Step 4: Add authenticated GET support and reconciliation to `mobile-push-runtime.js`**

Add a GET helper using the same backend origin and bearer:

```js
const get = async (path) => {
  const bearer = readBearer();
  if (!native || !bearer || typeof fetchImpl !== 'function') return null;
  const response = await fetchImpl(endpoint(path), {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!response?.ok) return null;
  return response.json();
};
```

Implement:

```js
const reconcileNotifications = async () => {
  if (!native || !readBearer()) return;
  await configure();
  const listed = await plugin.listNotificationRooms();
  for (const rawRoom of listed?.rooms || []) {
    const room = clean(rawRoom);
    if (!room) continue;
    try {
      const state = await get(`/api/read-state?room=${encodeURIComponent(room)}`);
      const cursor = state?.cursor;
      if (!cursor?.messageId || !cursor?.messageTimestamp) continue;
      await plugin.applyReadCursor({
        room,
        messageId: clean(cursor.messageId),
        messageTimestamp: String(cursor.messageTimestamp),
      });
    } catch (error) {
      win.console?.warn?.('[DizyChat] notification reconciliation failed', { room, error });
    }
  }
};
```

Call it from `onChatReady()`, after successful `onRoomJoined()`, from the decorated socket's `connect` event, and when `visibilitychange` returns to `visible`. Each trigger must be idempotent and failures must not clear local notifications.

- [ ] **Step 5: Run runtime/native contract tests and verify GREEN**

```bash
node --test tests/android-push-client.test.js tests/android-notification-reconciliation.test.js
```

Expected: PASS.

- [ ] **Step 6: Run full deterministic suite before committing**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add android/app/src/main/java/com/chat/dizychat/DizyPushPlugin.java public/mobile-push-runtime.js tests/android-push-client.test.js tests/android-notification-reconciliation.test.js
git commit -m "feat: reconcile Android notifications on reconnect"
```

---

### Task 6: Add final Slice 2 integration regressions without reimplementing PR B

**Files:**
- Modify: `tests/push/message-push-integration.test.js`
- Modify: `tests/push/push-http-contract.test.js`
- Modify: `tests/android-notification-reconciliation.test.js`
- Modify: `tests/android-push-client.test.js`

**Interfaces:**
- Verifies the composed contracts produced by Tasks 1-5; no new production interface is introduced.

- [ ] **Step 1: Add final server integration cases**

Prove:

```js
// A temporary read-control FCM failure does not change the successful read result.
assert.equal(result.advanced, true);
assert.deepEqual(retired, []);

// A permanent read-control failure retires only its bad token.
assert.deepEqual(retired, [
  { token: 'bad-phone', reason: 'messaging/registration-token-not-registered' },
]);

// Disabled/null transport still permits ordinary chat persistence and read advancement.
assert.equal(savedMessages.length, 1);
assert.equal(readResult.advanced, true);
```

Keep these tests against the focused services/helpers rather than booting live Firebase.

- [ ] **Step 2: Add final native source/runtime cases**

Require the final contracts:

```js
assert.match(notificationSource, /MessagingStyle/);
assert.match(notificationSource, /MAX_RECENT_MESSAGES/);
assert.match(notificationSource, /latestMessageId/);
assert.match(firebaseServiceSource, /read-control/);
assert.match(pluginSource, /listNotificationRooms/);
assert.match(pluginSource, /applyReadCursor/);
assert.doesNotMatch(javaSources, /BEGIN PRIVATE KEY|firebase-adminsdk|MONGO_URI|METADEFENDER_API_KEY/);
assert.doesNotMatch(javaSources, /https:\/\/dizychat\.com/i);
```

The JS harness must also prove browser mode still performs zero push/reconciliation network calls.

- [ ] **Step 3: Run the whole deterministic suite**

```bash
npm test
```

Expected: PASS with every existing Slice 1, PR A, PR B, and new PR C contract green.

- [ ] **Step 4: Run Android JVM tests and build locally where available**

```bash
npm run android:prepare
npx cap sync android
cd android
./gradlew testDebugUnitTest assembleDebug --no-daemon
```

Expected: JVM tests PASS and `android/app/build/outputs/apk/debug/app-debug.apk` exists.

- [ ] **Step 5: Review branch diff for temporary tooling or scope leakage**

Run:

```bash
git diff --stat 0806a77b36268a8850747ff1abe5ec3f56984f17...HEAD
git diff --name-only 0806a77b36268a8850747ff1abe5ec3f56984f17...HEAD
```

Expected: only PR C spec/plan, focused server push/read files, focused native notification files/tests, `mobile-push-runtime.js`, `index.js`, and the Android CI workflow. No Firebase credential file, no `google-services.json`, no temporary workflow/patcher, and no unrelated chat/UI refactor.

- [ ] **Step 6: Commit final regression additions**

```bash
git add tests/push/message-push-integration.test.js tests/push/push-http-contract.test.js tests/android-notification-reconciliation.test.js tests/android-push-client.test.js
git commit -m "test: complete Android Slice 2 regressions"
```

---

### Task 7: Exact-head CI gate, APK artifact proof, and merge boundary

**Files:**
- No production files unless a failing exact-head check proves a specific contract defect.

**Interfaces:**
- Produces the exact final PR head SHA accepted for merge.

- [ ] **Step 1: Push the complete PR C candidate and record exact HEAD**

Run:

```bash
git rev-parse HEAD
```

Record that SHA in the PR status update. Any later patch invalidates the previous green gate.

- [ ] **Step 2: Require Android Slice 1 CI green on that exact SHA**

Required successful steps:

```text
Install dependencies
Run deterministic tests
Prepare packaged Android assets
Sync Capacitor Android project
Run Android JVM tests and build unsigned debug APK
Upload debug APK
```

If the workflow remains split into separate test/build steps after implementation, require every Android job step to be green and the debug APK artifact to exist.

- [ ] **Step 3: Require DizyChat Self-Host CI green on the same exact SHA**

Required successful steps:

```text
Verify self-host configuration
Smoke test self-hosted LiveKit
Install browser test runtime
Start isolated local DizyChat
Run local UI smoke test
Run mobile shell regression
Run registered account navigation regression
Upload UI artifacts
```

- [ ] **Step 4: Verify the uploaded APK artifact belongs to that exact workflow run/head**

Confirm the Android run's `head_sha` equals the final PR head, then fetch the `dizychat-android-debug-apk` artifact. Do not call an APK final if it came from an earlier SHA.

- [ ] **Step 5: Final PR review before merge**

Confirm:

```text
PR remains scoped to Slice 2 PR C.
No live Firebase/server credential is present.
Reply/tap/Mark-as-read still use PR B authenticated paths.
No browser-only behaviour regressed.
All final-head CI checks are green.
```

- [ ] **Step 6: Merge only after explicit user authorization**

Mark the PR ready for review only after the exact-head gate is green. Merge with the connector's expected-head SHA protection so a moved branch cannot be merged accidentally. After merge, fetch `main` and verify it points to the returned merge commit.
