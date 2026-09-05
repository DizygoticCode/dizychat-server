# Android Slice 2 PR B — Android Registration and Device State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register each Android installation with DizyChat/FCM, request notification permission after the first successful room join, persist per-device identity, bind room join/leave to the server subscription authority, and maintain a reliable short-lived `foreground + screen interactive` suppression lease.

**Architecture:** Keep push orchestration in a focused browser module loaded by the native bootstrap, use the existing Capacitor PushNotifications plugin for permission/token registration, and add one narrow native `DeviceState` plugin for Android lifecycle/screen interactivity. The browser module authenticates all server calls with the already-restored mobile session token; the server remains authoritative and the native layer never stores a second auth credential.

**Tech Stack:** Capacitor 7.4.4, `@capacitor/push-notifications` 7.0.3, Android Java, PowerManager/BroadcastReceiver, existing SecureSession plugin, Node deterministic tests, Gradle/Android SDK.

**Spec:** `docs/superpowers/specs/2026-09-05-android-slice2-push-design.md`

## Global Constraints

- Start PR B from the exact merged/green head of PR A, not directly from the old Slice 1 base.
- The stable device ID identifies one app installation; it is not an authentication token.
- Every server mutation still uses the durable mobile session restored by `SecureSession`.
- Request Android notification permission only after a successful first room join.
- Declining permission must leave chat/auth/room joining fully functional.
- Browser sessions must never register an Android push device or alter Android suppression leases.
- Suppression is true only for `app foreground AND screen interactive`.
- Screen off/locked must clear suppression immediately when possible; a short lease expiry is the fail-safe if the WebView is suspended before the clear reaches the server.
- Use a 15-second suppression lease refreshed every 5 seconds while foreground+interactive; server PR A still enforces its maximum cap.
- Explicit room Leave removes the device subscription; transient disconnect/background/swipe-away does not.
- FCM client configuration is not a Firebase service credential, but the project keeps `android/app/google-services.json` out of Git and supplies it at build/test time.
- Use TDD and focused commits.

---

## File Structure

**Create**

- `public/mobile-push.js` — native-only push registration, stable device ID, permission timing, FCM token registration/rotation, server registration, suppression-lease heartbeat, and push event forwarding hooks.
- `android/app/src/main/java/com/chat/dizychat/DeviceStatePlugin.java` — native lifecycle + `PowerManager.isInteractive()` + screen-on/off listener.
- `scripts/prepare-firebase-android-config.js` — optional build-time materialization of `google-services.json` from a local/CI base64 environment value.
- `tests/android-push-runtime.test.js`
- `tests/android-device-state-contract.test.js`
- `tests/android-push-config.test.js`

**Modify**

- `public/mobile-bootstrap.js` — load/initialize `mobile-push.js` after secure-session restore and backend routing, before `chat.js`.
- `public/mobile-runtime.js` — add only small native helper(s) needed for authenticated backend calls if they are genuinely shared; do not move push business logic into this general runtime.
- `public/chat.js` — call narrow `window.dizychatMobilePush` hooks at successful room join, explicit room leave, logout, and read/view boundaries; browser behaviour remains no-op.
- `android/app/src/main/java/com/chat/dizychat/MainActivity.java` — register `DeviceStatePlugin`.
- `android/app/src/main/AndroidManifest.xml` — add `POST_NOTIFICATIONS` and screen-state receiver requirements only if the plugin implementation needs explicit manifest declarations.
- `.gitignore` — ignore `android/app/google-services.json` if not already ignored.
- `.github/workflows/android-slice1-ci.yml` — include `scripts/prepare-firebase-android-config.js` in path trigger and preserve a no-Firebase-config debug-build path.
- `docs/android-private-apk.md` — add Android Firebase client-config setup and explain that service-account credentials remain server-only.

---

### Task 1: Add Stable Native Device Identity and Authenticated Push HTTP Helper

**Files:**
- Create: `public/mobile-push.js`
- Test: `tests/android-push-runtime.test.js`

**Interfaces:**
- `window.dizychatMobilePush.getDeviceId() -> string`
- `window.dizychatMobilePush.authenticatedPost(path, body) -> Promise<Response>`
- Device ID storage key: `dizychat-android-device-id-v1` in Capacitor WebView localStorage.

- [ ] **Step 1: Write RED tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const createWindow = () => {
  const store = new Map();
  return {
    crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
    localStorage: { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)) },
    dizychatAuthV2: { readToken: () => 'dcm1.secret' },
    Capacitor: { isNativePlatform: () => true, Plugins: {} },
    fetch: async (url, init) => ({ url, init, ok: true, json: async () => ({}) }),
  };
};

