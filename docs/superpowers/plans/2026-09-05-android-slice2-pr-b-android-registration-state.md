# Android Slice 2 PR B — Android Registration and Device State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register each Android installation with DizyChat/FCM, request notification permission after the first successful room join, persist per-device identity, bind room join/leave to the server subscription authority, and maintain the short-lived `foreground + screen interactive` suppression lease required by PR A.

**Architecture:** Keep push orchestration in `public/mobile-push.js`, loaded only by the native bootstrap. Use the already-installed Capacitor PushNotifications plugin for permission/token registration. Add one narrow native `DeviceState` plugin for lifecycle plus `PowerManager.isInteractive()`. All server mutations use the mobile session already restored by `SecureSession`; there is no second auth credential. The current mobile fetch router already sends `/api/*` to the configured backend, so PR B must reuse it rather than hard-code another backend URL.

**Tech Stack:** Capacitor 7.4.4, `@capacitor/push-notifications` 7.0.3, Android Java, PowerManager/BroadcastReceiver, existing SecureSession plugin, Node deterministic tests, Gradle/Android SDK.

**Spec:** `docs/superpowers/specs/2026-09-05-android-slice2-push-design.md`

## Global Constraints

- Start PR B from the exact merged/green head of PR A.
- Stable device ID identifies an app installation; it is not authentication.
- Every server mutation uses the durable mobile session restored by `SecureSession`.
- Request Android notification permission only after a successful first room join.
- Denied permission must leave chat/auth/room joining fully functional.
- Browser sessions never register an Android push device or alter Android suppression leases.
- Suppression is true only for `app foreground AND screen interactive`.
- Screen off/locked clears suppression immediately when the WebView can send the state update; 15-second lease expiry is the fail-safe if Android suspends the WebView first.
- Lease TTL is 15 seconds; heartbeat is every 5 seconds while foreground+interactive.
- Explicit room Leave removes the device subscription; disconnect/background/swipe-away does not.
- `android/app/google-services.json` is Android Firebase client configuration, not a service-account credential; keep it out of Git and materialize it only for push-capable builds.
- Use TDD and focused commits.

---

## File Structure

**Create**

- `public/mobile-push.js` — native-only device ID, push permission/token registration, authenticated push API calls, device-state lease heartbeat, and room lifecycle hooks.
- `android/app/src/main/java/com/chat/dizychat/DeviceStatePlugin.java` — `PowerManager.isInteractive()` plus activity/screen state events.
- `scripts/prepare-firebase-android-config.js` — strict build-time materializer for Android `google-services.json`.
- `tests/android-push-runtime.test.js`
- `tests/android-device-state-contract.test.js`
- `tests/android-push-room-hooks.test.js`
- `tests/android-push-config.test.js`

**Modify**

- `public/mobile-bootstrap.js` — load/initialize `mobile-push.js` after secure-session restore/backend fetch routing and before `chat.js`.
- `public/chat.js` — add narrow native hooks to existing accepted join, explicit Leave, and logout boundaries; browser path remains unchanged.
- `android/app/src/main/java/com/chat/dizychat/MainActivity.java` — register `DeviceStatePlugin`.
- `android/app/src/main/AndroidManifest.xml` — add `POST_NOTIFICATIONS` only; screen broadcasts are registered dynamically by the plugin.
- `.gitignore` — ignore `android/app/google-services.json`.
- `.github/workflows/android-slice1-ci.yml` — run optional Firebase client-config preparation and include its script in path triggers.
- `docs/android-private-apk.md` — document Firebase Android client-config setup and the separation from server service credentials.

---

### Task 1: Add Stable Native Device Identity and Authenticated Push HTTP Helper

**Files:**
- Create: `public/mobile-push.js`
- Test: `tests/android-push-runtime.test.js`

**Interfaces:**
- `getDeviceId() -> string`
- `authenticatedPost(path, body) -> Promise<Response>`
- Device ID key: `dizychat-android-device-id-v1` in native WebView localStorage.

- [ ] **Step 1: Write RED tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobilePushRuntime } = require('../public/mobile-push');

