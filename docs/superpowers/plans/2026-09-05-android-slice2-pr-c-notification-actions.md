# Android Slice 2 PR C — Notification UX and Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one updating Android notification per room while the app is backgrounded/locked/killed, route taps to the exact room/message, support inline Reply and Mark as read through DizyChat's normal authenticated server semantics, and clear stale room notifications when the account reads elsewhere.

**Architecture:** Send high-priority **data-only** FCM messages and replace Capacitor's default Android `FirebaseMessagingService` manifest entry with one DizyChat service so killed-app delivery can render custom notifications/actions deterministically. The custom service forwards token/message events into the Capacitor PushNotifications plugin where appropriate, while DizyChat native classes own notification rendering, action intents, local notification metadata, and local clearing. Background Reply/Mark-read read the existing Keystore-backed mobile token through a shared `SecureSessionStore`, read the configured backend URL/device ID from private native preferences populated by `mobile-push.js`, and call authenticated DizyChat endpoints. FCM payloads contain routing/display hints only.

**Tech Stack:** Firebase Cloud Messaging data messages, Capacitor PushNotifications 7.0.3, Android `FirebaseMessagingService`, AndroidX `NotificationCompat.MessagingStyle`, `RemoteInput`, BroadcastReceiver, Android Keystore, Java `HttpURLConnection`, Node/Express/Socket.IO/Mongoose.

**Spec:** `docs/superpowers/specs/2026-09-05-android-slice2-push-design.md`

## Global Constraints

- Start PR C from the exact merged/green head of PR B.
- FCM is courier only: Reply/Mark-read/open-room authorization is rechecked by DizyChat.
- FCM payloads contain no mobile-session token, FCM token, canonical username, room password, service-account credential, Mongo credential, or signing secret.
- Use data-only high-priority FCM so native DizyChat code controls one-per-room notification identity, custom actions, and killed-app behaviour.
- Remove Capacitor's manifest `MessagingService` before adding `DizyChatMessagingService`; there must be exactly one active `com.google.firebase.MESSAGING_EVENT` service in the merged manifest.
- Preserve Capacitor token registration by forwarding `onNewToken()` to `PushNotificationsPlugin.onNewToken(token)`; app initialization still calls `register()` and therefore recovers the current token if a rotation happened while the WebView was absent.
- Preserve JS push observability by forwarding received messages to `PushNotificationsPlugin.sendRemoteMessage(remoteMessage)` after DizyChat native handling.
- One notification per room uses a server-generated opaque `notificationKey`.
- Inline Reply creates the same normal DizyChat message/reply snapshot as in-app reply and passes through the same Socket.IO publication + push dispatch helper.
- Mark as read advances account+room read state; local dismissal occurs only after successful server authorization or authoritative `read-clear` control.
- Browser mere presence does not clear notifications; an actual existing `message read` event does.
- A notification tap cannot bypass room access. The only passwordless native rejoin is an authenticated same-session/same-device active push subscription created by a prior successful room admission.
- Notification channel sound/vibration stays under normal Android user control.
- Use TDD and focused commits.

---

## File Structure

**Create**

- `src/messages/message-service.js` — shared normal message creation/sanitization/reply snapshot logic.
- `src/push/notification-actions-service.js` — open-target, Reply, Mark-read, and reconcile authorization.
- `android/app/src/main/java/com/chat/dizychat/SecureSessionStore.java` — shared Keystore session storage extracted without format change.
- `android/app/src/main/java/com/chat/dizychat/DizyChatPushConfigStore.java` — private native configured backend origin + stable device ID.
- `android/app/src/main/java/com/chat/dizychat/DizyChatMessagingService.java` — sole FCM service.
- `android/app/src/main/java/com/chat/dizychat/DizyChatNotificationManager.java` — room notification channel/history/intents/cancel helpers.
- `android/app/src/main/java/com/chat/dizychat/DizyChatNotificationActionReceiver.java` — background Reply/Mark-read HTTP action worker.
- `android/app/src/main/java/com/chat/dizychat/NotificationBridgePlugin.java` — configure native context, cold/warm tap bridge, active notification list/clear methods.
- `android/app/src/main/res/drawable/ic_stat_dizychat.xml` — monochrome status-bar icon.
- `tests/push/message-service-reply.test.js`
- `tests/push/notification-actions-service.test.js`
- `tests/push/fcm-data-payload.test.js`
- `tests/push/read-clear-reconcile.test.js`
- `tests/android-notification-native-contract.test.js`
- `tests/android-notification-routing.test.js`

**Modify**

- `src/push/transports/fcm-transport.js` — high-priority data-only message/control payloads.
- `src/push/notification-policy.js` — opaque account+room notification key.
- `src/push/push-coordinator.js` — account-device read-clear control sending.
- `src/push/push-device-service.js` — `listUserDevices(canonicalUsername)` for authoritative read-clear fan-out.
- `index.js` — shared publication helper, action endpoints, subscribed-device rejoin, account read advancement/clear controls.
- `android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java` — delegate to shared store with unchanged JS contract.
- `android/app/src/main/java/com/chat/dizychat/MainActivity.java` — register `NotificationBridgePlugin`.
- `android/app/src/main/AndroidManifest.xml` — remove plugin FCM service; register DizyChat FCM service/action receiver.
- `public/mobile-push.js` — configure bridge, queue/dispatch tap actions, startup reconcile, local clear handling.
- `public/chat.js` — register exact-target navigation handler and make existing read observer require visible document.
- `docs/android-private-apk.md` — final Slice 2 acceptance procedure/result boundary.

