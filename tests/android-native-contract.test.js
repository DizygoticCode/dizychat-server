'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('SecureSession plugin encrypts tokens with AndroidKeyStore AES-GCM', () => {
  const source = read('android/app/src/main/java/com/chat/dizychat/SecureSessionPlugin.java');
  assert.match(source, /@CapacitorPlugin\(name\s*=\s*"SecureSession"\)/);
  assert.match(source, /AndroidKeyStore/);
  assert.match(source, /KeyProperties\.KEY_ALGORITHM_AES/);
  assert.match(source, /KeyProperties\.BLOCK_MODE_GCM/);
  assert.match(source, /KeyProperties\.ENCRYPTION_PADDING_NONE/);
  assert.match(source, /AES\/GCM\/NoPadding/);
  assert.match(source, /SecureRandom/);
  assert.match(source, /new byte\[12\]/);
  assert.match(source, /MODE_PRIVATE/);
  assert.match(source, /Base64/);
  assert.match(source, /ciphertext/);
  assert.match(source, /iv/);
  assert.doesNotMatch(source, /putString\([^\n]*token/i, 'plain token must never be stored in SharedPreferences');
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