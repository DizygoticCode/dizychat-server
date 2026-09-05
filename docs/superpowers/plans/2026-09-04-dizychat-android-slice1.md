# DizyChat Android Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private sideloaded Android DizyChat APK that bundles the existing web client, connects only to the self-hosted `https://dizychat.com` backend in production, persists login securely across app restarts, and preserves the existing web behaviour.

**Architecture:** Keep the existing Capacitor shell and `public/` client. Add a small browser/native runtime boundary for backend URL resolution, startup ordering, CORS, secure session restoration and Android shell behaviour; native secrets remain in Android Keystore and no server credentials are compiled into the APK.

**Tech Stack:** Node.js 22, Express 4, Socket.IO 4.8, Capacitor 7.4.4, Android Java, Android Keystore AES/GCM, Gradle 9.2 / Android Gradle Plugin 8.13.1, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-04-dizychat-android-slice1-design.md`

## Global Constraints

- Production mobile backend is exactly `https://dizychat.com`.
- App ID remains exactly `com.chat.dizychat`; app name remains `DizyChat`.
- Normal website token persistence stays `sessionStorage`-scoped.
- Android persistent session uses Android Keystore-backed storage; there is no long-lived plain-text browser-storage fallback.
- Temporary network failure must not clear the saved login; explicit logout or server invalidation must clear it.
- Uploads remain on the existing `/upload` route and therefore retain the deployed ClamAV quarantine/scan gate.
- No Google Play, iOS native work, push delivery, inline notification reply, or mark-as-read notification work in Slice 1.
- No Render dependency or second backend is introduced.
- No keystore, signing password, server credential, MongoDB URI, admin credential, API key, or other secret is committed or embedded in the APK.

---

## File Structure

- `public/mobile-runtime.js` — pure/shared native-runtime helpers plus browser bootstrap hooks: native detection, backend-origin resolution, backend fetch routing, external-link decision and back-action decision.
- `public/mobile-bootstrap.js` — startup sequencing: restore native session first, load Socket.IO client from the correct origin, then load `chat.js`.
- `public/app-config.js` — single production backend/default debug-override contract.
- `public/auth-v2-client.js` — browser session adapter plus async Android secure-session adapter.
- `public/chat.js` — consume the shared session adapter, expose minimal mobile back hook, keep existing chat logic intact.
- `public/login.html` — load app config/auth/runtime/bootstrap instead of assuming `/socket.io/socket.io.js` exists on the bundled origin.
- `public/index.html` — send Capacitor-native launches straight into the chat/login surface while leaving website landing behaviour unchanged.
- `index.js` — exact CORS allowance for trusted Capacitor origins on HTTP and Socket.IO without widening account authorization.
- `android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java` — encrypted token storage using an AES key generated in `AndroidKeyStore`.
- `android/app/src/main/java/com/chat/dizychat/MobileShellPlugin.java` — safe external `http(s)` handoff through an Android `ACTION_VIEW` intent.
- `android/app/src/main/java/com/chat/dizychat/MainActivity.java` — register the two custom plugins and delegate Android Back to the web client before falling back to normal Activity back behaviour.
- `android/app/build.gradle` — remove legacy server-secret `BuildConfig` fields and add release signing that reads only process environment variables.
- `android/app/src/main/AndroidManifest.xml` — disable backup for the app session boundary; keep only minimum permissions.
- `tests/android-mobile-runtime.test.js` — runtime/backend/external/back pure contracts.
- `tests/android-secure-session.test.js` — browser/native session adapter behaviour with a mocked Capacitor plugin.
- `tests/android-native-contract.test.js` — source-level checks for Keystore, no APK-embedded server secrets, manifest and native-plugin wiring.
- `tests/android-native-cors.test.js` — CORS/source contract for trusted native origins.
- `.github/workflows/android-slice1-ci.yml` — deterministic suite + Capacitor sync + debug APK build artifact.
- `docs/android-private-apk.md` — private signing/build/install/acceptance runbook with no secret material.

---

### Task 1: Canonical native backend and startup boundary

**Files:**
- Create: `public/mobile-runtime.js`
- Create: `public/mobile-bootstrap.js`
- Modify: `public/app-config.js`
- Modify: `public/login.html`
- Modify: `public/index.html`
- Modify: `index.js`
- Test: `tests/android-mobile-runtime.test.js`
- Test: `tests/android-native-cors.test.js`