---

### Task 1: Extract Shared Message Creation and Publication Without Behaviour Drift

**Files:**
- Create: `src/messages/message-service.js`
- Modify: `index.js`
- Test: `tests/push/message-service-reply.test.js`

**Interfaces:**
- `createMessageService({ MessageModel, mongoose, sanitizeHtml, now })`
- `createRoomMessage({ principal, room, text, fileUrl, fileType, fileName, replyTo, timestamp }) -> saved Message`
- `principal.username` is always the persisted sender display identity; callers cannot supply another `user`.
- `publishAcceptedMessage(savedMessage, { senderCanonicalUsername })` remains in `index.js` and is shared by Socket.IO messages and notification Reply. It emits the normal room message, preserves existing delivery-status update/event, then fire-and-forgets `pushCoordinator.onMessageStored(...)`.

- [ ] **Step 1: Write RED parity tests from the current message handler**

```js
test('normal reply persists the current sanitized reply snapshot contract', async () => {
  const target = {
    _id: '507f1f77bcf86cd799439011', room: 'ShittyChat', user: 'Nick',
    text: '<b>original</b>', fileUrl: '/uploads/a.png', fileType: 'image/png', fileName: '<i>a.png</i>', deleted: false,
  };
  const model = makeMessageModel({ target });
  const service = createMessageService({ MessageModel: model, mongoose, sanitizeHtml, now: () => new Date('2026-09-05T20:00:00Z') });
  const saved = await service.createRoomMessage({
    principal: { kind: 'account', username: 'Rob', canonicalUsername: 'rob' },
    room: 'ShittyChat', text: 'reply', replyTo: target._id,
  });
  assert.equal(String(saved.replyTo), target._id);
  assert.equal(saved.replyToSnapshot.user, 'Nick');
  assert.equal(saved.replyToSnapshot.text, 'original');
  assert.equal(saved.replyToSnapshot.fileName, 'a.png');
});

test('reply target from another room is ignored exactly like current chat behaviour', async () => {
  const target = { _id: '507f1f77bcf86cd799439011', room: 'OtherRoom', user: 'Nick', text: 'original' };
  const model = makeMessageModel({ target });
  const service = createMessageService({ MessageModel: model, mongoose, sanitizeHtml });
  const saved = await service.createRoomMessage({
    principal: { kind: 'account', username: 'Rob', canonicalUsername: 'rob' },
    room: 'ShittyChat', text: 'reply', replyTo: target._id,
  });
  assert.equal(saved.replyTo ?? null, null);
  assert.equal(saved.replyToSnapshot ?? null, null);
});

test('registered principal cannot spoof sender display name', async () => {
  const saved = await service.createRoomMessage({
    principal: { kind: 'account', username: 'Rob', canonicalUsername: 'rob' }, room: 'ShittyChat', text: 'hello',
  });
  assert.equal(saved.user, 'Rob');
});
```

Add exact tests for text max 1000 + HTML stripping, file URL allowlist (`http(s)` or `/` only), fileType max 100, fileName sanitize/max 120, reply text snapshot max 240, reply fileName snapshot max 120, deleted snapshot flag, and client timestamp preservation for the existing Socket.IO path.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/message-service-reply.test.js
```

- [ ] **Step 3: Implement shared service by moving current rules verbatim**

Core reply block:

```js
let replyToDocId = null;
let replyToSnapshot = null;
const replyId = String(replyTo || '').trim();
if (replyId && mongoose.Types.ObjectId.isValid(replyId)) {
  const target = await MessageModel.findById(replyId).lean();
  if (target && String(target.room) === room) {
    replyToDocId = target._id;
    replyToSnapshot = {
      id: String(target._id),
      user: target.user || 'Anon',
      text: sanitizeHtml(String(target.text || ''), { allowedTags: [], allowedAttributes: {} }).slice(0, 240),
      fileUrl: target.fileUrl || '',
      fileType: target.fileType || '',
      fileName: sanitizeHtml(String(target.fileName || ''), { allowedTags: [], allowedAttributes: {} }).slice(0, 120),
      deleted: Boolean(target.deleted),
    };
  }
}
```

Persist sender as `principal.username`; do not accept a separate `user` argument.

- [ ] **Step 4: Extract one publication helper in `index.js`**

```js
const publishAcceptedMessage = async (savedMessage, { senderCanonicalUsername = '' } = {}) => {
  const roomName = normaliseRoomName(savedMessage.room);
  io.to(roomName).emit('chat message', savedMessage);
  if (savedMessage.status !== 'delivered') {
    await Message.findByIdAndUpdate(savedMessage._id, { status: 'delivered' });
    savedMessage.status = 'delivered';
  }
  io.to(roomName).emit('message status', { id: savedMessage._id, status: 'delivered' });
  void pushCoordinator.onMessageStored(
    savedMessage.toJSON ? savedMessage.toJSON() : savedMessage,
    { senderCanonicalUsername }
  ).catch((error) => console.warn('[Push] post-message dispatch failed', { code: error?.code || 'unexpected' }));
};
```

Change the current `socket.on('chat message')` path to call `createRoomMessage()` then this helper with:

```js
const senderCanonicalUsername = socket.principal?.kind === 'account'
  ? String(socket.principal.canonicalUsername || '')
  : '';
