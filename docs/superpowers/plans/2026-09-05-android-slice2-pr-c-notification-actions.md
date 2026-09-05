# Android Slice 2 PR C — Notification UX and Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one updating Android notification per room while the app is backgrounded/locked/killed, route taps to the exact room/message, support inline Reply and Mark as read through DizyChat's normal authenticated server semantics, and clear stale room notifications when the account reads elsewhere.

**Architecture:** Send high-priority **data-only** FCM messages and replace Capacitor's default Android `FirebaseMessagingService` manifest entry with one DizyChat service so killed-app delivery can render custom notifications and actions deterministically. The custom service forwards token/message events back into the Capacitor PushNotifications plugin when useful, while DizyChat's own `NotificationBridge` handles room notification rendering, action intents, and local clearing. Background actions read the existing Keystore-backed mobile token through a shared `SecureSessionStore`, read the backend URL previously supplied by the configured web runtime, and call authenticated DizyChat endpoints; FCM payloads themselves never contain authority.

**Tech Stack:** Firebase Cloud Messaging data messages, Capacitor PushNotifications 7.0.3, Android `FirebaseMessagingService`, `NotificationCompat.MessagingStyle`, `RemoteInput`, BroadcastReceiver, Android Keystore, Java `HttpURLConnection`, Node/Express/Socket.IO/Mongoose.

**Spec:** `docs/superpowers/specs/2026-09-05-android-slice2-push-design.md`

## Global Constraints

- Start PR C from the exact merged/green head of PR B.
- Keep FCM as courier only: all Reply/Mark-read/open-room authorization is rechecked by DizyChat.
- FCM message payloads contain only non-secret routing/display fields.
- Use data-only high-priority FCM so DizyChat native code controls one-per-room notification identity, actions, and killed-app behaviour.
- Override/remove the Capacitor plugin's manifest `MessagingService` entry before adding `DizyChatMessagingService`; do not leave two services racing for `com.google.firebase.MESSAGING_EVENT`.
- Preserve Capacitor token registration by forwarding `onNewToken()` to `PushNotificationsPlugin.onNewToken(token)`.
- Preserve foreground JS observability by forwarding relevant received messages to `PushNotificationsPlugin.sendRemoteMessage(remoteMessage)` after DizyChat native handling.
- One notification per room uses a server-generated opaque `notificationKey`; never key it from raw auth data.
- Inline Reply creates a normal DizyChat message with the same `replyTo`/snapshot semantics as in-app reply.
- Mark as read advances the server account+room read cursor; local dismissal happens only after a successful authorized mark or an authoritative server clear control.
- Browser merely being open does not clear notifications. Browser actually marking the message read does.
- A notification tap must not bypass room authorization; active device subscription + mobile session is the rejoin authorization path.
- Notification channel sound/vibration remains user-controllable by Android.
- Use TDD and focused commits.

---

## File Structure

**Create**

- `src/messages/message-service.js` — shared normal room-message creation used by Socket.IO chat and notification Reply.
- `src/push/notification-actions-service.js` — server authorization for open target, Reply, Mark read, and reconcile.
- `android/app/src/main/java/com/chat/dizychat/SecureSessionStore.java` — reusable Keystore session read/write/clear implementation extracted from plugin.
- `android/app/src/main/java/com/chat/dizychat/DizyChatPushConfigStore.java` — private native storage for configured backend origin + stable device ID only.
- `android/app/src/main/java/com/chat/dizychat/DizyChatMessagingService.java` — sole FCM service, dispatches `chat-message` and `read-clear` data messages.
- `android/app/src/main/java/com/chat/dizychat/DizyChatNotificationManager.java` — stable room tags, channel, MessagingStyle history, tap/reply/mark-read intents, cancel/reconcile helpers.
- `android/app/src/main/java/com/chat/dizychat/DizyChatNotificationActionReceiver.java` — background inline Reply and Mark-read HTTP action handler.
- `android/app/src/main/java/com/chat/dizychat/NotificationBridgePlugin.java` — configure native backend/device context, emit tap actions to WebView, list/clear active room notifications.
- `android/app/src/main/res/drawable/ic_stat_dizychat.xml` — monochrome notification status icon.
- `tests/push/notification-actions-service.test.js`
- `tests/push/message-service-reply.test.js`
- `tests/push/fcm-data-payload.test.js`
- `tests/android-notification-native-contract.test.js`
- `tests/android-notification-routing.test.js`
- `tests/push/read-clear-reconcile.test.js`