**Interfaces:**
- Produces `window.dizychatMobileRuntime.isNativeRuntime(windowLike)`.
- Produces `window.dizychatMobileRuntime.resolveBackendOrigin(windowLike, config)` returning `''` for normal web and an `http(s)` origin for native.
- Produces `window.dizychatMobileRuntime.resolveBackendUrl(input, origin)` and `shouldRouteBackendRequest(path)`.
- Produces `window.dizychatMobileRuntime.shouldOpenExternally(url, backendOrigin)` and `decideBackAction(state)`.
- `mobile-bootstrap.js` waits for `window.dizychatAuthV2.restoreNativeSession()` before loading Socket.IO and `chat.js`.

- [ ] **Step 1: Write failing runtime tests**

Create `tests/android-mobile-runtime.test.js` with Node tests that load the runtime helper in a VM/CommonJS-safe way and assert:

```js
assert.equal(runtime.isNativeRuntime({ Capacitor: { isNativePlatform: () => true }, location: { origin: 'https://localhost' } }), true);
assert.equal(runtime.resolveBackendOrigin(nativeWindow, config), 'https://dizychat.com');
assert.equal(runtime.resolveBackendOrigin(webWindow, config), '');
assert.equal(runtime.resolveBackendUrl('/upload', 'https://dizychat.com'), 'https://dizychat.com/upload');
assert.equal(runtime.shouldRouteBackendRequest('/emojis.json'), false);
assert.equal(runtime.shouldRouteBackendRequest('/api/calls/status'), true);
assert.equal(runtime.shouldRouteBackendRequest('/upload'), true);
assert.equal(runtime.shouldOpenExternally('https://example.org/x', 'https://dizychat.com'), true);
assert.equal(runtime.shouldOpenExternally('https://dizychat.com/uploads/a.jpg', 'https://dizychat.com'), false);
assert.equal(runtime.decideBackAction({ transientOpen: true, inChat: true }), 'close-transient');
assert.equal(runtime.decideBackAction({ transientOpen: false, inChat: true }), 'leave-chat');
assert.equal(runtime.decideBackAction({ transientOpen: false, inChat: false }), 'exit-app');
```

- [ ] **Step 2: Run the failing runtime test**

Run: `node --test tests/android-mobile-runtime.test.js`

Expected: FAIL because `public/mobile-runtime.js` does not yet exist.

- [ ] **Step 3: Implement the runtime helper and config**

`public/app-config.js` must expose one canonical native backend contract:

```js
window.dizychatConfig = Object.assign({
  defaultNativeBackendUrl: 'https://dizychat.com',
  backendUrlStorageKey: 'dizychat-backend-url',
  socketUrl: '',
  socketOptions: {},
}, window.dizychatConfig || {});
```

`public/mobile-runtime.js` must use `window.Capacitor?.isNativePlatform()` first, then `capacitor:`, `file:`, `http://localhost` and `https://localhost` as compatibility signals. Debug override values are accepted only when `new URL(value)` parses and the protocol is `http:` or `https:`. The runtime must route only backend paths (`/api/`, `/upload`, `/tenor-proxy`, `/giphy-search`, `/soundboard-clips`) and must leave bundled assets such as `/emojis.json` local.

The helper may patch `window.fetch` only on native runs, preserving external absolute URLs and local static assets while prefixing the known backend paths with the resolved production/debug origin.

- [ ] **Step 4: Implement startup sequencing**

Change `public/login.html` from static `/socket.io/socket.io.js` + `chat.js` loading to:

```html
<script src="/app-config.js"></script>
<script src="/auth-v2-client.js"></script>
<script src="/mobile-runtime.js"></script>
<script src="/mobile-bootstrap.js"></script>
```

`public/mobile-bootstrap.js` must:

```js
await window.dizychatAuthV2.restoreNativeSession();
const backend = window.dizychatMobileRuntime.resolveBackendOrigin(window, window.dizychatConfig);
await loadScript(backend ? `${backend}/socket.io/socket.io.js` : '/socket.io/socket.io.js');
await loadScript('/chat.js');
```

Failures must render a visible connection/bootstrap error and retain any securely stored token rather than clearing it.

On `public/index.html`, add an early native-only redirect to `/login.html`; a normal browser stays on the existing marketing page.

- [ ] **Step 5: Add exact native-origin CORS tests and middleware**

Create `tests/android-native-cors.test.js` asserting `index.js` contains only the trusted default Capacitor origins `https://localhost`, `http://localhost`, and `capacitor://localhost` in its native-origin set and applies them to both Socket.IO and HTTP CORS handling.