test('stable device id is generated once and reused', () => {
  const win = createWindow();
  const push = createMobilePushRuntime(win);
  assert.equal(push.getDeviceId(), '11111111-2222-4333-8444-555555555555');
  assert.equal(push.getDeviceId(), '11111111-2222-4333-8444-555555555555');
});

test('authenticatedPost uses current restored mobile session token', async () => {
  const win = createWindow();
  const push = createMobilePushRuntime(win);
  const response = await push.authenticatedPost('/api/mobile/push/register', { deviceId: push.getDeviceId() });
  assert.equal(response.init.headers.Authorization, 'Bearer dcm1.secret');
});
```

Also test that the module returns inert/no-op behaviour when `Capacitor.isNativePlatform()` is false.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-push-runtime.test.js
```
Expected: FAIL.

- [ ] **Step 3: Implement module wrapper and stable ID**

Use the same UMD/CommonJS-friendly shape as `mobile-runtime.js` so Node tests can import the factory:

```js
(function initMobilePush(root, factory) {
  const runtime = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = { createMobilePushRuntime: factory };
  if (root && typeof root === 'object') root.dizychatMobilePush = runtime;
})(typeof window !== 'undefined' ? window : globalThis, (win = {}) => {
  const DEVICE_ID_KEY = 'dizychat-android-device-id-v1';
  const isNative = () => Boolean(win.Capacitor?.isNativePlatform?.());
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
    return win.fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  };
  return { getDeviceId, authenticatedPost };
});
```

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/android-push-runtime.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
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
- `initialize()` installs listeners but does **not** request permission immediately.
- `onFirstRoomJoined(room)` requests permission if not previously resolved, then calls `PushNotifications.register()` when granted.
- `registration` event posts `{ deviceId, fcmToken, deviceLabel }` to `/api/mobile/push/register`.
- Permission decision storage key: `dizychat-android-notification-permission-asked-v1`.

- [ ] **Step 1: Add RED permission-timing tests**

```js
test('initialize does not prompt for notification permission', async () => {
  let requests = 0;
  const PushNotifications = { addListener: async () => ({}), checkPermissions: async () => ({ receive: 'prompt' }), requestPermissions: async () => { requests += 1; return { receive: 'granted' }; }, register: async () => {} };
  const push = createMobilePushRuntime(makeNativeWindow({ PushNotifications }));
  await push.initialize();
  assert.equal(requests, 0);
});

test('first successful room join requests permission then registers', async () => {
  let requests = 0, registers = 0;
  const PushNotifications = { addListener: async () => ({}), checkPermissions: async () => ({ receive: 'prompt' }), requestPermissions: async () => { requests += 1; return { receive: 'granted' }; }, register: async () => { registers += 1; } };
  const push = createMobilePushRuntime(makeNativeWindow({ PushNotifications }));
  await push.initialize();
  await push.onFirstRoomJoined('ShittyChat');
  assert.equal(requests, 1);
  assert.equal(registers, 1);
});
```

Add a denial test asserting no `register()` call and no thrown fatal error.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-push-runtime.test.js tests/android-bootstrap-contract.test.js
```
Expected: FAIL.

- [ ] **Step 3: Implement listeners and permission flow**

Listener setup:

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
```

Permission flow:

```js
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

Do not call it from `initialize()`.

- [ ] **Step 4: Load push runtime before chat.js in bootstrap**

After backend routing/native media permissions and before socket/chat load:

```js
if (runtime.isNativeRuntime(window)) {
  await loadScript('/mobile-push.js');
  await window.dizychatMobilePush?.initialize?.();
}
```

Update bootstrap tests to assert `mobile-push.js` appears before `/chat.js` only in native mode.

- [ ] **Step 5: Run GREEN**

```bash
node --test tests/android-push-runtime.test.js tests/android-bootstrap-contract.test.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/mobile-push.js public/mobile-bootstrap.js tests/android-push-runtime.test.js tests/android-bootstrap-contract.test.js
git commit -m "feat: register Android push after first room join"
```

---

### Task 3: Add Native DeviceState Plugin

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/DeviceStatePlugin.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/MainActivity.java`
- Test: `tests/android-device-state-contract.test.js`