**Modify**

- `src/push/transports/fcm-transport.js` — data-only high-priority message/control payloads.
- `src/push/push-coordinator.js` — send authoritative room-clear control to account devices after read cursor advances.
- `index.js` — use shared message service, add `/api/mobile/push/open-target`, `/api/mobile/push/reply`, `/api/mobile/push/reconcile`, and connect read-state advancement to clear controls/live events.
- `src/auth/mobile-session-service.js` — no semantic auth change; only consume the existing session ID from PR A.
- `android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java` — delegate to `SecureSessionStore` without changing JS contract.
- `android/app/src/main/java/com/chat/dizychat/MainActivity.java` — register `NotificationBridgePlugin`.
- `android/app/src/main/AndroidManifest.xml` — manifest-merge removal of Capacitor MessagingService; register DizyChat messaging service and action receiver; notification channel metadata if needed.
- `public/mobile-push.js` — configure NotificationBridge, consume native notification actions, perform startup reconcile, clear/update local room notifications after live read-state events.
- `public/chat.js` — expose exact-message navigation and account read-boundary hook without changing browser semantics.
- `public/mobile-bootstrap.js` — no new ordering unless NotificationBridge initialization requires it; keep secure session restore before `mobile-push.js`.
- `tests/android-native-contract.test.js` / `tests/android-bootstrap-contract.test.js` only where existing assertions need extension.
- `docs/android-private-apk.md` — final Slice 2 acceptance procedure.

---

### Task 1: Extract Shared Normal Message Creation Before Adding Notification Reply

**Files:**
- Create: `src/messages/message-service.js`
- Modify: `index.js`
- Test: `tests/push/message-service-reply.test.js`

**Interfaces:**
- `createMessageService({ MessageModel, now })`
- `createRoomMessage({ principal, room, user, text, fileUrl, fileType, fileName, replyTo }) -> persisted plain message`
- The service validates reply target room and builds the same `replyToSnapshot` shape currently used by the Socket.IO path.

- [ ] **Step 1: Write RED parity tests from current socket behaviour**

```js
test('normal reply persists replyTo and snapshot from target message', async () => {
  const target = { _id: '507f1f77bcf86cd799439011', room: 'ShittyChat', user: 'Nick', text: 'original', fileUrl: '', fileType: '', fileName: '', deleted: false };
  const model = makeMessageModel({ target });
  const service = createMessageService({ MessageModel: model, now: () => new Date('2026-09-05T20:00:00Z') });
  const saved = await service.createRoomMessage({ principal: { kind: 'account', username: 'Rob', canonicalUsername: 'rob' }, room: 'ShittyChat', user: 'Rob', text: 'reply', replyTo: target._id });
  assert.equal(String(saved.replyTo), String(target._id));
  assert.equal(saved.replyToSnapshot.user, 'Nick');
  assert.equal(saved.replyToSnapshot.text, 'original');
});

test('reply target from another room is rejected', async () => {
  // target.room='OtherRoom', requested room='ShittyChat' => reject and persist nothing
});
```