const makeNativeWindow = () => {
  const store = new Map();
  return {
    crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
    localStorage: {
      getItem: (key) => store.get(key) || null,
      setItem: (key, value) => store.set(key, String(value)),
    },
    dizychatAuthV2: { readToken: () => 'dcm1.test-token' },
    Capacitor: { isNativePlatform: () => true, Plugins: {} },
    fetch: async (url, init) => ({ url, init, ok: true }),
  };
};

test('stable device id is generated once and reused', () => {
  const push = createMobilePushRuntime(makeNativeWindow());
  assert.equal(push.getDeviceId(), '11111111-2222-4333-8444-555555555555');
  assert.equal(push.getDeviceId(), '11111111-2222-4333-8444-555555555555');
});

test('authenticatedPost uses the current restored mobile token', async () => {
  const push = createMobilePushRuntime(makeNativeWindow());
  const response = await push.authenticatedPost('/api/mobile/push/register', { deviceId: push.getDeviceId() });
  assert.equal(response.init.headers.Authorization, 'Bearer dcm1.test-token');
});
```

Add a browser-mode test: `Capacitor.isNativePlatform() === false` returns empty device ID and `initialize()` is a no-op.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-push-runtime.test.js
```

- [ ] **Step 3: Implement module wrapper and helpers**

Use a CommonJS-testable wrapper:

```js
(function initMobilePush(root, factory) {
  const runtime = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = { createMobilePushRuntime: factory };
  if (root && typeof root === 'object') root.dizychatMobilePush = runtime;
})(typeof window !== 'undefined' ? window : globalThis, (win = {}) => {
  const DEVICE_ID_KEY = 'dizychat-android-device-id-v1';
  const isNative = () => {
    try { return Boolean(win.Capacitor?.isNativePlatform?.()); } catch (_err) { return false; }
  };

  const getDeviceId = () => {
    if (!isNative()) return '';
    let id = String(win.localStorage?.getItem?.(DEVICE_ID_KEY) || '').trim();
    if (id) return id;
    id = String(win.crypto?.randomUUID?.() || '').trim();
    if (!id) throw new Error('Unable to generate Android device id');
    win.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  };

  const authenticatedPost = (path, body) => {
    const token = String(win.dizychatAuthV2?.readToken?.() || '').trim();
    if (!token) throw new Error('Mobile session is unavailable');
    return win.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  };

  return { isNative, getDeviceId, authenticatedPost };
});
```

Do not add a backend URL here; existing native fetch routing already handles `/api/*`.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test tests/android-push-runtime.test.js
git add public/mobile-push.js tests/android-push-runtime.test.js
git commit -m "feat: add Android push runtime identity"
```

---

### Task 2: Wire Capacitor Push Permission and Token Registration

**Files:**
- Modify: `public/mobile-push.js`
- Modify: `public/mobile-bootstrap.js`
- Test: `tests/android-push-runtime.test.js`
- Test: `tests/android-bootstrap-contract.test.js`

**Interfaces:**
- `initialize()` installs listeners; it does not request permission.
- `onRoomJoined(room)` requests permission on the first successful join and registers with FCM when granted.
- `registration` posts `{ deviceId, fcmToken, deviceLabel }` to `/api/mobile/push/register`.

- [ ] **Step 1: Add RED permission-timing tests**

```js
test('initialize installs listeners without prompting', async () => {
  let requests = 0;
  const PushNotifications = {
    addListener: async () => ({ remove: async () => {} }),
    checkPermissions: async () => ({ receive: 'prompt' }),
    requestPermissions: async () => { requests += 1; return { receive: 'granted' }; },
    register: async () => {},
  };
  const push = createMobilePushRuntime(makeNativeWindow({ PushNotifications }));
  await push.initialize();
  assert.equal(requests, 0);
});

test('successful first room join prompts then registers', async () => {
  let requests = 0;
  let registrations = 0;
  const PushNotifications = {
    addListener: async () => ({ remove: async () => {} }),
    checkPermissions: async () => ({ receive: 'prompt' }),
    requestPermissions: async () => { requests += 1; return { receive: 'granted' }; },
    register: async () => { registrations += 1; },
  };
  const push = createMobilePushRuntime(makeNativeWindow({ PushNotifications }));
  await push.initialize();
  await push.onRoomJoined('ShittyChat');
  assert.equal(requests, 1);
  assert.equal(registrations, 1);
});
```

Add denied-permission test: no `register()` call, no thrown fatal error, ordinary room join result unchanged.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-push-runtime.test.js tests/android-bootstrap-contract.test.js
```

