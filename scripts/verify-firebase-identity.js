'use strict';
const fs = require('node:fs');

// Public identity extracted from signed APK at 8d2ea19305584d85f02dae8f64538b3bb820e8e0.
// This pins build identity; runtime server/project-number comparison remains necessary.
const EXPECTED = Object.freeze({
  projectId: 'dizychat',
  senderId: '682852424815',
  firebaseAppId: '1:682852424815:android:3cc9ecb23d8ea455d5c19a',
  packageId: 'com.chat.dizychat',
});

const validateConfig = (config) => {
  const clients = (config?.client || []).filter((client) =>
    client?.client_info?.android_client_info?.package_name === EXPECTED.packageId);
  const identity = {
    projectId: config?.project_info?.project_id,
    senderId: String(config?.project_info?.project_number || ''),
    firebaseAppId: clients[0]?.client_info?.mobilesdk_app_id,
    packageId: clients[0]?.client_info?.android_client_info?.package_name,
  };
  if (clients.length !== 1 || Object.keys(EXPECTED).some((key) => identity[key] !== EXPECTED[key])) {
    throw Error('FIREBASE_IDENTITY_MISMATCH');
  }
  return identity;
};

const validateResources = (xml, identity) => {
  for (const [resource, key] of Object.entries({
    google_app_id: 'firebaseAppId', gcm_defaultSenderId: 'senderId', project_id: 'projectId',
  })) {
    const match = xml.match(new RegExp(`<string\\b[^>]*\\bname="${resource}"[^>]*>([^<]*)<\\/string>`));
    if (!match) throw Error(`COMPILED_FIREBASE_RESOURCE_MISSING:${resource}`);
    if (match[1].trim() !== String(identity[key] || '').trim()) {
      throw Error(`COMPILED_FIREBASE_IDENTITY_MISMATCH:${resource}`);
    }
  }
  return identity;
};

if (require.main === module) {
  try {
    const identity = validateConfig(JSON.parse(fs.readFileSync('android/app/google-services.json', 'utf8')));
    const resourcesPath = process.argv[2];
    if (resourcesPath) validateResources(fs.readFileSync(resourcesPath, 'utf8'), identity);
    const safeJson = JSON.stringify(identity, null, 2) + '\n';
    if (process.argv[3]) fs.writeFileSync(process.argv[3], safeJson);
    process.stdout.write(safeJson);
  } catch (error) {
    const code = String(error?.message || 'FIREBASE_IDENTITY_VALIDATION_FAILED')
      .replace(/[^A-Z0-9_:-]/gi, '');
    console.error(`Firebase identity validation failed: ${code}; no config contents logged.`);
    process.exitCode = 1;
  }
}
module.exports = { validateConfig, validateResources };