Add tests for deleted target snapshot, attachment metadata parity, empty text with valid file, and account identity cannot spoof another `user` display name when the existing socket path already pins registered identities.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/message-service-reply.test.js
```
Expected: FAIL.

- [ ] **Step 3: Implement shared service by moving—not rewriting—the proven socket rules**

Core reply lookup:

```js
let replyToId = null;
let replyToSnapshot = null;
if (replyTo) {
  const target = await MessageModel.findById(replyTo);
  if (!target || String(target.room) !== room) throw Object.assign(new Error('Invalid reply target'), { code: 'INVALID_REPLY_TARGET' });
  replyToId = target._id;
  replyToSnapshot = {
    id: String(target._id), user: String(target.user || ''), text: String(target.text || ''),
    fileUrl: String(target.fileUrl || ''), fileType: String(target.fileType || ''), fileName: String(target.fileName || ''),
    deleted: Boolean(target.deleted),
  };
}
```

Persist with the same `Message` fields used today. Do not add a push-only flag/message type.

- [ ] **Step 4: Switch existing `chat message` handler to call the service**

The Socket.IO handler still performs existing socket/session/rate/room validation; after that it calls:

```js
const saved = await messageService.createRoomMessage({ principal: socket.data.principal, room, user, text, fileUrl, fileType, fileName, replyTo });
```

Then preserve existing Socket.IO publication and PR A post-persist push call. This is a refactor boundary; behaviour must remain equivalent before notification HTTP Reply is added.

- [ ] **Step 5: Run GREEN plus full chat tests**

```bash
node --test tests/push/message-service-reply.test.js
npm test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/messages/message-service.js index.js tests/push/message-service-reply.test.js
git commit -m "refactor: share normal room message creation"
```

---

### Task 2: Add Server Notification Action Authorization

**Files:**
- Create: `src/push/notification-actions-service.js`
- Modify: `index.js`
- Test: `tests/push/notification-actions-service.test.js`

**Interfaces:**
- `openTarget({ session, deviceId, room, messageId }) -> { room, message }`
- `reply({ session, deviceId, room, messageId, text }) -> saved normal message`
- `markRead({ session, deviceId, room, messageId }) -> read cursor result`
- Active device subscription is required for `openTarget` and `reply`; `markRead` requires authenticated account+room access and target consistency.

- [ ] **Step 1: Write RED authorization tests**

```js
test('openTarget requires same-session active device subscription', async () => {
  await assert.rejects(
    () => service.openTarget({ session: mobileSession('s1', 'rob'), deviceId: 'other-device', room: 'ShittyChat', messageId: 'm1' }),
    (error) => error.code === 'NOT_SUBSCRIBED'
  );
});

test('notification reply uses shared normal message service', async () => {
  const saved = await service.reply({ session: mobileSession('s1', 'rob'), deviceId: 'dev1', room: 'ShittyChat', messageId: 'm1', text: 'yep' });
  assert.equal(saved.replyTo, 'm1');
  assert.equal(saved.text, 'yep');
});
```

Add tests for revoked/missing mobile session, message from another room, explicit Leave subscription removal, empty/oversized reply text, and no mutation on authorization failure.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/notification-actions-service.test.js
```
Expected: FAIL.

- [ ] **Step 3: Implement action service**

Central device assertion:

```js
const assertSubscribedDevice = async ({ session, deviceId, room }) => {
  if (session?.kind !== 'mobile' || !session.sessionId || !session.principal?.canonicalUsername) throw coded('AUTH_REQUIRED');
  const subscription = await pushDeviceService.findActiveSubscription({ sessionId: session.sessionId, deviceId, room });
  if (!subscription) throw coded('NOT_SUBSCRIBED');
  return subscription;
};
```

`reply()` calls `messageService.createRoomMessage()` using the authenticated principal's username and `replyTo: messageId`.

- [ ] **Step 4: Add authenticated endpoints**

```text
POST /api/mobile/push/open-target  { deviceId, room, messageId }
POST /api/mobile/push/reply        { deviceId, room, messageId, text }
POST /api/mobile/push/reconcile    { deviceId, active: [{ notificationKey, room, messageId }] }
```

All three require `requireHttpMobileAccount()` from PR A. `reply` returns the saved message JSON after normal Socket.IO publication/push dispatch; `open-target` returns only non-secret routing/message data.

- [ ] **Step 5: Run GREEN**

```bash
node --test tests/push/notification-actions-service.test.js tests/push/message-service-reply.test.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
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
- Message data fields, all strings: `type=chat-message`, `room`, `messageId`, `sender`, `preview`, `notificationKey`, `timestamp`.
- Clear data fields: `type=read-clear`, `room`, `notificationKey`, `throughMessageId`.
- `notificationKey = sha256(canonicalUsername + "\0" + room).slice(0, 24)` computed server-side; canonical username itself need not be sent.

- [ ] **Step 1: Write RED payload tests**

```js
test('chat push is high-priority data-only with stable room collapse key', async () => {
  await transport.send(intent, 'token');
  assert.equal(captured.notification, undefined);
  assert.equal(captured.android.priority, 'high');
  assert.equal(captured.android.collapseKey, intent.notificationKey);
  assert.equal(captured.data.type, 'chat-message');
  assert.equal(captured.data.notificationKey, intent.notificationKey);
});
```

Also assert every `data` value is a string and serialized payload does not contain `sessionToken`, `fcmToken`, `canonicalUsername`, `private_key`, room password, or service-account fields.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/fcm-data-payload.test.js tests/push/fcm-transport.test.js
```
Expected: FAIL until transport is data-only.

