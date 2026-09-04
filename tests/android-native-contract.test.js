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

test('MainActivity registers the SecureSession plugin', () => {
  const source = read('android/app/src/main/java/com/chat/dizychat/MainActivity.java');
  assert.match(source, /registerPlugin\(SecureSessionPlugin\.class\)/);
});