```

Do not use `socket.data.principal`; this repo stores the authenticated principal on `socket.principal`.

- [ ] **Step 5: Run GREEN + full regression and commit**

```bash
node --test tests/push/message-service-reply.test.js tests/push/message-push-integration.test.js
npm test
git add src/messages/message-service.js index.js tests/push/message-service-reply.test.js
git commit -m "refactor: share normal message creation and publication"
```

---

### Task 2: Add Server Notification Action Authorization

**Files:**
- Create: `src/push/notification-actions-service.js`
- Modify: `index.js`
- Test: `tests/push/notification-actions-service.test.js`

**Interfaces:**
- `openTarget({ session, deviceId, room, messageId })`
- `reply({ session, deviceId, room, messageId, text })`
- `markRead({ session, room, messageId })`
- `reconcile({ session, deviceId, active })`
- `openTarget` and `reply` require same mobile session + same device + active room subscription.
- `markRead` requires authenticated account identity plus target-message/room consistency; it does not trust local notification state.

- [ ] **Step 1: Write RED authorization tests using real-shape ObjectId strings**

```js
const MESSAGE_ID = '507f1f77bcf86cd799439011';

test('openTarget rejects another device even on same account', async () => {
  await assert.rejects(
    () => service.openTarget({ session: mobileSession('s1', 'rob'), deviceId: 'dev2', room: 'ShittyChat', messageId: MESSAGE_ID }),
    (error) => error.code === 'NOT_SUBSCRIBED'
  );
});

test('notification reply creates a normal reply through shared message service', async () => {
  const saved = await service.reply({ session: mobileSession('s1', 'rob'), deviceId: 'dev1', room: 'ShittyChat', messageId: MESSAGE_ID, text: 'yep' });
  assert.equal(String(saved.replyTo), MESSAGE_ID);
  assert.equal(saved.text, 'yep');
  assert.equal(saved.user, 'Rob');
});
```

Add tests for revoked/missing mobile session, target message in another room, removed subscription after Leave, empty/whitespace reply, reply >1000 characters, and zero persistence/publication on authorization failure.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/notification-actions-service.test.js
```

- [ ] **Step 3: Implement subscribed-device assertion and target loading**

```js
const assertSubscribedDevice = async ({ session, deviceId, room }) => {
  if (session?.kind !== 'mobile' || !session.sessionId || !session.principal?.canonicalUsername) throw coded('AUTH_REQUIRED');
  const subscription = await pushDeviceService.findActiveSubscription({
    sessionId: session.sessionId,
    deviceId: String(deviceId || '').trim(),
    room,
  });
  if (!subscription) throw coded('NOT_SUBSCRIBED');
  return subscription;
};
```

Every action loads `Message.findById(messageId)`, validates ObjectId and `message.room === room`, and rejects missing/deleted target where appropriate.

`reply()` trims/sanitizes text through `messageService.createRoomMessage()` and returns the saved message. The HTTP endpoint, not the service, calls `publishAcceptedMessage(saved, { senderCanonicalUsername: session.principal.canonicalUsername })` exactly once.

- [ ] **Step 4: Add authenticated endpoints**

```text
POST /api/mobile/push/open-target  { deviceId, room, messageId }
POST /api/mobile/push/reply        { deviceId, room, messageId, text }
POST /api/mobile/push/reconcile    { deviceId, active: [{ notificationKey, room, messageId }] }
```

All require PR A `requireHttpMobileAccount()`. Keep `/api/read-state/mark` as the single Mark-read endpoint from PR A; route it through the same `advanceAccountRoomRead()` helper introduced in Task 9 below.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test tests/push/notification-actions-service.test.js tests/push/message-service-reply.test.js
npm test
git add src/push/notification-actions-service.js index.js tests/push/notification-actions-service.test.js
git commit -m "feat: authorize notification actions"
```

---

### Task 3: Make FCM Payloads Data-Only, High-Priority, and Room-Stable

**Files:**
- Modify: `src/push/transports/fcm-transport.js`
- Modify: `src/push/notification-policy.js`
- Test: `tests/push/fcm-data-payload.test.js`

**Interfaces:**
- Chat data: `type`, `room`, `messageId`, `sender`, `preview`, `notificationKey`, `timestamp` — all strings.
- Clear data: `type=read-clear`, `room`, `notificationKey`, `throughMessageId` — all strings.
- `notificationKey = sha256(canonicalUsername + "\0" + room).digest('hex').slice(0, 24)`; canonical username itself is never sent.

- [ ] **Step 1: Write RED payload tests**

```js
test('chat push is high-priority data-only', async () => {
  await transport.send(intent, 'fcm-token');
  assert.equal(captured.notification, undefined);
  assert.equal(captured.android.priority, 'high');
  assert.equal(captured.android.collapseKey, intent.notificationKey);
  assert.equal(captured.data.type, 'chat-message');
  assert.equal(captured.data.notificationKey, intent.notificationKey);
  assert.ok(Object.values(captured.data).every((value) => typeof value === 'string'));
});
```

Serialize payload and assert forbidden field names/values are absent: `sessionToken`, `fcmToken`, `canonicalUsername`, `private_key`, `roomPassword`, Mongo URI.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/fcm-data-payload.test.js tests/push/fcm-transport.test.js
```