- [ ] **Step 3: Implement listener/permission flow**

```js
await PushNotifications.addListener('registration', ({ value } = {}) => {
  const fcmToken = String(value || '').trim();
  if (!fcmToken) return;
  void authenticatedPost('/api/mobile/push/register', {
    deviceId: getDeviceId(),
    fcmToken,
    deviceLabel: 'Android',
  }).catch((error) => win.console?.warn?.('[DizyChat] push registration failed', error));
});

const ensurePermissionAfterJoin = async () => {
  const current = await PushNotifications.checkPermissions();
  let state = current?.receive;
  if (state === 'prompt' || state === 'prompt-with-rationale') {
    state = (await PushNotifications.requestPermissions())?.receive;
  }
  if (state !== 'granted') return false;
  await PushNotifications.register();
  return true;
};
```

Track whether this installation has already attempted the permission prompt so repeated room joins do not hammer the user. If Android reports `denied`, do not ask again automatically.

- [ ] **Step 4: Load native push runtime before `chat.js`**

In `public/mobile-bootstrap.js`, after secure-session restore and backend routing:

```js
if (runtime.isNativeRuntime(window)) {
  await loadScript('/mobile-push.js');
  await window.dizychatMobilePush?.initialize?.();
}
```

Then continue current Socket.IO and `/chat.js` load order.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test tests/android-push-runtime.test.js tests/android-bootstrap-contract.test.js
git add public/mobile-push.js public/mobile-bootstrap.js tests/android-push-runtime.test.js tests/android-bootstrap-contract.test.js
git commit -m "feat: register Android push after room join"
```

---

### Task 3: Add Native DeviceState Plugin

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/DeviceStatePlugin.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/MainActivity.java`
- Test: `tests/android-device-state-contract.test.js`

**Interfaces:**
- Plugin name `DeviceState`.
- `getState()` returns `{ foreground, interactive }`.
- retained listener `stateChange` emits on activity resume/pause and screen on/off/user-present.

Capacitor `Plugin` exposes protected lifecycle hooks `handleOnResume()`, `handleOnPause()`, and `handleOnDestroy()`; use those hooks and call `super` before/after local handling consistently.

- [ ] **Step 1: Write RED source-contract tests**

```js
test('DeviceState plugin uses Capacitor lifecycle and PowerManager interactivity', () => {
  const source = fs.readFileSync('android/app/src/main/java/com/chat/dizychat/DeviceStatePlugin.java', 'utf8');
  assert.match(source, /@CapacitorPlugin\(name = "DeviceState"\)/);
  assert.match(source, /handleOnResume\(\)/);
  assert.match(source, /handleOnPause\(\)/);
  assert.match(source, /PowerManager\.isInteractive\(\)/);
  assert.match(source, /Intent\.ACTION_SCREEN_OFF/);
  assert.match(source, /Intent\.ACTION_SCREEN_ON/);
  assert.match(source, /notifyListeners\("stateChange"/);
});

test('MainActivity registers DeviceStatePlugin', () => {
  const source = fs.readFileSync('android/app/src/main/java/com/chat/dizychat/MainActivity.java', 'utf8');
  assert.match(source, /registerPlugin\(DeviceStatePlugin\.class\)/);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-device-state-contract.test.js
```

- [ ] **Step 3: Implement plugin**

```java
@CapacitorPlugin(name = "DeviceState")
public class DeviceStatePlugin extends Plugin {
    private boolean foreground = false;
    private BroadcastReceiver screenReceiver;

    private JSObject currentState() {
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject result = new JSObject();
        result.put("foreground", foreground);
        result.put("interactive", power != null && power.isInteractive());
        return result;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(currentState());
    }

    private void emitState() {
        notifyListeners("stateChange", currentState(), true);
    }
}
```

In `load()`, register one dynamic receiver for `ACTION_SCREEN_ON`, `ACTION_SCREEN_OFF`, `ACTION_USER_PRESENT`; its `onReceive` calls `emitState()`. Override:

```java
@Override protected void handleOnResume() { super.handleOnResume(); foreground = true; emitState(); }
@Override protected void handleOnPause() { foreground = false; emitState(); super.handleOnPause(); }
@Override protected void handleOnDestroy() { if (screenReceiver != null) getContext().unregisterReceiver(screenReceiver); screenReceiver = null; super.handleOnDestroy(); }
```

Guard receiver unregistration against already-unregistered runtime exceptions.

- [ ] **Step 4: Register plugin and compile**

Add `registerPlugin(DeviceStatePlugin.class);` to `MainActivity.onCreate()` with existing plugins unchanged.

```bash
node --test tests/android-device-state-contract.test.js
cd android && ./gradlew compileDebugJavaWithJavac --no-daemon
```

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/chat/dizychat/DeviceStatePlugin.java android/app/src/main/java/com/chat/dizychat/MainActivity.java tests/android-device-state-contract.test.js
git commit -m "feat: expose Android screen and foreground state"
```

---

### Task 4: Drive the Short-Lived Suppression Lease

**Files:**
- Modify: `public/mobile-push.js`
- Test: `tests/android-push-runtime.test.js`

**Interfaces:**
- `LEASE_TTL_MS = 15000`
- `HEARTBEAT_MS = 5000`
- Foreground+interactive => renew lease.
- Foreground+screen-off, background, or any non-interactive state => clear lease.

- [ ] **Step 1: Write RED state-machine tests**

Use injected fake timers/interval functions and capture authenticated POST bodies. Prove:

```js
await push.syncDeviceState({ foreground: true, interactive: true });
assert.deepEqual(posts.at(-1), { deviceId: push.getDeviceId(), interactive: true, ttlMs: 15000 });

await push.syncDeviceState({ foreground: true, interactive: false });
assert.deepEqual(posts.at(-1), { deviceId: push.getDeviceId(), interactive: false, ttlMs: 15000 });
```

Also prove background+interactive clears, heartbeat exists only while both values are true, and a transition back to interactive restarts one heartbeat rather than stacking intervals.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-push-runtime.test.js
```

- [ ] **Step 3: Implement state/heartbeat**

```js
const LEASE_TTL_MS = 15_000;
const HEARTBEAT_MS = 5_000;
let heartbeatId = null;

const postPresence = (interactive) => authenticatedPost('/api/mobile/push/presence', {
  deviceId: getDeviceId(),
  interactive,
  ttlMs: LEASE_TTL_MS,
});

const stopHeartbeat = () => {
  if (heartbeatId !== null) win.clearInterval(heartbeatId);
  heartbeatId = null;
};

const syncDeviceState = async ({ foreground = false, interactive = false } = {}) => {
  const suppress = Boolean(foreground && interactive);
  if (!suppress) {
    stopHeartbeat();
    await postPresence(false);
    return;
  }
  await postPresence(true);
  if (heartbeatId === null) heartbeatId = win.setInterval(() => { void postPresence(true); }, HEARTBEAT_MS);
};
```

`startPresenceTracking()` calls `DeviceState.getState()`, applies it, and subscribes to `stateChange`.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test tests/android-push-runtime.test.js
git add public/mobile-push.js tests/android-push-runtime.test.js
git commit -m "feat: sync Android push suppression lease"
```

---

### Task 5: Bind Device Context to Existing Join, Leave, and Logout Boundaries

**Files:**
- Modify: `public/chat.js`
- Modify: `public/mobile-push.js`
- Test: `tests/android-push-room-hooks.test.js`
- Test: existing `tests/account-navigation-ui-test.cjs`

**Interfaces:**
- Native join payload adds `deviceId`; browser join payload remains unchanged.
- `onRoomJoined(room)` is called only after existing `join room success`.
- Explicit native Leave sends `{ room, deviceId }`; browser Leave keeps its legacy shape if required by current tests.
- Logout calls `mobile-push.onLogout()` only for local lease cleanup; PR A server logout/revocation remains authority.

- [ ] **Step 1: Write RED room-hook tests**

Create a test seam/helper around join/leave payload construction and prove:

```js
assert.deepEqual(buildJoinPayload({ room: 'ShittyChat', username: 'Rob', password: 'x', deviceId: 'dev1' }), {
  room: 'ShittyChat', username: 'Rob', password: 'x', deviceId: 'dev1',
});
assert.equal(Object.hasOwn(buildJoinPayload({ room: 'ShittyChat', username: 'Rob', password: 'x', deviceId: '' }), 'deviceId'), false);
```

Simulate `join room success` and assert `onRoomJoined()` fires once. Simulate socket disconnect and assert `onRoomLeft()` does not fire. Simulate explicit Leave and assert native device ID is included.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-push-room-hooks.test.js
node tests/account-navigation-ui-test.cjs
```