**Interfaces:**
- Capacitor plugin name: `DeviceState`.
- Method: `getState()` returns `{ foreground: boolean, interactive: boolean }`.
- Listener: `stateChange` with same payload, emitted on activity resume/pause and `ACTION_SCREEN_ON`/`ACTION_SCREEN_OFF`/`ACTION_USER_PRESENT` changes.

- [ ] **Step 1: Write RED native-contract test**

```js
test('DeviceState plugin reports PowerManager interactivity and screen broadcasts', () => {
  const source = fs.readFileSync('android/app/src/main/java/com/chat/dizychat/DeviceStatePlugin.java', 'utf8');
  assert.match(source, /@CapacitorPlugin\(name = "DeviceState"\)/);
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
Expected: FAIL because file does not exist.

- [ ] **Step 3: Implement the plugin**

Core state method:

```java
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
```

Register a `BroadcastReceiver` in `load()` for screen on/off/user present and unregister it in `handleOnDestroy()`. Update `foreground` in `handleOnResume()` / `handleOnPause()` and call:

```java
notifyListeners("stateChange", currentState(), true);
```

Use `true` for retained delivery so a brief screen-state transition is not silently lost while the WebView is suspended.

- [ ] **Step 4: Register plugin in `MainActivity`**

```java
registerPlugin(DeviceStatePlugin.class);
```

Keep existing SecureSession/MobileShell/NativePermissions registration unchanged.

- [ ] **Step 5: Run tests and Java compile**

```bash
node --test tests/android-device-state-contract.test.js
cd android && ./gradlew compileDebugJavaWithJavac --no-daemon
```
Expected: PASS.

- [ ] **Step 6: Commit**

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
- Lease TTL: 15,000 ms.
- Heartbeat interval: 5,000 ms.
- `syncDeviceState(state)` posts `interactive: true` only when `foreground && interactive`; every other state posts `interactive: false`.
- `startPresenceTracking()` attaches `DeviceState.stateChange`, performs an initial `getState()`, and manages heartbeat.

- [ ] **Step 1: Write RED state-machine tests with fake timers**

```js
test('foreground plus interactive renews lease', async () => {
  const posts = [];
  const push = createMobilePushRuntime(makeNativeWindow({ deviceState: { getState: async () => ({ foreground: true, interactive: true }), addListener: async () => ({}) }, posts }));
  await push.startPresenceTracking();
  assert.deepEqual(posts[0].body, { deviceId: push.getDeviceId(), interactive: true, ttlMs: 15000 });
});

test('screen off clears lease even while activity was foreground', async () => {
  await push.syncDeviceState({ foreground: true, interactive: false });
  assert.equal(posts.at(-1).body.interactive, false);
});
```

Add tests for background+interactive => clear, duplicate clear coalescing, and heartbeat only while both true.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-push-runtime.test.js
```
Expected: FAIL.

- [ ] **Step 3: Implement state synchronization and heartbeat**

```js
const LEASE_TTL_MS = 15_000;
const HEARTBEAT_MS = 5_000;
let heartbeat = null;
let lastSuppressed = null;

const postPresence = (suppressed) => authenticatedPost('/api/mobile/push/presence', {
  deviceId: getDeviceId(),
  interactive: suppressed,
  ttlMs: LEASE_TTL_MS,
});

const syncDeviceState = async ({ foreground = false, interactive = false } = {}) => {
  const suppressed = Boolean(foreground && interactive);
  if (!suppressed) {
    if (heartbeat) win.clearInterval(heartbeat);
    heartbeat = null;
    lastSuppressed = false;
    await postPresence(false);
    return;
  }
  await postPresence(true);
  lastSuppressed = true;
  if (!heartbeat) heartbeat = win.setInterval(() => { void postPresence(true); }, HEARTBEAT_MS);
};
```

If an immediate screen-off clear cannot leave the suspended WebView, the 15-second server lease expiry is the fail-safe. Do not increase the TTL to hide flaky state updates.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/android-push-runtime.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/mobile-push.js tests/android-push-runtime.test.js
git commit -m "feat: sync Android push suppression lease"
```

---

### Task 5: Bind Push Device Context to Successful Join, Leave, and Logout

**Files:**
- Modify: `public/chat.js`
- Modify: `public/mobile-push.js`
- Test: `tests/android-push-runtime.test.js`
- Test: extend `tests/account-navigation-ui-test.cjs` only if it already covers join/leave hooks; otherwise create `tests/android-push-room-hooks.test.js`.

**Interfaces:**
- `getSocketContext() -> { deviceId }` for native only.
- Successful native join includes `deviceId` in the existing join payload or sends one authenticated `mobile push context` event immediately before the existing join event.
- `onRoomJoined(room)` triggers first-join permission flow but does not independently authorize subscription; server PR A subscribes only after accepted join.
- `onRoomLeft(room)` notifies the existing server leave path with device context.
- `onLogout()` clears lease locally and calls `/api/mobile/push/presence` with `interactive:false`; server revocation remains authoritative.

- [ ] **Step 1: Write RED hook tests**

```js
test('native join payload includes stable device id', () => {
  const payload = buildJoinPayloadForTest({ nativeDeviceId: 'dev-1', room: 'ShittyChat' });
  assert.equal(payload.deviceId, 'dev-1');
});