- [ ] **Step 3: Implement data payload**

```js
const message = {
  token,
  data: {
    type: 'chat-message', room: intent.room, messageId: intent.messageId,
    sender: intent.sender, preview: intent.preview,
    notificationKey: intent.notificationKey, timestamp: String(intent.timestamp),
  },
  android: { priority: 'high', collapseKey: intent.notificationKey },
};
```

`sendControl()` uses the same high-priority data-only form but `type: 'read-clear'`.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/push/fcm-data-payload.test.js tests/push/fcm-transport.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/push/transports/fcm-transport.js src/push/notification-policy.js tests/push/fcm-data-payload.test.js
git commit -m "feat: send DizyChat data-only push payloads"
```

---

### Task 4: Extract SecureSessionStore for Native Background Actions

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/SecureSessionStore.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java`
- Test: `tests/android-secure-session.test.js`
- Test: `tests/android-notification-native-contract.test.js`

**Interfaces:**
- `SecureSessionStore(Context)`
- `String readToken() throws Exception`
- `void writeToken(String token) throws Exception`
- `boolean clearToken()`
- Same Keystore alias/prefs/IV/ciphertext names as current plugin so upgrades do not log users out.

- [ ] **Step 1: Add RED source-contract assertions**

```js
test('SecureSessionPlugin delegates storage to shared SecureSessionStore', () => {
  const plugin = fs.readFileSync('android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java', 'utf8');
  const store = fs.readFileSync('android/app/src/main/java/com/chat/dizychat/SecureSessionStore.java', 'utf8');
  assert.match(plugin, /new SecureSessionStore\(getContext\(\)\)/);
  assert.match(store, /dizychat\.mobile\.session\.v1/);
  assert.match(store, /AES\/GCM\/NoPadding/);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-secure-session.test.js tests/android-notification-native-contract.test.js
```
Expected: FAIL.

- [ ] **Step 3: Move crypto/prefs implementation verbatim into store**

Do not change alias, preference keys, GCM mode, generated-IV behaviour, or commit semantics. Plugin methods become thin adapters:

```java
@PluginMethod
public void readToken(PluginCall call) {
    try {
        JSObject result = new JSObject();
        result.put("token", new SecureSessionStore(getContext()).readToken());
        call.resolve(result);
    } catch (Exception error) {
        call.reject("Unable to read secure DizyChat session", error);
    }
}
```

- [ ] **Step 4: Run GREEN + Android compile**

```bash
node --test tests/android-secure-session.test.js tests/android-notification-native-contract.test.js
cd android && ./gradlew compileDebugJavaWithJavac --no-daemon
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/chat/dizychat/SecureSessionStore.java android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java tests/android-secure-session.test.js tests/android-notification-native-contract.test.js
git commit -m "refactor: share secure Android session store"
```

---

### Task 5: Add Native Push Config Store and NotificationBridge Plugin

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/DizyChatPushConfigStore.java`
- Create: `android/app/src/main/java/com/chat/dizychat/NotificationBridgePlugin.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/MainActivity.java`
- Modify: `public/mobile-push.js`
- Test: `tests/android-notification-native-contract.test.js`
- Test: `tests/android-notification-routing.test.js`

**Interfaces:**
- JS `NotificationBridge.configure({ backendUrl, deviceId })` stores only normalized `https://` backend origin and deviceId.
- JS listener `notificationAction` emits `{ action: 'tap', room, messageId }` for tap routing.
- `getActiveRoomNotifications()` returns persisted non-secret metadata `{ notificationKey, room, messageId }[]`.
- `clearRoomNotification({ notificationKey })` cancels one room notification/history.

- [ ] **Step 1: Write RED contract tests**

```js
test('NotificationBridge rejects non-HTTPS backend configuration in native code', () => {
  const source = fs.readFileSync('android/app/src/main/java/com/chat/dizychat/NotificationBridgePlugin.java', 'utf8');
  assert.match(source, /https/i);
  assert.match(source, /configure/);
});

test('mobile push configures native bridge from resolved backend, not a hard-coded URL', async () => {
  await push.initialize();
  assert.deepEqual(configureCalls[0], { backendUrl: 'https://configured.example', deviceId: push.getDeviceId() });
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-notification-native-contract.test.js tests/android-notification-routing.test.js
```
Expected: FAIL.