Implement a native-origin set in `index.js`; merge those origins into a configured Socket.IO array allowlist, and add an Express middleware that, only when `Origin` is one of those trusted native origins, returns:

```text
Access-Control-Allow-Origin: <exact request origin>
Vary: Origin
Access-Control-Allow-Methods: GET,POST,OPTIONS
Access-Control-Allow-Headers: Content-Type,Authorization
```

Return `204` for trusted native `OPTIONS`. Do not turn general HTTP CORS into `*`.

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
node --test tests/android-mobile-runtime.test.js tests/android-native-cors.test.js
npm test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add public/app-config.js public/mobile-runtime.js public/mobile-bootstrap.js public/login.html public/index.html index.js tests/android-mobile-runtime.test.js tests/android-native-cors.test.js
git commit -m "feat: add Android native backend boundary"
```

---

### Task 2: Keystore-backed persistent Android account session

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/MainActivity.java`
- Modify: `public/auth-v2-client.js`
- Modify: `public/chat.js`
- Test: `tests/android-secure-session.test.js`
- Test: `tests/android-native-contract.test.js`

**Interfaces:**
- Native plugin name: `SecureSession`.
- Native methods: `readToken() -> { token: string }`, `writeToken({ token })`, `clearToken()`.
- JS adapter keeps synchronous `readToken()` for the current WebView copy and adds async `restoreNativeSession()`, `persistToken(token)`, and `clearPersistentToken()`.

- [ ] **Step 1: Write failing session and native-contract tests**

`tests/android-secure-session.test.js` must verify with mocked `sessionStorage` and mocked `Capacitor.Plugins.SecureSession` that:

```js
await auth.restoreNativeSession(); // copies secure token into sessionStorage
await auth.persistToken('abc');    // writes sessionStorage + SecureSession.writeToken
await auth.clearPersistentToken(); // clears both
```

The same adapter running without Capacitor must continue using only `sessionStorage`.

`tests/android-native-contract.test.js` must assert the Java plugin uses `AndroidKeyStore`, `KeyProperties.KEY_ALGORITHM_AES`, `BLOCK_MODE_GCM`, `ENCRYPTION_PADDING_NONE`, random IV bytes, and stores only Base64 ciphertext/IV in private `SharedPreferences`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/android-secure-session.test.js tests/android-native-contract.test.js
```

Expected: FAIL because the plugin/adapter do not exist yet.

- [ ] **Step 3: Implement `SecureSessionPlugin`**

Create a Capacitor `@CapacitorPlugin(name = "SecureSession")` Java plugin. Use alias `dizychat_session_key_v1`, private prefs `dizychat_secure_session_v1`, AES/GCM/NoPadding and a new 12-byte IV per write. Store `iv` and `ciphertext` Base64 strings only. Empty token delegates to clear. Any cryptographic/storage failure rejects the plugin call; do not write the token to unencrypted persistent storage.

- [ ] **Step 4: Register plugin and implement JS adapter**

Register `SecureSessionPlugin.class` in `MainActivity.onCreate()` before `super.onCreate(savedInstanceState)` using Capacitor's `registerPlugin` pattern appropriate for the existing `BridgeActivity`.

Refactor `public/auth-v2-client.js` so the website remains synchronous/session-scoped but native bootstrap can restore before chat startup. `writeToken()` may update the volatile `sessionStorage` mirror immediately; `persistToken()` is the awaited secure write path.

- [ ] **Step 5: Route chat account state through the adapter**

In `public/chat.js`, replace the duplicated direct `sessionStorage` implementation with calls to `window.dizychatAuthV2`. On successful login/session application, persist the returned token through the adapter; on explicit logout or server-declared invalid session, clear the secure token. A Socket.IO disconnect or request timeout must not call the persistent clear path.

If a secure write fails, keep only the volatile in-process login and surface a warning/toast; do not fall back to `localStorage`.

- [ ] **Step 6: Run focused and full tests**

```bash
node --test tests/android-secure-session.test.js tests/android-native-contract.test.js
npm test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java android/app/src/main/java/com/chat/dizychat/MainActivity.java public/auth-v2-client.js public/chat.js tests/android-secure-session.test.js tests/android-native-contract.test.js
git commit -m "feat: persist Android sessions in Keystore"
```

---

### Task 3: Android back navigation and external browser handoff

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/MobileShellPlugin.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/MainActivity.java`
- Modify: `public/mobile-runtime.js`
- Modify: `public/chat.js`
- Test: `tests/android-mobile-runtime.test.js`
- Test: `tests/android-native-contract.test.js`