test('browser join payload remains unchanged', () => {
  const payload = buildJoinPayloadForTest({ nativeDeviceId: '', room: 'ShittyChat' });
  assert.equal(Object.hasOwn(payload, 'deviceId'), false);
});
```

Add a test that explicit Leave includes/removes the native device context but socket disconnect does not call `onRoomLeft()`.

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-push-room-hooks.test.js tests/android-push-runtime.test.js
```
Expected: FAIL.

- [ ] **Step 3: Add narrow hooks at existing successful boundaries**

At the existing join submission payload construction:

```js
const deviceId = window.dizychatMobilePush?.getDeviceId?.() || '';
if (deviceId) payload.deviceId = deviceId;
```

Only after the existing server join success is received:

```js
void window.dizychatMobilePush?.onRoomJoined?.(window.currentRoom);
```

At explicit Leave:

```js
const deviceId = window.dizychatMobilePush?.getDeviceId?.() || '';
socket.emit('leave room', { room: window.currentRoom, deviceId });
```

Preserve the existing browser event shape if the current server uses a scalar room name: branch only for native and teach the server handler to accept both legacy scalar and new object form, rather than breaking browser clients.

- [ ] **Step 4: Wire logout cleanup without changing auth semantics**

Before/alongside existing durable-token clear:

```js
void window.dizychatMobilePush?.onLogout?.();
```

`onLogout()` must not be the authority that revokes the session; the existing logout path remains responsible for that.

- [ ] **Step 5: Run GREEN and browser regressions**

```bash
node --test tests/android-push-room-hooks.test.js tests/account-navigation-ui-test.cjs tests/android-push-runtime.test.js
npm test
```
Expected: PASS and normal browser join/leave/auth behaviour unchanged.

- [ ] **Step 6: Commit**

```bash
git add public/chat.js public/mobile-push.js tests/android-push-room-hooks.test.js tests/android-push-runtime.test.js
git commit -m "feat: bind push subscriptions to Android room lifecycle"
```

---

### Task 6: Add Android Notification Permission Manifest Contract

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `tests/android-device-state-contract.test.js`

**Interfaces:** Android 13+ notification permission is `android.permission.POST_NOTIFICATIONS`; runtime request remains through Capacitor PushNotifications.

- [ ] **Step 1: Add RED manifest assertion**

```js
test('Android manifest declares POST_NOTIFICATIONS', () => {
  const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-device-state-contract.test.js
```
Expected: FAIL.

- [ ] **Step 3: Add permission**

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Do not add unrelated storage, background-location, microphone, or camera permissions.

- [ ] **Step 4: Run GREEN and manifest merge check**

```bash
node --test tests/android-device-state-contract.test.js
cd android && ./gradlew processDebugMainManifest --no-daemon
```
Expected: PASS.

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
- Modify: `docs/android-private-apk.md`
- Modify: `.github/workflows/android-slice1-ci.yml`

**Interfaces:**
- Environment input: `DIZYCHAT_FIREBASE_ANDROID_CONFIG_B64` containing base64 of the Android client `google-services.json`.
- Output: `android/app/google-services.json` with mode `0600` where supported.
- Without the env value, script removes no existing local file and exits success with a clear “push config not materialized” message.
- Firebase service-account JSON is **not** accepted by this script.

- [ ] **Step 1: Write RED script tests**

```js
test('materializes valid Android google-services JSON from base64', async () => {
  const config = { project_info: { project_id: 'dizychat-test' }, client: [{ client_info: { android_client_info: { package_name: 'com.chat.dizychat' } } }] };
  const result = runPrepare({ DIZYCHAT_FIREBASE_ANDROID_CONFIG_B64: Buffer.from(JSON.stringify(config)).toString('base64') });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).client[0].client_info.android_client_info.package_name, 'com.chat.dizychat');
});

test('rejects config for another package name', () => {
  // package_name=com.other.app => non-zero and no output file
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/android-push-config.test.js
```
Expected: FAIL.

