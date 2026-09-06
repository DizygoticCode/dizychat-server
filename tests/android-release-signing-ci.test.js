'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Android CI fail-closes and uploads only a verified signed release APK', () => {
  const workflow = read('.github/workflows/android-slice1-ci.yml');

  for (const secret of [
    'DIZYCHAT_RELEASE_KEYSTORE_B64',
    'DIZYCHAT_KEY_ALIAS',
    'DIZYCHAT_KEYSTORE_PASSWORD',
    'DIZYCHAT_KEY_PASSWORD',
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }

  assert.match(workflow, /base64 --decode > android\/app\/dizychat-release\.jks/);
  assert.match(workflow, /DIZYCHAT_KEYSTORE_PATH:\s*\$\{\{ github\.workspace \}\}\/android\/app\/dizychat-release\.jks/);
  assert.match(workflow, /assembleRelease/);
  assert.match(workflow, /apksigner verify --verbose --print-certs/);
  assert.match(workflow, /name:\s*dizychat-android-release-apk/);
  assert.match(workflow, /path:\s*android\/app\/build\/outputs\/apk\/release\/app-release\.apk/);
});