**Interfaces:**
- Native plugin name: `MobileShell`.
- Native method: `openExternal({ url })` accepting only `http:`/`https:` URLs.
- Web hook: `window.dizychatMobile.handleBack() -> boolean` where `true` means the web UI consumed the back press.

- [ ] **Step 1: Extend failing tests**

Add tests asserting external `https://example.org` is routed to native shell, DizyChat-owned `https://dizychat.com/...` stays in-app, non-HTTP schemes are rejected, and back priority is transient UI -> leave chat -> Activity fallback.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test tests/android-mobile-runtime.test.js tests/android-native-contract.test.js
```

Expected: FAIL on missing native-shell/back wiring.

- [ ] **Step 3: Implement `MobileShellPlugin`**

Parse the supplied URL with `Uri.parse`, require scheme `http` or `https`, then launch `new Intent(Intent.ACTION_VIEW, uri)`. Reject all other schemes.

- [ ] **Step 4: Implement Android Back delegation**

In `MainActivity`, override Back handling so it evaluates:

```js
window.dizychatMobile && window.dizychatMobile.handleBack
  ? String(Boolean(window.dizychatMobile.handleBack()))
  : 'false'
```

If JavaScript returns true, stop. Otherwise invoke normal Activity back handling.

In `chat.js`, `handleBack()` must first close known transient state (reply preview, visible user context menu, expanded mobile user sidebar, open emoji UI where detectable), then if `isViewingChat` leave/show landing, otherwise return false so Android handles root exit/backgrounding.

- [ ] **Step 5: Add delegated external-link interception**

On native runs only, `mobile-runtime.js` listens for anchor clicks. DizyChat-owned URLs remain in-app. External `http(s)` URLs prevent default and call `Capacitor.Plugins.MobileShell.openExternal({ url })`.

- [ ] **Step 6: Run focused and full tests**

```bash
node --test tests/android-mobile-runtime.test.js tests/android-native-contract.test.js
npm test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/chat/dizychat/MobileShellPlugin.java android/app/src/main/java/com/chat/dizychat/MainActivity.java public/mobile-runtime.js public/chat.js tests/android-mobile-runtime.test.js tests/android-native-contract.test.js
git commit -m "feat: add Android shell navigation"
```

---

### Task 4: APK security, signing boundary and minimum Android permissions

**Files:**
- Modify: `android/app/build.gradle`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `tests/android-native-contract.test.js`

**Interfaces:**
- Optional release-signing environment variables: `DIZYCHAT_KEYSTORE_PATH`, `DIZYCHAT_KEY_ALIAS`, `DIZYCHAT_KEYSTORE_PASSWORD`, `DIZYCHAT_KEY_PASSWORD`.
- Debug builds require none of those values.

- [ ] **Step 1: Add failing packaging-security assertions**

Assert `android/app/build.gradle` does not contain `ADMIN_CREDENTIALS`, `METADEFENDER_API_KEY`, `MONGO_URI`, `GIPHY_SDK_KEY`, `RENDER_API_URL`, or other server-runtime `buildConfigField` entries, and the manifest sets `android:allowBackup="false"`.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/android-native-contract.test.js`

Expected: FAIL because the current Gradle file exposes legacy server settings as APK `BuildConfig` fields and the manifest allows backup.

- [ ] **Step 3: Remove server-secret APK fields**

Delete the legacy `local.properties` secret-loading block and every server credential/API field from `android/app/build.gradle`. The mobile client obtains public runtime behaviour from bundled config and authenticated backend responses only.

- [ ] **Step 4: Add environment-only release signing**

Create a conditional Gradle `signingConfigs.release` only when all four `DIZYCHAT_*` signing environment variables are non-empty. Configure `buildTypes.release.signingConfig` only in that case. Never print passwords or commit a keystore.

- [ ] **Step 5: Harden manifest without broad permissions**

Set `android:allowBackup="false"`. Keep `INTERNET`. Do not add broad storage permission. Browser/file-picker capture remains user-initiated through WebView/platform picker behaviour.

- [ ] **Step 6: Run tests**

```bash
node --test tests/android-native-contract.test.js
npm test
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add android/app/build.gradle android/app/src/main/AndroidManifest.xml tests/android-native-contract.test.js
git commit -m "security: harden private Android packaging"
```

---

### Task 5: Reproducible Android CI, signed-build runbook and PR gate

