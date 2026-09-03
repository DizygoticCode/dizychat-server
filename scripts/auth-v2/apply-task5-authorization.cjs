'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '../../index.js');
let source = fs.readFileSync(target, 'utf8');

function replaceOnce(label, needle, replacement) {
  const first = source.indexOf(needle);
  if (first === -1) throw new Error(`${label}: expected seam not found`);
  if (source.indexOf(needle, first + needle.length) !== -1) {
    throw new Error(`${label}: seam is not unique`);
  }
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

function removeBetween(label, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`${label}: start marker not found`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`${label}: end marker not found`);
  source = `${source.slice(0, start)}${source.slice(end)}`;
}

function replaceAllChecked(label, needle, replacement, minimum = 1) {
  const count = source.split(needle).length - 1;
  if (count < minimum) throw new Error(`${label}: expected at least ${minimum} occurrence(s), found ${count}`);
  source = source.split(needle).join(replacement);
  return count;
}

const fullyApplied =
  source.includes("const { requireModerator, requireOwner } = require('./src/auth/authorization');") &&
  source.includes("socket.on('account manage user', async (payload = {}, ack) => {") &&
  !source.includes("socket.on('admin auth'") &&
  !source.includes('adminSessionsByToken') &&
  !source.includes('socket.isAdmin');

if (!fullyApplied) {
  if (!source.includes("const { requireModerator, requireOwner } = require('./src/auth/authorization');")) {
    replaceOnce(
      'Task 5 authorization import',
      "const { createSessionStore } = require('./src/auth/session-store');\nconst soundboardStore = require('./src/utils/soundboard');",
      "const { createSessionStore } = require('./src/auth/session-store');\nconst { requireModerator, requireOwner } = require('./src/auth/authorization');\nconst soundboardStore = require('./src/utils/soundboard');"
    );
  }

  if (source.includes('const adminSessionsByToken = new Map();')) {
    removeBetween(
      'Task 5 legacy admin session/password authority',
      'const adminSessionsByToken = new Map();',
      '// ---------------- MongoDB ----------------'
    );
  }

  if (source.includes("socket.on('admin auth'")) {
    removeBetween(
      'Task 5 post-join admin-password handler',
      '  // ----- Admin Auth (post-join) -----',
      '  // ----- Chat message -----'
    );
  }

  if (source.includes('function requireAdmin(socket){\n  if (!socket.isAdmin) {')) {
    replaceOnce(
      'Task 5 admin command guard',
      "function requireAdmin(socket){\n  if (!socket.isAdmin) {\n    socket.emit('toast', { type: 'warn', text: '🚫 Admin only command.' });\n    return false;\n  }\n  return true;\n}",
      "function requireAdmin(socket){\n  const principal = requireModerator(socket);\n  if (!principal) {\n    socket.emit('toast', { type: 'warn', text: '🚫 Admin only command.' });\n    return false;\n  }\n  return true;\n}"
    );
  }

  if (source.includes('isAdmin: socket.isAdmin,')) {
    replaceAllChecked(
      'Task 5 server-derived presence moderation role',
      'isAdmin: socket.isAdmin,',
      'isAdmin: Boolean(requireModerator(socket)),',
      2
    );
  }

  if (source.includes("  socket.isAdmin = false;\n  socket.emit('room list', getPublicRoomsSnapshot());")) {
    replaceOnce(
      'Task 5 remove mutable connection admin flag',
      "  socket.isAdmin = false;\n  socket.emit('room list', getPublicRoomsSnapshot());",
      "  socket.emit('room list', getPublicRoomsSnapshot());"
    );
  }

  if (!source.includes("socket.on('account manage user', async (payload = {}, ack) => {")) {
    replaceOnce(
      'Task 5 owner managed-user event',
      "  socket.on('account logout', (payload = {}, ack) => {\n    if (socket.accountSessionToken) {\n      accountSessions.revoke(socket.accountSessionToken);\n    }\n    socket.accountSessionToken = '';\n    socket.principal = null;\n    if (typeof ack === 'function') ack({ ok: true });\n  });\n\n  socket.on('join room', async ({ room, username, password }) => {",
      "  socket.on('account logout', (payload = {}, ack) => {\n    if (socket.accountSessionToken) {\n      accountSessions.revoke(socket.accountSessionToken);\n    }\n    socket.accountSessionToken = '';\n    socket.principal = null;\n    if (typeof ack === 'function') ack({ ok: true });\n  });\n\n  socket.on('account manage user', async (payload = {}, ack) => {\n    try {\n      const actor = requireOwner(socket);\n      if (!actor) {\n        if (typeof ack === 'function') ack({ ok: false, error: 'Owner role required.' });\n        return;\n      }\n\n      const username = typeof payload.username === 'string' ? payload.username.trim() : '';\n      const password = typeof payload.password === 'string' ? payload.password : '';\n      const role = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : 'user';\n      const account = await accountService.createManagedUser(actor, { username, password, role });\n      accountSessions.revokeUser(account.canonicalUsername);\n      if (typeof ack === 'function') ack({ ok: true, account });\n    } catch (err) {\n      console.error('[Auth v2] Managed user creation failed:', err?.message || err);\n      if (typeof ack === 'function') {\n        ack({ ok: false, error: err?.message || 'Unable to create account.' });\n      }\n    }\n  });\n\n  socket.on('join room', async ({ room, username, password }) => {"
    );
  }

  if (source.includes('    socket.role = effectivePrincipal.role;\n    socket.isAdmin = false;')) {
    replaceOnce(
      'Task 5 persist effective room principal',
      '    socket.role = effectivePrincipal.role;\n    socket.isAdmin = false;',
      '    socket.role = effectivePrincipal.role;\n    socket.principal = effectivePrincipal;'
    );
  }

  if (source.includes('!socket.isAdmin')) {
    replaceAllChecked(
      'Task 5 role-backed moderation checks',
      '!socket.isAdmin',
      '!requireModerator(socket)'
    );
  }

  if (source.includes('socket.isAdmin ? 86400 : 3600')) {
    replaceOnce(
      'Task 5 moderator mute ceiling',
      'socket.isAdmin ? 86400 : 3600',
      '86400'
    );
  }
}

const forbidden = [
  "socket.on('admin auth'",
  'adminSessionsByToken',
  'adminSessionsByUser',
  'issueAdminSession',
  'resolveAdminSession',
  'revokeAdminSessionForUser',
  'resolveAdminCredential',
  'adminToken',
  'socket.isAdmin',
];
for (const token of forbidden) {
  if (source.includes(token)) throw new Error(`Task 5 forbidden legacy authority remains: ${token}`);
}

if (!source.includes("const { requireModerator, requireOwner } = require('./src/auth/authorization');")) {
  throw new Error('Task 5 authorization import missing');
}
if (!source.includes("socket.on('account manage user', async (payload = {}, ack) => {")) {
  throw new Error('Task 5 owner managed-user event missing');
}
if (!source.includes('socket.principal = effectivePrincipal;')) {
  throw new Error('Task 5 room principal persistence missing');
}

fs.writeFileSync(target, source);
console.log('Applied guarded Auth v2 Task 5 role authority migration.');