- [ ] **Step 3: Implement exact data message**

```js
const message = {
  token,
  data: {
    type: 'chat-message',
    room: String(intent.room),
    messageId: String(intent.messageId),
    sender: String(intent.sender),
    preview: String(intent.preview),
    notificationKey: String(intent.notificationKey),
    timestamp: String(intent.timestamp),
  },
  android: { priority: 'high', collapseKey: String(intent.notificationKey) },
};
```

`sendControl()` produces high-priority `read-clear` data with the same room notification key.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test tests/push/fcm-data-payload.test.js tests/push/fcm-transport.test.js
git add src/push/transports/fcm-transport.js src/push/notification-policy.js tests/push/fcm-data-payload.test.js
git commit -m "feat: send DizyChat data-only push payloads"
```

---

### Task 4: Extract SecureSessionStore Without Changing Existing Encrypted Session Format

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/SecureSessionStore.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java`
- Test: `tests/android-secure-session.test.js`
- Test: `tests/android-notification-native-contract.test.js`

**Interface:** shared native store must preserve:
- Keystore: `AndroidKeyStore`
- alias: `dizychat.mobile.session.v1`
- prefs: `dizychat_secure_session_v1`
- keys: `iv`, `ciphertext`
- cipher: `AES/GCM/NoPadding`
- generated encryption IV

- [ ] **Step 1: Add RED source-contract tests**

```js
test('shared store preserves the current secure-session format', () => {
  const store = fs.readFileSync('android/app/src/main/java/com/chat/dizychat/SecureSessionStore.java', 'utf8');
  assert.match(store, /AndroidKeyStore/);
  assert.match(store, /dizychat\.mobile\.session\.v1/);
  assert.match(store, /dizychat_secure_session_v1/);
  assert.match(store, /AES\/GCM\/NoPadding/);
  assert.match(store, /cipher\.getIV\(\)/);
});

test('SecureSessionPlugin delegates to SecureSessionStore', () => {
  const plugin = fs.readFileSync('android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java', 'utf8');
  assert.match(plugin, /new SecureSessionStore\(getContext\(\)\)/);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-secure-session.test.js tests/android-notification-native-contract.test.js
```

- [ ] **Step 3: Move current crypto/prefs implementation verbatim into store**

Expose `readToken()`, `writeToken(String)`, and `clearToken()`. Keep plugin JS method names and rejection messages unchanged. Do not rotate alias/keys or migrate storage.

- [ ] **Step 4: Run GREEN + Java compile and commit**

```bash
node --test tests/android-secure-session.test.js tests/android-notification-native-contract.test.js
cd android && ./gradlew compileDebugJavaWithJavac --no-daemon
git add android/app/src/main/java/com/chat/dizychat/SecureSessionStore.java android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java tests/android-secure-session.test.js tests/android-notification-native-contract.test.js
git commit -m "refactor: share secure Android session store"
```

---

### Task 5: Add Native Push Config Store and Cold/Warm Notification Bridge

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/DizyChatPushConfigStore.java`
- Create: `android/app/src/main/java/com/chat/dizychat/NotificationBridgePlugin.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/MainActivity.java`
- Modify: `public/mobile-push.js`
- Test: `tests/android-notification-native-contract.test.js`
- Test: `tests/android-notification-routing.test.js`

**Interfaces:**
- `NotificationBridge.configure({ backendUrl, deviceId })`
- `notificationAction` retained event `{ action: 'tap', room, messageId }`
- `getActiveRoomNotifications() -> [{ notificationKey, room, messageId }]`
- `clearRoomNotification({ notificationKey })`
- `mobile-push.js` owns a pending-action queue until `chat.js` registers a navigation handler.

- [ ] **Step 1: Write RED bridge/config/queue tests**

```js
test('mobile push configures bridge from existing resolved backend', async () => {
  await push.initialize();
  assert.deepEqual(configureCalls[0], {
    backendUrl: 'https://configured.example',
    deviceId: push.getDeviceId(),
  });
});

test('cold-start tap is queued until chat navigation handler exists', async () => {
  await push.handleNativeAction({ action: 'tap', room: 'ShittyChat', messageId: '507f1f77bcf86cd799439011' });
  assert.equal(openCalls.length, 0);
  push.setOpenTargetHandler((target) => openCalls.push(target));
  assert.equal(openCalls[0].messageId, '507f1f77bcf86cd799439011');
});
```

Native source test asserts configure accepts only HTTPS backend with host and stores only `backend_origin` + `device_id` in private prefs.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-notification-native-contract.test.js tests/android-notification-routing.test.js
```

- [ ] **Step 3: Implement native config store**

Use `Uri.parse()`, require scheme `https` and non-empty host; expose `getBackendOrigin()` and `getDeviceId()` to native classes. Never accept/store token/service credentials.