The `.cjs` UI script is not auto-discovered by `npm test`; run it explicitly as shown.

- [ ] **Step 3: Add narrow hooks in current `chat.js`**

At the existing join payload construction:

```js
const deviceId = window.dizychatMobilePush?.getDeviceId?.() || '';
if (deviceId) payload.deviceId = deviceId;
socket.emit('join room', payload);
```

At the existing `join room success` listener:

```js
void window.dizychatMobilePush?.onRoomJoined?.(window.currentRoom);
```

At explicit Leave:

```js
const deviceId = window.dizychatMobilePush?.getDeviceId?.() || '';
if (deviceId) socket.emit('leave room', { room: window.currentRoom, deviceId });
else socket.emit('leave room', { room: window.currentRoom });
```

Do not call Leave hooks from disconnect/reconnect handling.

At existing account logout initiation/completion:

```js
void window.dizychatMobilePush?.onLogout?.();
```

`onLogout()` stops heartbeat and best-effort posts `interactive:false`; it never revokes the auth token itself.

- [ ] **Step 4: Run GREEN and full browser regressions**

```bash
node --test tests/android-push-room-hooks.test.js tests/android-push-runtime.test.js
node tests/account-navigation-ui-test.cjs
npm test
```

- [ ] **Step 5: Commit**

```bash
git add public/chat.js public/mobile-push.js tests/android-push-room-hooks.test.js tests/android-push-runtime.test.js
git commit -m "feat: bind Android push to room lifecycle"
```

---

### Task 6: Declare Android Notification Permission

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `tests/android-device-state-contract.test.js`

- [ ] **Step 1: Add RED manifest assertion**

```js
test('manifest declares POST_NOTIFICATIONS', () => {
  const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-device-state-contract.test.js
```

- [ ] **Step 3: Add exactly one permission**

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Do not add storage/location/background permissions.

- [ ] **Step 4: Run GREEN and manifest merge**

```bash
node --test tests/android-device-state-contract.test.js
cd android && ./gradlew processDebugMainManifest --no-daemon
```

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml tests/android-device-state-contract.test.js
git commit -m "feat: declare Android notification permission"
```

---

### Task 7: Add Build-Time Firebase Android Client Configuration Boundary

**Files:**
- Create: `scripts/prepare-firebase-android-config.js`
- Create: `tests/android-push-config.test.js`
- Modify: `.gitignore`
- Modify: `.github/workflows/android-slice1-ci.yml`
- Modify: `docs/android-private-apk.md`

**Interface:** `DIZYCHAT_FIREBASE_ANDROID_CONFIG_B64` -> untracked `android/app/google-services.json`.

- [ ] **Step 1: Write RED tests**

Test a valid config containing a client whose `package_name` is `com.chat.dizychat`; assert output JSON matches. Test wrong package name, malformed base64/JSON, and a service-account-shaped object containing `private_key`; all must fail without writing output.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-push-config.test.js
```

- [ ] **Step 3: Implement strict materializer**

```js
const encoded = String(process.env.DIZYCHAT_FIREBASE_ANDROID_CONFIG_B64 || '').trim();
if (!encoded) {
  console.log('[Android Push] Firebase Android client config not materialized.');
  process.exit(0);
}
const decoded = Buffer.from(encoded, 'base64').toString('utf8');
const config = JSON.parse(decoded);
if (Object.hasOwn(config, 'private_key')) throw new Error('Service-account credentials are not Android client config');
const matchesPackage = Array.isArray(config.client) && config.client.some((client) =>
  client?.client_info?.android_client_info?.package_name === 'com.chat.dizychat'
);
if (!matchesPackage) throw new Error('Firebase Android config does not target com.chat.dizychat');
fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
```