- [ ] **Step 3: Implement strict config materialization**

Parse decoded JSON and require at least one client with:

```js
client?.client_info?.android_client_info?.package_name === 'com.chat.dizychat'
```

Write exactly to `android/app/google-services.json`. Reject malformed base64/JSON and service-account-shaped objects containing `private_key`.

- [ ] **Step 4: Ignore generated client config**

Add:

```gitignore
android/app/google-services.json
```

- [ ] **Step 5: Keep ordinary PR CI buildable without Firebase config**

Add a step before `npx cap sync android`:

```yaml
- name: Prepare optional Firebase Android client config
  env:
    DIZYCHAT_FIREBASE_ANDROID_CONFIG_B64: ${{ secrets.DIZYCHAT_FIREBASE_ANDROID_CONFIG_B64 }}
  run: node scripts/prepare-firebase-android-config.js
```

If the secret is absent, the existing Gradle optional-google-services behaviour still allows deterministic debug build. For real-device push acceptance, the secret or equivalent trusted local config **must** be present; record this distinction in docs.

- [ ] **Step 6: Run GREEN**

```bash
node --test tests/android-push-config.test.js
npm test
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/prepare-firebase-android-config.js tests/android-push-config.test.js .gitignore .github/workflows/android-slice1-ci.yml docs/android-private-apk.md
git commit -m "build: add Android Firebase client config boundary"
```

---

### Task 8: Exact-Head PR B Gate and Device-State Proof

**Files:** no feature edits unless a failing gate proves a defect.

- [ ] **Step 1: Run deterministic suite**

```bash
npm ci
npm test
```
Expected: PASS.

- [ ] **Step 2: Build without Firebase client config to preserve generic CI**

```bash
rm -f android/app/google-services.json
npm run android:prepare
npx cap sync android
cd android && ./gradlew assembleDebug --no-daemon
```
Expected: PASS, with push registration unavailable at runtime but ordinary app working.

- [ ] **Step 3: Build a push-capable acceptance APK with trusted client config**

On the trusted operator machine (or CI with configured secret):

```bash
export DIZYCHAT_FIREBASE_ANDROID_CONFIG_B64="$(base64 -w0 /secure/path/google-services.json)"
node scripts/prepare-firebase-android-config.js
npx cap sync android
cd android && ./gradlew assembleDebug --no-daemon
```

On Windows PowerShell, use `[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\secure\google-services.json'))` instead of `base64 -w0`.

- [ ] **Step 4: Real-device state acceptance before PR B merge**

With server push transport still disabled if PR C notification rendering is not ready, use server logs/test endpoint to verify state registration:

```text
1. Sign into Android account.
2. Join first room: permission prompt appears here, not at launch/login.
3. Grant permission: FCM registration creates/updates exactly one device record.
4. Keep app foreground + screen on: suppression lease remains fresh.
5. Lock screen while still in room: state changes to non-interactive and lease clears, or expires within 15 seconds if WebView delivery races suspension.
6. Unlock/return: lease resumes.
7. Background app: lease clears.
8. Reopen: same stable deviceId is reused.
9. Leave room: only this device's room subscription disappears.
10. Browser login/activity does not alter the Android device lease/subscription.
```

- [ ] **Step 5: Confirm exact head and clean diff**

```bash
git rev-parse HEAD
git status --short
git diff --stat origin/main...HEAD
```

Expected: clean tree; no `google-services.json` tracked.

- [ ] **Step 6: Push/open draft PR with exact SHA and wait for CI**

Use connected GitHub operations. If any commit changes the head after CI starts, require the new exact head to pass again.

---

## PR B Acceptance Boundary

PR B is complete only when exact-head CI plus real-device proof establishes:

- permission is prompted after first successful room join;
- denied permission does not break chat;
- granted permission registers/rotates FCM token against the current mobile session;
- stable device ID survives process restart/app update;
- native screen state uses `PowerManager.isInteractive()` and lifecycle state;
- foreground+interactive lease refreshes every 5 seconds with 15-second fail-safe expiry;
- screen off, background, or stale state clears/loses suppression;
- room join/Leave changes only that Android device subscription;
- disconnect/background does not unsubscribe;
- browser behaviour is unchanged;
- Firebase client config is build-time material, not committed service credentials;
- full deterministic tests and Android debug build pass on exact final head.
