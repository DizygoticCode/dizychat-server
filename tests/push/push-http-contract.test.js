'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
const requirePattern = (pattern, message) => assert.match(source, pattern, message);

const handlerSlice = (eventName, nextEventName) => {
  const start = source.indexOf(`socket.on('${eventName}'`);
  assert.ok(start >= 0, `${eventName} handler missing`);
  const end = nextEventName ? source.indexOf(`socket.on('${nextEventName}'`, start + 1) : -1;
  return source.slice(start, end > start ? end : source.length);
};

test('server constructs persistent push and read-state authorities', () => {
  for (const dependency of ['push-device', 'push-room-subscription', 'room-read-cursor']) {
    requirePattern(new RegExp(`require\\(['\"]\\.\\/src\\/models\\/${dependency}['\"]\\)`), `${dependency} model must be imported`);
  }
  requirePattern(/createPushDeviceService\s*\(/, 'push device service must be constructed');
  requirePattern(/createReadStateService\s*\(/, 'read state service must be constructed');
  requirePattern(/createPushCoordinator\s*\(/, 'push coordinator must be constructed');
  requirePattern(/createReadStateCoordinator\s*\(/, 'read-state coordinator must be constructed');
});

test('push registration and presence require mobile bearer sessions with explicit 401 and 403 boundaries', () => {
  requirePattern(/const requireHttpAccount\s*=\s*async/, 'account HTTP auth helper must exist');
  requirePattern(/const requireHttpMobileAccount\s*=\s*async/, 'mobile HTTP auth helper must exist');
  requirePattern(/status\(401\)[\s\S]*AUTH_REQUIRED/, 'missing bearer must be rejected');
  requirePattern(/session\.kind\s*!==\s*['"]mobile['"][\s\S]*status\(403\)/, 'browser bearer must be rejected from mobile-only routes');
  requirePattern(/app\.post\(['"]\/api\/mobile\/push\/register['"][\s\S]*registerDevice/, 'mobile push register route must register a device');
  requirePattern(/app\.post\(['"]\/api\/mobile\/push\/presence['"][\s\S]*(renewSuppressionLease|clearSuppressionLease)/, 'mobile presence route must mutate only the device lease');
});

test('presence TTL is bounded server-side', () => {
  requirePattern(/PRESENCE_LEASE_MAX_MS\s*=\s*90_000/, 'presence maximum must be 90 seconds');
  requirePattern(/Math\.min\([\s\S]*Math\.max\([\s\S]*5_000[\s\S]*PRESENCE_LEASE_MAX_MS/, 'presence TTL must be clamped');
});

test('read-state endpoints authenticate accounts and route through the authoritative coordinator', () => {
  requirePattern(/app\.post\(['"]\/api\/read-state\/mark['"]/, 'read mark route must exist');
  requirePattern(/app\.get\(['"]\/api\/read-state['"]/, 'read cursor route must exist');
  requirePattern(/Message\.findById\(messageId\)/, 'read mark must load the persisted message');
  requirePattern(/messageTimestamp|timestamp:\s*(message|persistedMessage|msg)\.timestamp/, 'persisted message timestamp must feed read cursor');
  requirePattern(/MESSAGE_ROOM_MISMATCH/, 'room mismatch must be explicitly rejected');
  requirePattern(/app\.post\(['"]\/api\/read-state\/mark['"][\s\S]*readStateCoordinator\.advance/, 'read mark must advance through the coordinator');
  requirePattern(/app\.get\(['"]\/api\/read-state['"][\s\S]*readStateCoordinator\.getCursor/, 'read cursor GET must read through the coordinator');
});

test('authenticated socket reads advance account cursor independently of legacy global receipt state', () => {
  const messageRead = handlerSlice('message read', 'edit message');
  assert.match(messageRead, /socket\.principal\?\.kind\s*===\s*['"]account['"]/, 'only registered account principals may advance account read state');
  assert.match(messageRead, /readStateCoordinator\.advance/, 'socket read must advance authoritative account cursor');
  const coordinatorAdvance = messageRead.indexOf('readStateCoordinator.advance');
  const legacyStatusGuard = messageRead.indexOf("msg.status === 'read'");
  assert.ok(coordinatorAdvance >= 0, 'coordinator advance must exist');
  assert.ok(legacyStatusGuard < 0 || coordinatorAdvance < legacyStatusGuard,
    'legacy global Message.status must not short-circuit another account cursor advancement');
});

test('socket session metadata keeps mobileSessionId server-side and never adds it to auth ack', () => {
  requirePattern(/socket\.mobileSessionId\s*=\s*['"]['"]/, 'socket mobile session id must initialize empty');
  requirePattern(/socket\.mobileDeviceId\s*=\s*['"]['"]/, 'socket mobile device id must initialize empty');
  requirePattern(/socket\.mobileSessionId\s*=\s*session\.kind\s*===\s*['"]mobile['"]\s*\?\s*String\(session\.sessionId\s*\|\|\s*['"]['"]\)\s*:\s*['"]['"]/, 'resolved mobile session id must stay on the server socket');
  assert.doesNotMatch(source, /session:\s*\{[^}]*sessionId/s, 'auth ack must not expose sessionId');
});

test('room subscription is created only after successful join admission for a registered same-session device', () => {
  const join = handlerSlice('join room', 'request older messages');
  assert.match(join, /async \(payload\s*=\s*\{\}\)/, 'join must accept extensible payload');
  assert.match(join, /deviceId/, 'join must read native device id');
  const accepted = join.indexOf("socket.join(roomName)");
  const subscribed = join.indexOf('pushDeviceService.subscribeRoom');
  assert.ok(accepted >= 0 && subscribed > accepted, 'subscription must happen only after accepted socket join');
  assert.match(join, /findRegisteredDevice\([\s\S]*sessionId:\s*socket\.mobileSessionId[\s\S]*deviceId/, 'join must revalidate exact registered device');
});

test('explicit leave unsubscribes exact native device while disconnect does not unsubscribe', () => {
  const leave = handlerSlice('leave room', 'request rooms');
  assert.match(leave, /pushDeviceService\.unsubscribeRoom\([\s\S]*sessionId:\s*socket\.mobileSessionId[\s\S]*deviceId[\s\S]*room:\s*target/, 'Leave must unsubscribe exact session/device/room');
  const disconnect = handlerSlice('disconnect');
  assert.doesNotMatch(disconnect, /unsubscribeRoom/, 'disconnect/background must retain room subscription');
});

test('logout disables exact mobile session and account-wide credential replacement disables all mobile push state', () => {
  const logout = handlerSlice('account logout', 'account manage user');
  assert.match(logout, /disableSession\(/, 'mobile logout must disable exact session push state');
  const manage = handlerSlice('account manage user', 'join room');
  assert.match(manage, /mobileAccountSessions\.revokeUser\(/, 'account replacement must revoke mobile sessions');
  assert.match(manage, /pushDeviceService\.disableUser\(/, 'account replacement must disable all push devices/subscriptions');
});