- [ ] **Step 4: Implement bridge plugin cold/warm tap capture**

`load()` inspects `getActivity().getIntent()`. Override `handleOnNewIntent(Intent)` and emit retained event when extras contain:

```text
dizychat_action=tap
dizychat_room=<room>
dizychat_message_id=<24-char ObjectId>
```

Clear/replace consumed intent extras so re-creating the WebView does not replay the same tap forever.

- [ ] **Step 5: Implement JS queue**

`mobile-push.js`:

```js
let openTargetHandler = null;
const pendingActions = [];
const setOpenTargetHandler = (handler) => {
  openTargetHandler = typeof handler === 'function' ? handler : null;
  if (!openTargetHandler) return;
  while (pendingActions.length) void openTargetHandler(pendingActions.shift());
};
const handleNativeAction = async (action) => {
  if (action?.action !== 'tap') return false;
  const target = { room: String(action.room || ''), messageId: String(action.messageId || ''), deviceId: getDeviceId() };
  if (!openTargetHandler) { pendingActions.push(target); return true; }
  await openTargetHandler(target);
  return true;
};
```

Configure bridge with backend from `window.dizychatMobileRuntime.resolveBackendOrigin(window, window.dizychatConfig)`. Do not add another `https://dizychat.com` literal.

- [ ] **Step 6: Register plugin, run GREEN/compile, commit**

```bash
node --test tests/android-notification-native-contract.test.js tests/android-notification-routing.test.js
cd android && ./gradlew compileDebugJavaWithJavac --no-daemon
git add android/app/src/main/java/com/chat/dizychat/DizyChatPushConfigStore.java android/app/src/main/java/com/chat/dizychat/NotificationBridgePlugin.java android/app/src/main/java/com/chat/dizychat/MainActivity.java public/mobile-push.js tests/android-notification-native-contract.test.js tests/android-notification-routing.test.js
git commit -m "feat: bridge native notification routing"
```

---

### Task 6: Install One DizyChat FirebaseMessagingService and Render One Room Notification

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/DizyChatMessagingService.java`
- Create: `android/app/src/main/java/com/chat/dizychat/DizyChatNotificationManager.java`
- Create: `android/app/src/main/res/drawable/ic_stat_dizychat.xml`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `tests/android-notification-native-contract.test.js`

**Interfaces:**
- Sole active FCM service `.DizyChatMessagingService`.
- Channel ID `dizychat_messages_v1`.
- Notification tag `dizychat-room:<notificationKey>`, integer ID `1`.
- Persist latest 5 `{ sender, preview, timestamp, messageId }` lines per notification key in private prefs.

- [ ] **Step 1: Write RED manifest/service tests**

Assert source includes one `DizyChatMessagingService`, plugin service removal node, `PushNotificationsPlugin.onNewToken`, `PushNotificationsPlugin.sendRemoteMessage`, `NotificationCompat.MessagingStyle`, and `notify("dizychat-room:" + notificationKey, 1, ...)`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-notification-native-contract.test.js
```

- [ ] **Step 3: Override plugin service in manifest**

Add tools namespace and removal:

```xml
<service
    android:name="com.capacitorjs.plugins.pushnotifications.MessagingService"
    tools:node="remove" />
<service
    android:name=".DizyChatMessagingService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

- [ ] **Step 4: Implement custom FCM service**

```java
@Override
public void onNewToken(@NonNull String token) {
    super.onNewToken(token);
    PushNotificationsPlugin.onNewToken(token);
}

@Override
public void onMessageReceived(@NonNull RemoteMessage message) {
    super.onMessageReceived(message);
    DizyChatNotificationManager manager = new DizyChatNotificationManager(this);
    String type = message.getData().get("type");
    if ("chat-message".equals(type)) manager.showChatMessage(message.getData());
    if ("read-clear".equals(type)) manager.clearRoom(message.getData().get("notificationKey"));
    PushNotificationsPlugin.sendRemoteMessage(message);
}
```

- [ ] **Step 5: Implement room notification renderer**

Before calling notify, validate required strings and check notifications are enabled (`NotificationManagerCompat.from(context).areNotificationsEnabled()`). Create high-importance channel once with default sound and vibration.

Use `NotificationCompat.MessagingStyle` with at most 5 persisted recent messages. Content intent opens `MainActivity` with `dizychat_action=tap`, room, and latest message ID. Use tag+ID:

```java
notificationManager.notify("dizychat-room:" + notificationKey, 1, builder.build());
```

Same room/account notification key therefore replaces/updates one notification.

- [ ] **Step 6: Prove merged manifest and compile**

```bash
node --test tests/android-notification-native-contract.test.js
cd android && ./gradlew processDebugMainManifest compileDebugJavaWithJavac --no-daemon
```

Inspect `android/app/build/intermediates/merged_manifests/debug/processDebugMainManifest/AndroidManifest.xml` (or Gradle's actual reported merged-manifest path) and assert exactly one service has `com.google.firebase.MESSAGING_EVENT`, and it is `.DizyChatMessagingService`.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/chat/dizychat/DizyChatMessagingService.java android/app/src/main/java/com/chat/dizychat/DizyChatNotificationManager.java android/app/src/main/res/drawable/ic_stat_dizychat.xml android/app/src/main/AndroidManifest.xml tests/android-notification-native-contract.test.js
git commit -m "feat: render one Android notification per room"
```

