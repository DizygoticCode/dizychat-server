'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig, validateResources } = require('../../scripts/verify-firebase-identity');
const config = () => ({ project_info: { project_id: 'dizychat', project_number: '682852424815' }, client: [{ client_info: { mobilesdk_app_id: '1:682852424815:android:3cc9ecb23d8ea455d5c19a', android_client_info: { package_name: 'com.chat.dizychat' } }, api_key: [{ current_key: 'SECRET' }] }] });
test('Firebase identity includes project number and exact matching Android app, never API key', () => {
  const identity = validateConfig(config());
  assert.equal(identity.senderId, '682852424815');
  assert.equal(identity.firebaseAppId, config().client[0].client_info.mobilesdk_app_id);
  assert.equal(JSON.stringify(identity).includes('SECRET'), false);
});
test('same project/package cannot conceal mismatched sender or app identity', () => {
  const wrongSender = config(); wrongSender.project_info.project_number = '123';
  assert.throws(() => validateConfig(wrongSender), /FIREBASE_IDENTITY_MISMATCH/);
  const wrongApp = config(); wrongApp.client[0].client_info.mobilesdk_app_id = '1:682852424815:android:wrong';
  assert.throws(() => validateConfig(wrongApp), /FIREBASE_IDENTITY_MISMATCH/);
});
test('generated release resources must equal validated source identity', () => {
  const identity = validateConfig(config());
  const xml = `<resources><string name="google_app_id">${identity.firebaseAppId}</string><string name="gcm_defaultSenderId">${identity.senderId}</string><string name="project_id">dizychat</string></resources>`;
  assert.deepEqual(validateResources(xml, identity), identity);
  assert.throws(() => validateResources(xml.replace('682852424815</string>', '123</string>'), identity), /COMPILED_FIREBASE_IDENTITY_MISMATCH/);
  assert.throws(() => validateResources('<resources/>', identity), /COMPILED_FIREBASE_IDENTITY_MISMATCH/);
});
