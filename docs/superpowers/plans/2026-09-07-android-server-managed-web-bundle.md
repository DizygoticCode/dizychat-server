# Android Server-Managed Web Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the large packaged DizyChat web frontend in the Android APK with a tiny native bootstrap shell that downloads, verifies, caches, rolls back, and activates the current DizyChat web bundle from the configured production backend.

**Architecture:** Keep Capacitor on its trusted local `https://localhost` origin and keep native plugins, push, secure-session persistence, Android permissions, signing, and back-button handling inside the APK. A new native `WebBundle` plugin downloads a server-generated manifest plus only changed core web files into app-private storage, verifies SHA-256 hashes and path/size constraints, switches Capacitor's local server base path to the verified bundle, and persists that path. New bundles are pending until the downloaded `mobile-bootstrap.js` calls `markHealthy`; an uncommitted pending bundle rolls back to the prior verified version on next launch. Custom emoji images, uploads and soundboards remain server-hosted media and are never cached as app code.

**Tech Stack:** Node.js 22 / Express 4, Capacitor 7.4.4 Android, Java 21, Android app-private files, SHA-256, existing GitHub Actions signed-APK gate.

**Spec:** This plan is the implementation spec for `feat/android-server-managed-web-bundle`.

## Global Constraints

- Start from exact production baseline `3cad84ad071a61aa77174d2e0b23ab118ce6d64f`.
- Normal browser behaviour remains unchanged.
- Do not use Capacitor `server.url` for production deployment.
- Reuse `public/app-config.js` as the canonical configured native backend; do not introduce another production URL literal.
- Keep Capacitor/native bridge, push, secure sessions, native permissions, back handling and signing in the APK.
- APK contains only a tiny bootstrap webDir plus build-copied canonical config/logo assets.
- Remote bundle must remain on Capacitor's local origin after activation.
- Manifest and files are accepted only over HTTPS from the configured backend.
- Every downloaded core file is SHA-256 verified before activation.
- Reject traversal, absolute paths, malformed hashes, duplicate paths, unreasonable file counts/sizes and manifests without required entry files.
- Reuse unchanged files from the current verified bundle instead of downloading them again.
- A newly activated bundle is pending until `markHealthy`; next-launch rollback restores the previous verified bundle when pending health was never committed.
- Keep at least current and previous verified bundles; clean older completed bundles after health commit.
- `/uploads/`, `/soundboards/`, and `/emojis/` DOM media resolve to configured backend only in native mode; browser relative URLs remain current-origin.
- Do not publish or replace the public GitHub APK until exact-head deterministic tests, JVM tests, debug build, signed release build and signature verification are green.

---

### Task 1: Server web-bundle manifest boundary

**Files:**
- Create: `src/mobile-web/bundle-manifest.js`
- Create: `src/mobile-web/public-bundle-router.js`
- Modify: `index.js`
- Test: `tests/mobile-web-bundle-server.test.js`

**Interfaces:**
- Produces `buildMobileWebManifest({ publicDir }) -> { schemaVersion, entryPath, bundleVersion, files[] }`.
- Produces `createMobileWebBundleRouter({ publicDir })` mounted at `/api/mobile-web`.
- `GET /api/mobile-web/manifest` returns a no-store manifest.
- `GET /api/mobile-web/assets/*` serves only files present in that manifest.

- [ ] Write deterministic tests proving required core files are included, custom emoji/upload/soundboard content is excluded, hashes/sizes/version are deterministic, and asset paths cannot escape `public`.
- [ ] Run `npm test`; verify the new tests fail because the module/router do not exist.
- [ ] Implement the smallest manifest builder/router and mount it in `index.js`.
- [ ] Run `npm test`; verify green.
- [ ] Commit the server boundary.

### Task 2: Tiny packaged Android bootstrap

**Files:**
- Create: `android-shell/index.html`
- Create: `android-shell/bootstrap.js`
- Modify: `capacitor.config.json`
- Modify: `scripts/prepare-android-assets.js`
- Modify: `public/mobile-bootstrap.js`
- Modify: `public/mobile-runtime.js`
- Test: `tests/android-server-managed-shell.test.js`
- Test: `tests/native-relative-media-urls.test.js`

