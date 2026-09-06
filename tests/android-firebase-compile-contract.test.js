'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('app compiles native FCM classes against the shared Firebase Messaging version', () => {
  const variables = read('android/variables.gradle');
  const appGradle = read('android/app/build.gradle');
  const capacitorPluginGradle = read('android/app/capacitor.build.gradle');

  assert.match(variables, /firebaseMessagingVersion\s*=\s*['"]24\.1\.0['"]/);
  assert.match(appGradle, /implementation\s+['"]com\.google\.firebase:firebase-messaging:\$firebaseMessagingVersion['"]/);
  assert.match(capacitorPluginGradle, /implementation project\(':capacitor-push-notifications'\)/);
});
