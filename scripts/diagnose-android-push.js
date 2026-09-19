'use strict';

// Run from the live server's working directory/environment, using a separate worktree.
// No HTTP listener, token rotation, DB writes, or deployed-file changes. --send sends ONE probe.
const { randomBytes } = require('node:crypto');
const { tokenFingerprint, trace } = require('../src/push/fcm-diagnostics');
const { buildNotificationKey } = require('../src/push/notification-policy');

const selectProbeDevice = (devices, fingerprint) => {
  if (!/^[a-f0-9]{12}$/.test(fingerprint || '')) throw Error('FINGERPRINT_INVALID');
  const matching = devices.filter((device) => tokenFingerprint(device.fcmToken) === fingerprint);
  if (matching.length !== 1) throw Error('TARGET_NOT_UNIQUE');
  return matching[0];
};

const safeCredentialIdentity = (json = {}) => ({
  credentialType: String(json.type || 'unknown'),
  credentialProjectId: String(json.project_id || ''),
  principalFingerprint: tokenFingerprint(json.client_email),
});

const buildProbeMessage = (device, messageId, now = new Date()) => ({
  token: device.fcmToken,
  android: { priority: 'high', ttl: 60000, restrictedPackageName: 'com.chat.dizychat' },
  data: {
    type: 'message',
    room: 'FCM diagnostic',
    messageId,
    sender: 'DizyChat FCM test',
    preview: 'Remote data-only delivery confirmed. Dismiss this diagnostic notification.',
    notificationKey: buildNotificationKey(device.canonicalUsername, 'FCM diagnostic'),
    timestamp: now.toISOString(),
  },
});

async function main() {
  const { parseArgs } = require('node:util');
  const { values } = parseArgs({ options: {
    account: { type: 'string' }, fingerprint: { type: 'string' }, send: { type: 'boolean', default: false },
  } });
  if (!values.account) throw Error('ACCOUNT_REQUIRED');
  if (values.send && !/^[a-f0-9]{12}$/.test(values.fingerprint || '')) throw Error('FINGERPRINT_INVALID');
  require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env', quiet: true });
  const mongoose = require('mongoose');
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  const { createPushDeviceService } = require('../src/push/push-device-service');
  const { readFcmConfig, createDefaultMessagingFactory } = require('../src/push/fcm-config');
  const config = readFcmConfig();
  if (!config.enabled) throw Error('FCM_DISABLED');
  if (!process.env.MONGO_URI) throw Error('MONGO_URI_MISSING');
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    const service = createPushDeviceService({
      PushDeviceModel: require('../src/models/push-device'),
      SubscriptionModel: require('../src/models/push-room-subscription'),
      MobileSessionModel: require('../src/models/mobile-session'),
      UserModel: require('../src/models/user'),
    });
    const devices = await service.listAccountDevices(values.account);
    for (const device of devices) {
      trace(console, 'registered-db', {
        tokenFingerprint: tokenFingerprint(device.fcmToken),
        tokenRegisteredAt: device.tokenRegisteredAt,
        suppressionLeaseExpiresAt: device.suppressionLeaseExpiresAt,
      });
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const json = JSON.parse(require('node:fs').readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
      trace(console, 'credential-identity', safeCredentialIdentity(json));
    } else {
      trace(console, 'credential-identity', { credentialType: 'application-default-discovery' });
    }
    const messaging = await createDefaultMessagingFactory()({ projectId: config.projectId });
    const app = require('firebase-admin/app').getApp();
    const credential = app.options.credential;
    // Match Admin SDK project precedence; credential project and target project need not be equal
    // when a service account is authorized to send for another project.
    const projectId = app.options.projectId || credential.projectId
      || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
      || await credential.getProjectId?.();
    trace(console, 'admin-identity', { configuredProjectId: config.projectId, targetProjectId: projectId });
    // Optional public project-number lookup. A denied lookup is inconclusive, not a send failure.
    try {
      const access = await credential.getAccessToken();
      const response = await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`, {
        headers: { Authorization: `Bearer ${access.access_token}` }, signal: AbortSignal.timeout(10000),
      });
      const project = response.ok ? await response.json() : {};
      trace(console, 'project-number', { status: response.status, projectId: project.projectId || '', senderId: project.projectNumber || '' });
    } catch {
      trace(console, 'project-number', { status: 'unavailable' });
    }
    if (!values.send) return;
    const device = selectProbeDevice(devices, values.fingerprint);
    const message = buildProbeMessage(device, randomBytes(12).toString('hex'));
    const identity = { tokenFingerprint: tokenFingerprint(message.token), messageId: message.data.messageId, projectId };
    trace(console, 'probe-send-attempt', identity);
    const firebaseMessageId = await messaging.send(message);
    trace(console, 'probe-send-accepted', { ...identity, firebaseMessageId });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().catch((error) => {
  // Do not print arbitrary exception messages: Mongo/Google errors may contain credentials or tokens.
  const known = new Set(['ACCOUNT_REQUIRED', 'FINGERPRINT_INVALID', 'TARGET_NOT_UNIQUE', 'FCM_DISABLED', 'MONGO_URI_MISSING']);
  const code = /^messaging\/[a-z-]+$/.test(error?.code || '') ? error.code
    : known.has(error?.message) ? error.message : 'DIAGNOSTIC_FAILED';
  trace(console, 'probe-failed', { code, errorClass: error?.constructor?.name || 'Error' });
  process.exitCode = 1;
});

module.exports = { selectProbeDevice, buildProbeMessage, safeCredentialIdentity };