- [ ] **Step 3: Implement private config store**

`DizyChatPushConfigStore` uses private SharedPreferences with keys `backend_origin` and `device_id`; it validates via `Uri.parse()` and accepts only HTTPS with non-empty host. It never stores FCM/service credentials.

- [ ] **Step 4: Implement bridge plugin and cold/warm tap capture**

`NotificationBridgePlugin.load()` inspects the Activity's current intent for DizyChat action extras. Override `handleOnNewIntent(Intent)` to emit retained `notificationAction` events. Use explicit extras:

```text
dizychat_action=tap
dizychat_room=<room>
dizychat_message_id=<message id>
```

- [ ] **Step 5: Configure bridge from the already-resolved backend**

In `mobile-push.js`, after native runtime has resolved backend via `window.dizychatMobileRuntime.resolveBackendOrigin(...)`:

```js
await NotificationBridge.configure({ backendUrl: backend, deviceId: getDeviceId() });
```

No second production URL literal is added.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/android-notification-native-contract.test.js tests/android-notification-routing.test.js
cd android && ./gradlew compileDebugJavaWithJavac --no-daemon
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
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
- Sole `com.google.firebase.MESSAGING_EVENT` service: `.DizyChatMessagingService`.
- Channel ID: `dizychat_messages_v1`.
- Notification tag: `dizychat-room:<notificationKey>` and fixed integer ID `1`.
- Persist up to 5 recent sender/preview lines per `notificationKey` in private preferences for MessagingStyle updates.

- [ ] **Step 1: Write RED manifest/service assertions**

```js
test('manifest removes Capacitor messaging service and registers DizyChat service once', () => {
  const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /com\.capacitorjs\.plugins\.pushnotifications\.MessagingService/);
  assert.match(manifest, /tools:node="remove"/);
  assert.match(manifest, /\.DizyChatMessagingService/);
  assert.equal((manifest.match(/com\.google\.firebase\.MESSAGING_EVENT/g) || []).length, 1);
});
```

Also assert `DizyChatMessagingService` calls both `PushNotificationsPlugin.onNewToken` and `DizyChatNotificationManager`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-notification-native-contract.test.js
```
Expected: FAIL.

- [ ] **Step 3: Override the plugin service with manifest merger tools**

Add `xmlns:tools="http://schemas.android.com/tools"` to manifest root, then:

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

Do not register a second active FCM service.

- [ ] **Step 4: Implement messaging service**

```java
@Override
public void onNewToken(@NonNull String token) {
    super.onNewToken(token);
    PushNotificationsPlugin.onNewToken(token);
}

@Override
public void onMessageReceived(@NonNull RemoteMessage message) {
    super.onMessageReceived(message);
    String type = message.getData().get("type");
    DizyChatNotificationManager manager = new DizyChatNotificationManager(this);
    if ("chat-message".equals(type)) manager.showChatMessage(message.getData());
    else if ("read-clear".equals(type)) manager.clearRoom(message.getData().get("notificationKey"));
    PushNotificationsPlugin.sendRemoteMessage(message);
}
```

- [ ] **Step 5: Implement one-per-room MessagingStyle renderer**

Create channel with `IMPORTANCE_HIGH`, vibration enabled, and default sound. Build content intent to `MainActivity` carrying room/message extras. Use:

```java
notificationManager.notify("dizychat-room:" + notificationKey, 1, builder.build());
```

Appending a new message to the same `notificationKey` updates the existing notification and preserves only the latest 5 lines.

- [ ] **Step 6: Run merged-manifest and compile proof**

```bash
node --test tests/android-notification-native-contract.test.js
cd android && ./gradlew processDebugMainManifest compileDebugJavaWithJavac --no-daemon
```

Inspect the merged manifest and prove only one active `MESSAGING_EVENT` service remains.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/chat/dizychat/DizyChatMessagingService.java android/app/src/main/java/com/chat/dizychat/DizyChatNotificationManager.java android/app/src/main/res/drawable/ic_stat_dizychat.xml android/app/src/main/AndroidManifest.xml tests/android-notification-native-contract.test.js
git commit -m "feat: render one Android notification per room"
```