---

### Task 7: Add Inline Reply and Mark-as-Read Background Actions

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/DizyChatNotificationActionReceiver.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/DizyChatNotificationManager.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `tests/android-notification-native-contract.test.js`

**Interfaces:**
- Reply action `com.chat.dizychat.NOTIFICATION_REPLY`.
- Mark action `com.chat.dizychat.NOTIFICATION_MARK_READ`.
- RemoteInput key `dizychat_reply_text`.
- Reply endpoint `/api/mobile/push/reply`.
- Mark endpoint `/api/read-state/mark`.

- [ ] **Step 1: Write RED action tests**

Assert notification manager builds `RemoteInput`, a mutable Reply PendingIntent, immutable Mark-read/content PendingIntents, and unique request codes derived from `notificationKey + action`. Assert receiver reads `SecureSessionStore` and `DizyChatPushConfigStore`; auth is never read from intent/FCM extras.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-notification-native-contract.test.js
```

- [ ] **Step 3: Add actions**

Reply:

```java
RemoteInput remoteInput = new RemoteInput.Builder("dizychat_reply_text").setLabel("Reply").build();
NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
    R.drawable.ic_stat_dizychat,
    "Reply",
    PendingIntent.getBroadcast(context, replyRequestCode, replyIntent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE)
).addRemoteInput(remoteInput).setAllowGeneratedReplies(true).build();
```

Mark-read uses `FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE`. Content tap uses immutable activity PendingIntent.

- [ ] **Step 4: Implement receiver with bounded background work**

Register receiver `android:exported="false"`. Use `goAsync()` plus a single executor. Read token from `SecureSessionStore`; if blank, make no network mutation. Read backend/device from config store and require HTTPS. Use `HttpURLConnection` with 4-second connect + 4-second read timeout so work remains within BroadcastReceiver's short execution budget.

Reply body:

```json
{"deviceId":"<stored-device-id>","room":"ShittyChat","messageId":"507f1f77bcf86cd799439011","text":"reply text"}
```

Mark body:

```json
{"room":"ShittyChat","messageId":"507f1f77bcf86cd799439011"}
```

Send `Authorization: Bearer <token>`, `Content-Type: application/json`. Never log token or reply body. Cancel the room notification only after a 2xx Mark-read response. Reply success updates/removes RemoteInput spinner state if Android exposes it but does not fabricate read state.

- [ ] **Step 5: Run GREEN + compile and commit**

```bash
node --test tests/android-notification-native-contract.test.js
cd android && ./gradlew compileDebugJavaWithJavac --no-daemon
git add android/app/src/main/java/com/chat/dizychat/DizyChatNotificationActionReceiver.java android/app/src/main/java/com/chat/dizychat/DizyChatNotificationManager.java android/app/src/main/AndroidManifest.xml tests/android-notification-native-contract.test.js
git commit -m "feat: add notification reply and read actions"
```

---

### Task 8: Route Notification Tap to Exact Room/Message Through Authorized Subscribed-Device Rejoin

**Files:**
- Modify: `public/mobile-push.js`
- Modify: `public/chat.js`
- Modify: `index.js`
- Test: `tests/android-notification-routing.test.js`
- Test: `tests/android-push-room-hooks.test.js`

**Interfaces:**
- `mobilePush.setOpenTargetHandler(fn)` flushes queued cold-start taps.
- Chat handler calls `/api/mobile/push/open-target` before any room navigation.
- Existing `join room` accepts native `deviceId`; same-session/device active subscription may bypass retyping room password only for that room.
- Browser/other-device/expired subscription follows current password flow unchanged.

- [ ] **Step 1: Write RED routing tests**

```js
test('tap validates server target before navigating', async () => {
  push.setOpenTargetHandler(async (target) => openTargetFromChat(target));
  await push.handleNativeAction({ action: 'tap', room: 'ShittyChat', messageId: '507f1f77bcf86cd799439011' });
  assert.equal(fetchCalls[0].path, '/api/mobile/push/open-target');
  assert.equal(navigationCalls[0].messageId, '507f1f77bcf86cd799439011');
});

test('403 open-target never joins or scrolls', async () => {
  serverResponse = { ok: false, status: 403 };
  await assert.rejects(() => openTargetFromChat({ room: 'ShittyChat', messageId: '507f1f77bcf86cd799439011', deviceId: 'dev1' }));
  assert.equal(joinCalls.length, 0);
  assert.equal(scrollCalls.length, 0);
});
```

Server tests prove same mobile session+device+subscription can rejoin without password, different device cannot, browser cannot, explicit Leave cannot, revoked session cannot.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-notification-routing.test.js tests/android-push-room-hooks.test.js
```

- [ ] **Step 3: Add subscribed-device branch before current room-password verification**

Normalize join payload. Before `roomPasswordService.claimOrVerify`, determine:

```js
let subscribedDeviceRejoin = false;
if (socket.mobileSessionId && deviceId && socket.principal?.kind === 'account') {
  subscribedDeviceRejoin = Boolean(await pushDeviceService.findActiveSubscription({
    sessionId: socket.mobileSessionId,
    deviceId,
    room: roomName,
  }));
}
```