**Interfaces:**
- Capacitor `webDir` becomes `android-shell`.
- `android:prepare` copies canonical `public/app-config.js` and `public/logo.svg` into the shell; it does not package the full `public` tree or Socket.IO vendor bundle.
- `android-shell/bootstrap.js` invokes `Capacitor.Plugins.WebBundle.syncAndActivate({ backendUrl })` using `window.dizychatConfig.defaultNativeBackendUrl`.
- Downloaded `mobile-bootstrap.js` performs the same update check on every native launch before starting chat.
- Native Socket.IO script loads from the configured backend; browser remains same-origin.
- Native `/uploads/`, `/soundboards/`, and `/emojis/` media resolve to configured backend.

- [ ] Write regression tests for thin `webDir`, canonical-config copying, native updater invocation, remote native Socket.IO source, native emoji media resolution and unchanged browser behaviour.
- [ ] Run `npm test`; verify RED on the new contracts.
- [ ] Implement shell/prep/runtime changes.
- [ ] Run `npm test`; verify green.
- [ ] Commit the thin-shell boundary.

### Task 3: Native verified bundle store and rollback

**Files:**
- Create: `android/app/src/main/java/com/chat/dizychat/WebBundleManifest.java`
- Create: `android/app/src/main/java/com/chat/dizychat/WebBundleStore.java`
- Create: `android/app/src/main/java/com/chat/dizychat/WebBundlePlugin.java`
- Modify: `android/app/src/main/java/com/chat/dizychat/MainActivity.java`
- Create: `android/app/src/test/java/com/chat/dizychat/WebBundleManifestTest.java`
- Create: `android/app/src/test/java/com/chat/dizychat/WebBundleStoreTest.java`

**Interfaces:**
- `WebBundlePlugin.syncAndActivate({backendUrl})` downloads manifest/files off the UI thread and activates a verified complete bundle.
- `WebBundlePlugin.markHealthy()` commits the pending bundle.
- `WebBundleStore.prepareLaunch(Context)` runs before bridge startup and rolls back an uncommitted pending bundle.
- State lives in app-private SharedPreferences/files only.

- [ ] Add pure-Java tests for manifest validation, safe relative paths, SHA-256 verification, unchanged-file reuse decisions, pending/previous state transitions and rollback selection.
- [ ] Run Android JVM tests; verify RED.
- [ ] Implement parser/store/plugin and register `WebBundlePlugin` in `MainActivity`.
- [ ] Run Android JVM tests and deterministic tests; verify green.
- [ ] Commit native updater.

### Task 4: Health commit and full gate

**Files:**
- Modify: `public/mobile-bootstrap.js`
- Test: `tests/android-server-managed-shell.test.js`

**Interfaces:**
- After `chat.js` and native push readiness complete successfully, native bootstrap calls `WebBundle.markHealthy()`.
- Failed update checks with an existing verified bundle do not block chat startup.
- First-install shell remains retryable when no verified bundle exists and network/bootstrap fails.

- [ ] Add RED tests for health commit ordering and non-blocking update failure with a current bundle.
- [ ] Implement minimal health commit/error behaviour.
- [ ] Run `npm test` and Android JVM tests.
- [ ] Open draft PR and run exact-head Self-Host + Android gates.
- [ ] Inspect exact diff, review threads, branch drift, APK artifact size and signing certificate.
- [ ] Merge only when exact head is clean/green.

### Task 5: Public APK replacement

**Files:**
- No source changes unless release metadata/versioning is explicitly required by the proven install/update path.

- [ ] Download the exact signed release APK artifact from the green merged/main workflow.
- [ ] Verify package ID, version code/name, signing certificate continuity and SHA-256.
- [ ] Test install/upgrade path and first-sync behaviour before changing the public release.
- [ ] Replace/update the GitHub release asset only after the user-approved production APK is verified.