---

### Task 7: Add Inline Reply and Mark-as-Read Native Actions

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/DizyChatNotificationActionReceiver.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/DizyChatNotificationManager.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `tests/android-notification-native-contract.test.js`

**Interfaces:**
- Action strings: `com.chat.dizychat.NOTIFICATION_REPLY`, `com.chat.dizychat.NOTIFICATION_MARK_READ`.
- RemoteInput key: `dizychat_reply_text`.
- Native HTTP endpoints: `/api/mobile/push/reply` and `/api/read-state/mark`.
- Receiver reads token from `SecureSessionStore`, backend/device from `DizyChatPushConfigStore`.

- [ ] **Step 1: Write RED receiver/action tests**

```js
test('notification uses RemoteInput for inline reply and a separate mark-read action', () => {
  const source = fs.readFileSync('android/app/src/main/java/com/chat/dizychat/DizyChatNotificationManager.java', 'utf8');
  assert.match(source, /RemoteInput/);
  assert.match(source, /dizychat_reply_text/);
  assert.match(source, /NOTIFICATION_MARK_READ/);
});
```

Add source contract that receiver calls only configured HTTPS backend and reads `SecureSessionStore`, not notification extras for auth.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-notification-native-contract.test.js
```
Expected: FAIL.

- [ ] **Step 3: Add Reply action to notification**

```java
RemoteInput remoteInput = new RemoteInput.Builder("dizychat_reply_text").setLabel("Reply").build();
NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
    R.drawable.ic_stat_dizychat, "Reply", replyPendingIntent
).addRemoteInput(remoteInput).setAllowGeneratedReplies(true).build();
```

Add Mark as read action with its own immutable/update-current-safe PendingIntent identity keyed by `notificationKey`.

- [ ] **Step 4: Implement background receiver with `goAsync()`**

```java
@Override
public void onReceive(Context context, Intent intent) {
    PendingResult pending = goAsync();
    EXECUTOR.execute(() -> {
        try {
            handleAction(context, intent);
        } finally {
            pending.finish();
        }
    });
}
```

For Reply, read `RemoteInput.getResultsFromIntent(intent)`, trim/cap text to the same server maximum, and POST JSON `{ deviceId, room, messageId, text }` with `Authorization: Bearer <SecureSessionStore.readToken()>`.

For Mark read, POST `{ room, messageId }` to `/api/read-state/mark` with the same auth token. Cancel local notification only after 2xx. Never log bearer token or body text.

Use connection/read timeouts (for example 5s/8s) and always close/disconnect. HTTP failure leaves the notification visible and chat state untouched.

- [ ] **Step 5: Run GREEN + compile**

```bash
node --test tests/android-notification-native-contract.test.js
cd android && ./gradlew compileDebugJavaWithJavac --no-daemon
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/chat/dizychat/DizyChatNotificationActionReceiver.java android/app/src/main/java/com/chat/dizychat/DizyChatNotificationManager.java android/app/src/main/AndroidManifest.xml tests/android-notification-native-contract.test.js
git commit -m "feat: add notification reply and read actions"
```

---

### Task 8: Route Notification Tap to Exact Room and Message

**Files:**
- Modify: `public/mobile-push.js`
- Modify: `public/chat.js`
- Modify: `index.js`
- Test: `tests/android-notification-routing.test.js`

**Interfaces:**
- `window.dizychatOpenNotificationTarget({ room, messageId, deviceId }) -> Promise<boolean>`.
- Server `open-target` verifies mobile session + active device subscription + target message belongs to room.
- Rejoin path may use active device subscription instead of room password, but only for the same session/device/room.

- [ ] **Step 1: Write RED routing tests**

```js
test('tap action validates target before entering room', async () => {
  const opened = await runtime.handleNativeAction({ action: 'tap', room: 'ShittyChat', messageId: 'm1' });
  assert.equal(fetchCalls[0].path, '/api/mobile/push/open-target');
  assert.equal(openCalls[0].messageId, 'm1');
});