If false, run the entire existing room-password claim/verify path unchanged. If true, skip only password verification; continue ban checks, account identity, room membership registration, and all existing join side effects.

- [ ] **Step 4: Add chat exact-target navigation handler**

Register after chat initialization:

```js
window.dizychatMobilePush?.setOpenTargetHandler?.(async ({ room, messageId, deviceId }) => {
  const response = await window.dizychatMobilePush.authenticatedPost('/api/mobile/push/open-target', { deviceId, room, messageId });
  if (!response.ok) throw new Error(`Notification target rejected (${response.status})`);
  await enterRoomForNotification({ room, deviceId });
  await ensureMessageLoaded(messageId);
  scrollToMessage(messageId);
});
```

Implement `ensureMessageLoaded(messageId)` with existing history state and `request older messages`: stop when target found, `hasMore === false`, or after a hard cap of 50 history requests. Reuse existing render/message DOM lookup; do not create duplicate renderer.

- [ ] **Step 5: Run GREEN + browser regression and commit**

```bash
node --test tests/android-notification-routing.test.js tests/android-push-room-hooks.test.js
node tests/account-navigation-ui-test.cjs
npm test
git add public/mobile-push.js public/chat.js index.js tests/android-notification-routing.test.js tests/android-push-room-hooks.test.js
git commit -m "feat: open notification at exact chat message"
```

---

### Task 9: Make Account Read Cursor Authoritative for Cross-Device Notification Clearing

**Files:**
- Modify: `src/push/push-device-service.js`
- Modify: `src/push/push-coordinator.js`
- Modify: `src/push/notification-actions-service.js`
- Modify: `index.js`
- Modify: `public/mobile-push.js`
- Modify: `public/chat.js`
- Test: `tests/push/read-clear-reconcile.test.js`

**Interfaces:**
- `pushDeviceService.listUserDevices(canonicalUsername)` returns all active device rows for the account, regardless current room subscription, so stale room notifications can be cleared even after subscription changes.
- `advanceAccountRoomRead({ principal, room, message })` is the one server helper that advances cursor, emits live account read state, and sends read-clear control.
- Existing `message read` event is the browser/foreground app actual-read signal; it must require authenticated account and visible document on client.
- Reconcile compares each native active notification's target message against authoritative account+room cursor.

- [ ] **Step 1: Write RED cross-client tests**

```js
test('read advance clears same room on all active Android devices for account', async () => {
  await advanceAccountRoomRead({ principal: account('rob'), room: 'ShittyChat', message: message2 });
  assert.deepEqual(clearCalls.map((entry) => entry.deviceId).sort(), ['dev1', 'dev2']);
});

test('browser connected but without message-read event sends no clear', async () => {
  await simulateBrowserConnectionOnly();
  assert.equal(clearCalls.length, 0);
});

test('reconcile clears notification whose target is at or behind cursor', async () => {
  const result = await actionService.reconcile({
    session: mobileSession('s1', 'rob'), deviceId: 'dev1',
    active: [{ notificationKey: 'abc', room: 'ShittyChat', messageId: '507f1f77bcf86cd799439011' }],
  });
  assert.deepEqual(result.clear, ['abc']);
});
```