**Files:**
- Create: `.github/workflows/android-slice1-ci.yml`
- Create: `docs/android-private-apk.md`
- Modify: `README.md`
- Test: `tests/android-native-contract.test.js`

**Interfaces:**
- CI artifact name: `dizychat-android-debug-apk`.
- CI command sequence: `npm ci` -> `npm test` -> `npx cap sync android` -> `./gradlew assembleDebug`.

- [ ] **Step 1: Add failing CI/runbook contract assertions**

Extend `tests/android-native-contract.test.js` to require the workflow, Node 22 setup, Java 21 setup, deterministic test run, Capacitor sync, Gradle debug build and APK artifact upload. Require the runbook to state that release signing secrets and keystore stay outside Git.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/android-native-contract.test.js`

Expected: FAIL because the workflow/runbook do not yet exist.

- [ ] **Step 3: Create Android CI workflow**

Use `ubuntu-latest`, `actions/checkout`, `actions/setup-node` with Node 22 and npm cache, `actions/setup-java` with Temurin 21 and Gradle cache, then:

```bash
npm ci
npm test
npx cap sync android
cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon
```

Upload `android/app/build/outputs/apk/debug/app-debug.apk` as `dizychat-android-debug-apk`. The workflow must not require production signing secrets.

- [ ] **Step 4: Write the private APK runbook**

Document:

```bash
mkdir -p "$HOME/.dizychat"
keytool -genkeypair -v -keystore "$HOME/.dizychat/dizychat-release.jks" -alias dizychat -keyalg RSA -keysize 3072 -validity 10000
export DIZYCHAT_KEYSTORE_PATH="$HOME/.dizychat/dizychat-release.jks"
export DIZYCHAT_KEY_ALIAS="dizychat"
export DIZYCHAT_KEYSTORE_PASSWORD
export DIZYCHAT_KEY_PASSWORD
npx cap sync android
(cd android && ./gradlew assembleRelease --no-daemon)
```

The two password variables are supplied interactively/by the operator's secret store; the document must not contain actual passwords. Include `adb install -r android/app/build/outputs/apk/release/app-release.apk` and the 14-item real-device acceptance gate from the spec.

- [ ] **Step 5: Link the runbook from README**

Add a short Android/private-mobile section explaining that the app is sideload-only, connects to `https://dizychat.com`, and that Slice 2 will add push/inline notification actions later.

- [ ] **Step 6: Run the complete deterministic gate**

Run:

```bash
npm ci
npm test
npx cap sync android
(cd android && ./gradlew assembleDebug --no-daemon)
```

Expected: deterministic tests PASS and `android/app/build/outputs/apk/debug/app-debug.apk` exists.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/android-slice1-ci.yml docs/android-private-apk.md README.md tests/android-native-contract.test.js
git commit -m "ci: build private Android APK"
```

---

### Task 6: Exact-head PR verification and real-device handoff

**Files:**
- No implementation files unless a proven failing contract requires a narrowly scoped repair.

**Interfaces:**
- Branch remains `feat/android-slice1-core`.
- PR remains draft/unmerged until deterministic CI and Android build are green on the exact final head.

- [ ] **Step 1: Compare branch to `main`**

Run/inspect an exact compare and confirm only Slice 1 spec/plan/client/native/test/workflow/docs files changed. No Render, push, iOS, or unrelated DizyChat behaviour should be present.

- [ ] **Step 2: Open draft PR**

Create a draft PR titled `Add private Android DizyChat Slice 1` with the spec, production backend, Keystore session, ClamAV upload preservation, no-store distribution and real-device acceptance gate called out explicitly.

- [ ] **Step 3: Wait for exact-head CI**

Require the deterministic/self-host checks and `android-slice1-ci` workflow to complete successfully on the exact PR head. If any check fails, inspect the exact failure and patch only the proven contract; repeat the full gate on the new exact head.

- [ ] **Step 4: Download/install test APK**

Use the CI debug artifact for first-device validation or build the environment-signed release APK from the runbook. Do not call Slice 1 complete merely because CI built an APK.

- [ ] **Step 5: Execute real-device acceptance gate**

Verify install, production login/chat, close/reopen persistence, reboot persistence, offline/reconnect retention, normal file upload, gallery upload, camera/file picker, clean ClamAV path, malware rejection, back priority, external-link handoff, and explicit logout persistence removal.

- [ ] **Step 6: Final exact-head gate**

After any device-found repairs, rerun deterministic tests and Android build, require exact-head CI green, and leave the PR ready for user inspection. Do not merge without explicit user approval.