test('failed open-target authorization does not enter room', async () => {
  // 403 => no join/no scroll
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-notification-routing.test.js
```
Expected: FAIL.

- [ ] **Step 3: Expose one chat navigation function**

`chat.js` implementation sequence:

```js
async function dizychatOpenNotificationTarget({ room, messageId, deviceId }) {
  // if already in room, ensure target history and scroll/highlight
  // otherwise use the authenticated subscribed-device rejoin path, then load target and scroll
}
window.dizychatOpenNotificationTarget = dizychatOpenNotificationTarget;
```

Do not duplicate message rendering. Reuse existing room-entry, history pagination, `appState.messages`, and highlight/scroll helpers. If target is older than loaded history, request history chunks until found or server reports no more; cap requests to prevent an infinite loop.

- [ ] **Step 4: Add subscribed-device rejoin authorization on server**

Extend the existing room join handler with an explicit native-only branch:

```js
if (payload.deviceId && socket.data.mobileSessionId) {
  const subscription = await pushDeviceService.findActiveSubscription({ sessionId: socket.data.mobileSessionId, deviceId: payload.deviceId, room });
  if (subscription) subscribedDeviceRejoin = true;
}
```

Only this authenticated active subscription may bypass re-entering the room password. Browser clients and other devices retain existing room-password behaviour.

- [ ] **Step 5: Run GREEN + browser join regressions**

```bash
node --test tests/android-notification-routing.test.js tests/account-navigation-ui-test.cjs
npm test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/mobile-push.js public/chat.js index.js tests/android-notification-routing.test.js
git commit -m "feat: open notification at exact chat message"
```

---

### Task 9: Synchronize Account-Wide Read State and Clear Stale Room Notifications

**Files:**
- Modify: `src/push/push-coordinator.js`
- Modify: `src/push/notification-actions-service.js`
- Modify: `index.js`
- Modify: `public/mobile-push.js`
- Modify: `public/chat.js`
- Test: `tests/push/read-clear-reconcile.test.js`

**Interfaces:**
- `pushCoordinator.sendRoomClear({ canonicalUsername, room, throughMessageId })` sends `read-clear` control to all active Android devices for account/room.
- Live server event: `room read state` with `{ room, messageId, timestamp }` only to sockets for that account.
- Browser/Android view marks read only when room is actually viewed/read, not merely because a session exists.
- Startup reconcile posts active native notification metadata and server returns `{ clear: [notificationKey...] }`.

- [ ] **Step 1: Write RED cross-client tests**

```js
test('advancing read cursor sends clear control to all account devices for that room', async () => {
  await service.markRead({ session: mobileSession('s1', 'rob'), deviceId: 'dev1', room: 'ShittyChat', messageId: 'm2' });
  assert.deepEqual(clearCalls.map((c) => c.deviceId).sort(), ['dev1', 'dev2']);
});

test('browser presence alone sends no clear control', async () => {
  await simulateBrowserConnectedButUnread();
  assert.equal(clearCalls.length, 0);
});
```

Add reconcile test: native active notification target message at/before authoritative read cursor => clear; newer than cursor => keep.

- [ ] **Step 2: Run RED**

```bash
node --test tests/push/read-clear-reconcile.test.js
```
Expected: FAIL.

- [ ] **Step 3: Centralize read advancement side effects**

Wrap `readStateService.advanceCursor()` with one server helper:

```js
const advanceAccountRoomRead = async ({ principal, room, message }) => {
  const result = await readStateService.advanceCursor({ canonicalUsername: principal.canonicalUsername, room, messageId: String(message._id), timestamp: message.timestamp });
  if (result.advanced) {
    emitReadStateToAccount(principal.canonicalUsername, result.cursor);
    void pushCoordinator.sendRoomClear({ canonicalUsername: principal.canonicalUsername, room, throughMessageId: result.cursor.messageId });
  }
  return result;
};
```

Use this helper from browser/Android read boundary and native Mark read endpoint.

- [ ] **Step 4: Add client read boundary**

In `chat.js`, mark read when the current room is actually visible and the latest message has been rendered at/near the read boundary. Do **not** mark read merely on socket receipt when the document/room is hidden. Use `document.visibilityState === 'visible'`, `isViewingChat`, current room match, and existing bottom/scroll state.

- [ ] **Step 5: Implement startup reconcile**

`NotificationBridge.getActiveRoomNotifications()` -> POST `/api/mobile/push/reconcile` -> for every returned key:

```js
await NotificationBridge.clearRoomNotification({ notificationKey });
```

Reconciliation is idempotent.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/push/read-clear-reconcile.test.js tests/android-notification-routing.test.js
npm test
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/push/push-coordinator.js src/push/notification-actions-service.js index.js public/mobile-push.js public/chat.js tests/push/read-clear-reconcile.test.js
git commit -m "feat: sync read state across Android notifications"
```

---

### Task 10: Exact-Head Full Slice 2 Gate

**Files:**
- Modify documentation only if acceptance wording needs recorded results; no feature changes without a proven failure.

- [ ] **Step 1: Full deterministic gate**

```bash
npm ci
npm test
```
Expected: PASS.

- [ ] **Step 2: Push-capable Android build**

Materialize trusted Android Firebase client config, then:

```bash
node scripts/prepare-firebase-android-config.js
npm run android:prepare
npx cap sync android
cd android
./gradlew processDebugMainManifest assembleDebug --no-daemon
```
Expected: PASS and merged manifest contains exactly one active `com.google.firebase.MESSAGING_EVENT` service: `.DizyChatMessagingService`.

- [ ] **Step 3: APK secret/content inspection**

Inspect built APK/merged assets and prove it contains no Firebase **service-account** private key, Mongo credential, DizyChat mobile session token, room password, or signing password. `google-services.json`-derived Android client project metadata may be present because FCM client registration requires it; this is not server authority.

- [ ] **Step 4: Real-device acceptance sequence**

Use two accounts where practical and browser + Android; use two Android devices/emulators for the multi-device cases:

```text
1. First successful room join prompts for notifications at that moment.
2. Foreground + screen on: incoming eligible room message appears in chat but no system push.
3. Lock/screen off while still in room; after explicit clear/lease fail-safe, next message produces normal sound/vibration notification.
4. Background app receives notification.
5. Swipe app away; next message still produces notification.
6. Own account message never produces own-device notification.
7. Explicit Leave stops future notifications for that device/room.
8. Two unread messages in same room update one notification with recent message history.
9. Different room creates a separate notification.
10. Tap notification cold-starts/resumes app, validates mobile session/subscription, opens correct room, scrolls/highlights exact message.
11. Inline Reply posts a normal threaded reply visible immediately to browser/other clients; app need not be foregrounded.
12. Mark as read advances server read cursor and clears that room notification.
13. Browser merely open does not suppress phone push.
14. Browser actually reads room: phone's stale room notification clears.
15. Two Android devices on same account keep independent subscriptions/foreground suppression.
16. Account-wide read on one client clears/updates the same room notification on both Android devices.
17. Logout prevents future push delivery/actions for revoked mobile session.
18. Server-side mobile-session revocation behaves the same.
19. Disable/break FCM transport temporarily: chat message persistence and Socket.IO delivery continue normally.
20. Restore FCM: later pushes resume without duplicated chat messages.
```

- [ ] **Step 5: Verify exact head and CI**

```bash
git rev-parse HEAD
git status --short
git diff --stat origin/main...HEAD
```

Open/update the draft PR via connected GitHub. Require deterministic + Android workflow success on that exact SHA. If the head changes, repeat the gate on the new SHA.

- [ ] **Step 6: Update `docs/android-private-apk.md` with accepted Slice 2 baseline**

Record only verified acceptance facts and the exact accepted SHA. Do not claim push complete from CI alone.

---

## PR C / Slice 2 Acceptance Boundary

Slice 2 is complete only when exact-head CI **and** real Android hardware prove:

- killed/background/locked delivery works through the sole DizyChat FCM service;
- foreground+screen-on suppression remains device-local;
- screen off still gets Android sound/vibration;
- one notification per room updates with recent unread context;
- tap opens exact room/message without bypassing DizyChat auth;
- inline Reply is a normal threaded DizyChat message;
- Mark read is authoritative server read state, not local dismissal;
- browser actual-read clears phone notification, browser mere presence does not;
- multiple Android devices are independent for subscription/suppression but converge on account read state;
- invalid/revoked sessions cannot mutate chat/read state;
- FCM outage never breaks chat persistence/Socket.IO;
- no server/service credentials or mobile-session secrets are present in FCM payloads or APK;
- all deterministic tests, Capacitor sync, merged-manifest proof, Android build, and real-device acceptance pass on the exact final head.
