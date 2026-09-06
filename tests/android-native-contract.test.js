'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

test('SecureSession plugin delegates to AndroidKeyStore AES-GCM storage', () => {
  const plugin = read('android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java');
  const store = read('android/app/src/main/java/com/chat/dizychat/SecureSessionStore.java');
  assert.match(plugin, /@CapacitorPlugin\(name\s*=\s*"SecureSession"\)/);
  assert.match(plugin, /SecureSessionStore\.readToken\(getContext\(\)\)/);
  assert.match(plugin, /SecureSessionStore\.writeToken\(getContext\(\),/);
  assert.match(plugin, /SecureSessionStore\.clearToken\(getContext\(\)\)/);
  assert.match(store, /AndroidKeyStore/);
  assert.match(store, /KeyProperties\.KEY_ALGORITHM_AES/);
  assert.match(store, /KeyProperties\.BLOCK_MODE_GCM/);
  assert.match(store, /KeyProperties\.ENCRYPTION_PADDING_NONE/);
  assert.match(store, /AES\/GCM\/NoPadding/);
  assert.match(store, /cipher\.init\(Cipher\.ENCRYPT_MODE,\s*getOrCreateKey\(\)\);/);
  assert.match(store, /byte\[\]\s+iv\s*=\s*cipher\.getIV\(\);/);
  assert.doesNotMatch(store, /SecureRandom/, 'AndroidKeyStore must generate the AES-GCM encryption IV');
  assert.doesNotMatch(store, /new byte\[12\]/, 'caller-generated GCM IVs are rejected unless CALLER_NONCE is enabled');
  assert.match(store, /MODE_PRIVATE/);
  assert.match(store, /Base64/);
  assert.match(store, /ciphertext/);
  assert.match(store, /iv/);
  assert.doesNotMatch(store, /putString\([^\n]*token/i, 'plain token must never be stored in SharedPreferences');
});

test('MobileShell plugin accepts only HTTP(S) and hands links to ACTION_VIEW', () => {
  const source = read('android/app/src/main/java/com/chat/dizychat/MobileShellPlugin.java');
  assert.match(source, /@CapacitorPlugin\(name\s*=\s*"MobileShell"\)/);
  assert.match(source, /Uri\.parse\(/);
  assert.match(source, /"http"\.equalsIgnoreCase\(scheme\)/);
  assert.match(source, /"https"\.equalsIgnoreCase\(scheme\)/);
  assert.match(source, /Intent\.ACTION_VIEW/);
  assert.match(source, /call\.reject\([^\n]*http/i);
});

test('MainActivity registers native plugins and delegates Android Back to the web client first', () => {
  const source = read('android/app/src/main/java/com/chat/dizychat/MainActivity.java');
  assert.match(source, /registerPlugin\(SecureSessionPlugin\.class\)/);
  assert.match(source, /registerPlugin\(MobileShellPlugin\.class\)/);
  assert.match(source, /onBackPressed\(\)/);
  assert.match(source, /getBridge\(\)\.getWebView\(\)\.evaluateJavascript/);
  assert.match(source, /window\.dizychatMobile/);
  assert.match(source, /handleBack/);
  assert.match(source, /super\.onBackPressed\(\)/);
});

test('chat exposes the mobile back hook with transient-first and room-leave behaviour', () => {
  const source = read('public/chat.js');
  assert.match(source, /window\.dizychatMobile\s*=/);
  assert.match(source, /handleBack\(\)/);
  assert.match(source, /replyState\.targetId/);
  assert.match(source, /clearReplyTarget\(\)/);
  assert.match(source, /userContextMenu/);
  assert.match(source, /setMobileSidebarExpanded\(false\)/);
  assert.match(source, /emojiPickerController/);
  assert.match(source, /leaveBtn\?\.click\(\)/);
  assert.match(source, /return false/);
});

test('Android packaging contains no server secrets and release signing is environment-only', () => {
  const gradle = read('android/app/build.gradle');
  const forbidden = [
    'ADMIN_CREDENTIALS',
    'METADEFENDER_API_KEY',
    'MONGO_URI',
    'GIPHY_SDK_KEY',
    'RENDER_API_URL',
  ];

  for (const name of forbidden) {
    assert.doesNotMatch(gradle, new RegExp(`buildConfigField[^\\n]*${name}`), `${name} must not be compiled into the APK`);
  }
  assert.doesNotMatch(gradle, /localProperties\.getProperty/, 'Android packaging must not load server runtime secrets from local.properties');

  for (const name of [
    'DIZYCHAT_KEYSTORE_PATH',
    'DIZYCHAT_KEY_ALIAS',
    'DIZYCHAT_KEYSTORE_PASSWORD',
    'DIZYCHAT_KEY_PASSWORD',
  ]) {
    assert.match(gradle, new RegExp(`System\\.getenv\\(["']${name}["']\\)`), `${name} must come from the process environment`);
  }
  assert.match(gradle, /signingConfigs\s*\{/);
  assert.match(gradle, /hasReleaseSigning/);
  assert.match(gradle, /signingConfig\s+signingConfigs\.release/);
});

test('Android manifest disables backup and keeps storage permissions narrow', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.doesNotMatch(manifest, /READ_EXTERNAL_STORAGE/);
  assert.doesNotMatch(manifest, /WRITE_EXTERNAL_STORAGE/);
  assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE/);
});

test('Android Slice 1 CI reproducibly runs JVM tests, builds, and uploads an unsigned debug APK', () => {
  const workflowPath = '.github/workflows/android-slice1-ci.yml';
  assert.equal(exists(workflowPath), true, 'final Android Slice 1 CI workflow must exist');
  const workflow = read(workflowPath);

  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node-version:\s*["']?22["']?/);
  assert.match(workflow, /cache:\s*npm/);
  assert.match(workflow, /actions\/setup-java@v4/);
  assert.match(workflow, /distribution:\s*["']?temurin["']?/);
  assert.match(workflow, /java-version:\s*["']?21["']?/);
  assert.match(workflow, /cache:\s*gradle/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npx cap sync android/);
  assert.match(workflow, /\.\/gradlew testDebugUnitTest assembleDebug --no-daemon/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /name:\s*dizychat-android-debug-apk/);
  assert.match(workflow, /android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);

  const debugBuildStep = workflow.match(/- name: Run Android JVM tests and build unsigned debug APK[\s\S]*?(?=\n      - name:)/)?.[0] || '';
  assert.notEqual(debugBuildStep, '', 'debug build step must remain present');
  assert.doesNotMatch(debugBuildStep, /DIZYCHAT_KEYSTORE_PASSWORD|DIZYCHAT_KEY_PASSWORD/, 'debug build step must not receive release signing secrets');
});

test('private APK runbook keeps release signing material outside Git and defines the device gate', () => {
  const runbookPath = 'docs/android-private-apk.md';
  assert.equal(exists(runbookPath), true, 'private APK runbook must exist');
  const runbook = read(runbookPath);

  assert.match(runbook, /\$HOME\/\.dizychat\/dizychat-release\.jks/);
  assert.match(runbook, /keytool -genkeypair/);
  assert.match(runbook, /-keysize 3072/);
  assert.match(runbook, /DIZYCHAT_KEYSTORE_PATH/);
  assert.match(runbook, /DIZYCHAT_KEY_ALIAS/);
  assert.match(runbook, /DIZYCHAT_KEYSTORE_PASSWORD/);
  assert.match(runbook, /DIZYCHAT_KEY_PASSWORD/);
  assert.match(runbook, /assembleRelease --no-daemon/);
  assert.match(runbook, /adb install -r android\/app\/build\/outputs\/apk\/release\/app-release\.apk/);
  assert.match(runbook, /outside Git/i);
  assert.match(runbook, /real-device acceptance/i);
});

test('README identifies the private sideloaded Android app and defers notifications to Slice 2', () => {
  const readme = read('README.md');
  assert.match(readme, /docs\/android-private-apk\.md/);
  assert.match(readme, /sideload/i);
  assert.match(readme, /https:\/\/dizychat\.com/);
  assert.match(readme, /Slice 2/i);
  assert.match(readme, /push/i);
  assert.match(readme, /inline/i);
});