- [ ] **Step 4: Ignore generated config**

Add:

```gitignore
android/app/google-services.json
```

- [ ] **Step 5: Wire optional CI materialization**

Before Capacitor sync:

```yaml
- name: Prepare optional Firebase Android client config
  env:
    DIZYCHAT_FIREBASE_ANDROID_CONFIG_B64: ${{ secrets.DIZYCHAT_FIREBASE_ANDROID_CONFIG_B64 }}
  run: node scripts/prepare-firebase-android-config.js
```

Add `scripts/prepare-firebase-android-config.js` to workflow path triggers. Absence of the secret must still allow the existing debug build; real push acceptance requires a trusted config.

- [ ] **Step 6: Document client/server Firebase separation**

`docs/android-private-apk.md` must state:
- `google-services.json` is Android client project metadata and stays untracked;
- Firebase service-account private key remains server-only and is never accepted by the Android config script;
- push-capable acceptance APK requires a valid config for package `com.chat.dizychat`.

- [ ] **Step 7: Run GREEN and commit**

```bash
node --test tests/android-push-config.test.js
npm test
git add scripts/prepare-firebase-android-config.js tests/android-push-config.test.js .gitignore .github/workflows/android-slice1-ci.yml docs/android-private-apk.md
git commit -m "build: add Android Firebase client config boundary"
```

---

### Task 8: Exact-Head PR B Gate and Real Device-State Proof

- [ ] **Step 1: Full deterministic gate**

```bash
npm ci
npm test
node tests/account-navigation-ui-test.cjs
```

- [ ] **Step 2: Generic debug build without Firebase client config**

```bash
rm -f android/app/google-services.json
npm run android:prepare
npx cap sync android
cd android && ./gradlew assembleDebug --no-daemon
```

Expected: build passes; push registration is unavailable at runtime without client config.

- [ ] **Step 3: Push-capable acceptance build**

On trusted operator machine/CI, materialize the real Android Firebase config then rebuild:

```bash
node scripts/prepare-firebase-android-config.js
npx cap sync android
cd android && ./gradlew assembleDebug --no-daemon
```

- [ ] **Step 4: Real-device state acceptance**

Prove in order:

1. Launch/login does not prompt for notifications.
2. First successful room join prompts.
3. Grant => exactly one current FCM device registration for this `deviceId`.
4. Foreground + screen on => 15s suppression lease stays fresh via 5s heartbeat.
5. Lock/screen off while still in the room => native state becomes `interactive:false`; server lease clears immediately when request is delivered, otherwise it expires no later than 15s after the last heartbeat.
6. After lease clear/expiry, the device is push eligible while screen remains off.
7. Unlock/foreground => heartbeat resumes.
8. Background app => lease clears.
9. Reopen/app process restart => same stable `deviceId` is reused.
10. Explicit Leave => only that device's room subscription is removed.
11. Browser login/activity does not alter Android subscription or lease.

- [ ] **Step 5: Exact-head evidence**

```bash
git rev-parse HEAD
git status --short
git diff --stat origin/main...HEAD
```

Verify `android/app/google-services.json` is untracked/ignored. Push/open draft PR via connected GitHub and require CI on this exact SHA; any later commit requires the gate again.

---

## PR B Acceptance Boundary

PR B is complete only when exact-head CI plus real-device proof establishes:

- permission prompt occurs after first successful room join, not launch/login;
- denied permission does not break chat;
- granted permission registers/rotates FCM token against the current mobile session;
- stable device ID survives process restart/app update;
- native state uses Capacitor lifecycle hooks plus `PowerManager.isInteractive()`;
- foreground+interactive lease refreshes every 5 seconds with 15-second fail-safe expiry;
- screen off/background removes suppression immediately when possible and always by lease expiry;
- join/Leave changes only that Android device subscription; disconnect/background does not unsubscribe;
- browser behaviour is unchanged;
- Firebase Android client config is untracked build material, not server authority;
- full deterministic tests and Android debug build pass on exact final head.