Add test that advancing through the user's own latest message still advances account read cursor even though existing global `Message.status` logic does not mark one's own message `read`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/read-clear-reconcile.test.js
```

- [ ] **Step 3: Add active-account-device query and clear coordinator**

`listUserDevices(canonicalUsername)` queries `{ canonicalUsername, disabledAt: null }`.

`sendRoomClear()` computes the same account+room `notificationKey`, then sends control to every active account device:

```js
const devices = await pushDeviceService.listUserDevices(canonicalUsername);
await Promise.all(devices.map((device) => transport.sendControl({
  type: 'read-clear', room, notificationKey, throughMessageId,
}, device.fcmToken)));
```

Permanent invalid-token errors retire only that token; temporary failures do not change read state.

- [ ] **Step 4: Centralize read advancement side effects**

```js
const advanceAccountRoomRead = async ({ principal, room, message }) => {
  if (principal?.kind !== 'account' || !principal.canonicalUsername) return { advanced: false, cursor: null };
  const result = await readStateService.advanceCursor({
    canonicalUsername: principal.canonicalUsername,
    room,
    messageId: String(message._id),
    timestamp: message.timestamp,
  });
  if (result.advanced) {
    emitReadStateToAccount(principal.canonicalUsername, { room, ...result.cursor });
    void pushCoordinator.sendRoomClear({
      canonicalUsername: principal.canonicalUsername,
      room,
      throughMessageId: result.cursor.messageId,
    });
  }
  return result;
};
```

Use this helper in `/api/read-state/mark` and current Socket.IO `message read` handler.

In current `message read` handler, after target existence/room/deleted checks, call `advanceAccountRoomRead()` **before** the existing `if (msg.user === reader) return;` line. That lets the account cursor advance through its own newest message while preserving current global message-status semantics.

- [ ] **Step 5: Make the existing client read observer require visible document**

Current client already emits `message read` from `IntersectionObserver` at 75% visibility. Tighten its current guard:

```js
if (!window.currentRoom || !isViewingChat) return;
if (document.visibilityState !== 'visible') return;
```

Do not create a second read-detection system.

- [ ] **Step 6: Implement startup reconcile**

On native `mobile-push.initialize()` after bridge config/token/session availability:

```js
const active = await NotificationBridge.getActiveRoomNotifications();
const response = await authenticatedPost('/api/mobile/push/reconcile', {
  deviceId: getDeviceId(),
  active: active.notifications || active || [],
});
const body = await response.json();
for (const notificationKey of body.clear || []) {
  await NotificationBridge.clearRoomNotification({ notificationKey });
}
```

Server validates each active item shape/room/message ID; it never trusts `notificationKey` to determine read state without checking the message/cursor.

- [ ] **Step 7: Run GREEN/full regression and commit**

```bash
node --test tests/push/read-clear-reconcile.test.js tests/android-notification-routing.test.js
npm test
git add src/push/push-device-service.js src/push/push-coordinator.js src/push/notification-actions-service.js index.js public/mobile-push.js public/chat.js tests/push/read-clear-reconcile.test.js
git commit -m "feat: sync read state across Android notifications"
```

---

### Task 10: Exact-Head Full Slice 2 Gate

- [ ] **Step 1: Full deterministic/browser gate**

```bash
npm ci
npm test
node tests/account-navigation-ui-test.cjs
```

- [ ] **Step 2: Push-capable Android build**

With trusted `DIZYCHAT_FIREBASE_ANDROID_CONFIG_B64` configured:

```bash
node scripts/prepare-firebase-android-config.js
npm run android:prepare
npx cap sync android
cd android
./gradlew processDebugMainManifest assembleDebug --no-daemon
```

Prove merged manifest contains exactly one active `com.google.firebase.MESSAGING_EVENT` service and that it is `.DizyChatMessagingService`.

- [ ] **Step 3: APK/config secret inspection**

Inspect built APK assets/resources and verify no Firebase **service-account** private key, Mongo credential, DizyChat mobile session token, room password, or signing password is packaged. Android Firebase client project metadata derived from `google-services.json` is expected and is not server authority.

- [ ] **Step 4: Real-device acceptance sequence**

Prove in order:

1. First successful room join prompts for notification permission.
2. Foreground + screen on: incoming eligible message appears in chat without a system notification.
3. Lock/screen off while still in room; once suppression clears/expires (maximum 15s from last heartbeat), next eligible message produces normal notification sound/vibration.
4. Backgrounded app receives notification.
5. Swiped-away app receives notification.
6. Own-account message never notifies own devices.
7. Explicit Leave stops future notifications for that device/room.
8. Multiple unread messages in same room update one notification and retain recent message lines.
9. Another room gets a separate notification.
10. Cold and warm notification tap validate session/subscription, enter correct room, and scroll/highlight exact message.
11. Cold-start tap queued before `chat.js` is not lost.
12. Inline Reply posts one normal threaded DizyChat reply visible to browser/other clients while app stays backgrounded.
13. Mark as read advances account cursor and clears that room notification.
14. Browser merely open does not suppress phone push or clear notification.
15. Browser actually reads visible message => stale phone room notification clears.
16. Two Android devices on same account have independent subscriptions/foreground suppression.
17. Account-wide read on one client clears/updates same-room notification on both Android devices.
18. Logout prevents future push actions/delivery for that mobile session.
19. Server-side mobile-session/account revocation behaves the same.
20. Temporarily disable/break FCM transport: chat persistence + Socket.IO delivery remain normal and unduplicated.
21. Restore FCM: later pushes resume without duplicate chat messages.

- [ ] **Step 5: Verify exact head and CI**

```bash
git rev-parse HEAD
git status --short
git diff --stat origin/main...HEAD
```

Open/update draft PR through connected GitHub. Require deterministic + Android workflow success on this exact SHA; any head movement requires a fresh gate.

- [ ] **Step 6: Record accepted Slice 2 baseline only after real-device proof**

Update `docs/android-private-apk.md` with the exact accepted SHA and verified outcomes. CI/build success alone must not be described as real-device Slice 2 acceptance.

---

## PR C / Slice 2 Acceptance Boundary

Slice 2 is complete only when exact-head CI **and** real Android hardware prove:

- killed/background/locked delivery works through the sole DizyChat FCM service;
- foreground+screen-on suppression remains device-local and screen-off regains eligibility by immediate clear or 15-second lease expiry;
- one notification per room updates with recent unread context;
- cold/warm tap opens exact room/message without bypassing DizyChat auth;
- inline Reply uses the same message/reply/publication path as ordinary chat;
- Mark-read is authoritative server read state, not local dismissal;
- browser actual read clears phone notification while browser mere presence does not;
- multiple Android devices remain independent for subscription/suppression but converge on account read state;
- invalid/revoked sessions cannot mutate chat/read state;
- FCM outage never breaks chat persistence/Socket.IO;
- no server/service credentials or mobile-session secrets are present in FCM payloads or APK;
- deterministic tests, explicit `.cjs` browser UI test, Capacitor sync, merged-manifest proof, Android build, and real-device acceptance all pass on the exact final head.
