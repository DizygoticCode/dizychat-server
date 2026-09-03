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

const task2Applied =
  source.includes("const { createAccountService } = require('./src/auth/account-service');") &&
  source.includes('await accountService.bootstrapProtectedAccounts();');

if (!task2Applied) {
  replaceOnce(
    'Auth v2 imports',
    "const Message = require('./src/models/message');\nconst soundboardStore = require('./src/utils/soundboard');",
    "const Message = require('./src/models/message');\nconst User = require('./src/models/user');\nconst { createAccountService } = require('./src/auth/account-service');\nconst { readLegacyAdminCredentials } = require('./src/auth/legacy-admin-credentials');\nconst soundboardStore = require('./src/utils/soundboard');"
  );

  replaceOnce(
    'legacy migration account service',
    'const adminCredentials = buildAdminCredentials();',
    "const adminCredentials = readLegacyAdminCredentials(process.env);\nconst accountService = createAccountService({ UserModel: User, legacyCredentials: adminCredentials });"
  );

  replaceOnce(
    'Mongo protected-account bootstrap',
    '    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });\n    console.log("[Mongo] Connected");',
    '    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });\n    await accountService.bootstrapProtectedAccounts();\n    console.log("[Mongo] Connected");\n    console.log("[Auth v2] Protected accounts bootstrapped");'
  );

  replaceOnce(
    'Mongo bootstrap retry safety',
    '  } catch (err) {\n    console.error("[Mongo] Initial connect failed, retrying:", err?.message || err);\n    scheduleMongoReconnect();\n  } finally {',
    '  } catch (err) {\n    if (mongoose.connection.readyState === 1) {\n      try {\n        await mongoose.disconnect();\n      } catch (disconnectError) {\n        console.error("[Mongo] Disconnect after bootstrap failure failed:", disconnectError?.message || disconnectError);\n      }\n    }\n    console.error("[Mongo] Initial connect/Auth v2 bootstrap failed, retrying:", err?.message || err);\n    scheduleMongoReconnect();\n  } finally {'
  );
}

const task3Applied =
  source.includes("const { createSessionStore } = require('./src/auth/session-store');") &&
  source.includes('const accountSessions = createSessionStore({ ttlMs: ADMIN_SESSION_TTL_MS });') &&
  source.includes("socket.on('account login', async (payload = {}, ack) => {") &&
  source.includes("socket.on('account logout', (payload = {}, ack) => {");

if (!task3Applied) {
  replaceOnce(
    'Auth v2 session-store import',
    "const { readLegacyAdminCredentials } = require('./src/auth/legacy-admin-credentials');\nconst soundboardStore = require('./src/utils/soundboard');",
    "const { readLegacyAdminCredentials } = require('./src/auth/legacy-admin-credentials');\nconst { createSessionStore } = require('./src/auth/session-store');\nconst soundboardStore = require('./src/utils/soundboard');"
  );

  replaceOnce(
    'Auth v2 account session store',
    'const accountService = createAccountService({ UserModel: User, legacyCredentials: adminCredentials });',
    'const accountService = createAccountService({ UserModel: User, legacyCredentials: adminCredentials });\nconst accountSessions = createSessionStore({ ttlMs: ADMIN_SESSION_TTL_MS });'
  );

  replaceOnce(
    'optional Auth v2 Socket.IO session handshake',
    "io.on('connection', socket => {",
    "io.use((socket, next) => {\n  const sessionToken = typeof socket.handshake.auth?.sessionToken === 'string'\n    ? socket.handshake.auth.sessionToken.trim()\n    : '';\n  const session = accountSessions.resolve(sessionToken);\n  socket.principal = null;\n  socket.accountSessionToken = '';\n  if (session) {\n    socket.principal = session.principal;\n    socket.accountSessionToken = session.token;\n  }\n  next();\n});\n\nio.on('connection', socket => {"
  );

  replaceOnce(
    'Auth v2 Socket.IO account session events',
    "  socket.isAdmin = false;\n  socket.emit('room list', getPublicRoomsSnapshot());\n\n  socket.on('join room', async ({ room, username, password, adminToken }) => {",
    "  socket.isAdmin = false;\n  socket.emit('room list', getPublicRoomsSnapshot());\n\n  socket.on('account login', async (payload = {}, ack) => {\n    try {\n      const username = typeof payload.username === 'string' ? payload.username.trim() : '';\n      const password = typeof payload.password === 'string' ? payload.password : '';\n      const attemptKey = getAdminAuthAttemptKey(socket, username);\n      const authState = getAdminAuthState(attemptKey);\n      const now = Date.now();\n\n      if (authState.lockUntil > now) {\n        if (typeof ack === 'function') {\n          ack({ ok: false, error: 'Too many authentication attempts.', retryAfterMs: authState.lockUntil - now });\n        }\n        return;\n      }\n\n      const retryDelayMs = computeAdminAuthRetryDelayMs(authState);\n      if (authState.lastFailedAt && authState.lastFailedAt + retryDelayMs > now) {\n        if (typeof ack === 'function') {\n          ack({ ok: false, error: 'Authentication retry delayed.', retryAfterMs: (authState.lastFailedAt + retryDelayMs) - now });\n        }\n        return;\n      }\n\n      const account = await accountService.authenticate(username, password);\n      if (!account) {\n        const failedState = registerAdminAuthFailure(attemptKey);\n        const failedAt = Date.now();\n        const retryAfterMs = failedState.lockUntil > failedAt\n          ? failedState.lockUntil - failedAt\n          : computeAdminAuthRetryDelayMs(failedState);\n        if (typeof ack === 'function') {\n          ack({ ok: false, error: 'Invalid username or password.', retryAfterMs });\n        }\n        return;\n      }\n\n      clearAdminAuthFailures(attemptKey);\n      if (socket.accountSessionToken) {\n        accountSessions.revoke(socket.accountSessionToken);\n      }\n\n      const principal = {\n        kind: 'account',\n        username: account.username,\n        canonicalUsername: account.canonicalUsername,\n        role: account.role,\n        userId: account.userId,\n      };\n      const session = accountSessions.issue(principal);\n      socket.principal = session.principal;\n      socket.accountSessionToken = session.token;\n\n      if (typeof ack === 'function') {\n        ack({\n          ok: true,\n          session: {\n            token: session.token,\n            issuedAt: session.issuedAt,\n            expiresAt: session.expiresAt,\n            identity: { ...session.principal },\n          },\n        });\n      }\n    } catch (err) {\n      console.error('[Auth v2] Account login failed:', err?.message || err);\n      if (typeof ack === 'function') ack({ ok: false, error: 'Authentication failed.' });\n    }\n  });\n\n  socket.on('account session', (payload = {}, ack) => {\n    const session = accountSessions.resolve(socket.accountSessionToken);\n    if (!session) {\n      socket.accountSessionToken = '';\n      socket.principal = null;\n      if (typeof ack === 'function') ack({ ok: true, session: null });\n      return;\n    }\n\n    socket.principal = session.principal;\n    if (typeof ack === 'function') {\n      ack({\n        ok: true,\n        session: {\n          token: session.token,\n          issuedAt: session.issuedAt,\n          expiresAt: session.expiresAt,\n          identity: { ...session.principal },\n        },\n      });\n    }\n  });\n\n  socket.on('account logout', (payload = {}, ack) => {\n    if (socket.accountSessionToken) {\n      accountSessions.revoke(socket.accountSessionToken);\n    }\n    socket.accountSessionToken = '';\n    socket.principal = null;\n    if (typeof ack === 'function') ack({ ok: true });\n  });\n\n  socket.on('join room', async ({ room, username, password, adminToken }) => {"
  );
}

const task4Applied =
  source.includes("socket.on('join room', async ({ room, username, password }) => {") &&
  source.includes('await accountService.isRegisteredUsername(guestUsername)') &&
  source.includes('socket.identityKind = effectivePrincipal.kind;') &&
  source.includes('socket.role = effectivePrincipal.role;');

if (!task4Applied) {
  replaceOnce(
    'remove adminToken from room join identity input',
    "socket.on('join room', async ({ room, username, password, adminToken }) => {",
    "socket.on('join room', async ({ room, username, password }) => {"
  );

  replaceOnce(
    'server-authoritative room identity',
    "    const previousRoom = socket.currentRoom;\n    if (previousRoom && previousRoom !== roomName) {\n      removeSocketFromRoom(socket, previousRoom);\n      emitRoomListUpdate();\n    }\n\n    const adminSession = resolveAdminSession(adminToken);\n\n    // Track user identity & room\n    const fallbackUser = `Guest-${socket.id.slice(0, 4)}`;\n    const requestedUsername = adminSession?.username ?? username;\n    socket.username = normaliseUsername(requestedUsername, fallbackUser);\n    socket.isAdmin = Boolean(adminSession);\n    const canonicalUser = canonicalUsername(socket.username);",
    "    const fallbackUser = `Guest-${socket.id.slice(0, 4)}`;\n    let effectivePrincipal;\n    if (socket.principal?.kind === 'account') {\n      effectivePrincipal = socket.principal;\n    } else {\n      const guestUsername = normaliseUsername(username, fallbackUser);\n      if (await accountService.isRegisteredUsername(guestUsername)) {\n        logSecurityEvent('registered_username_guest_join_attempt', {\n          room: roomName,\n          username: guestUsername,\n          ip: getSocketRemoteAddress(socket),\n          socketId: socket.id,\n        });\n        sendJoinError(socket, 'That username is reserved. Sign in to use it.');\n        return;\n      }\n      effectivePrincipal = {\n        kind: 'guest',\n        username: guestUsername,\n        canonicalUsername: canonicalUsername(guestUsername),\n        role: 'guest',\n      };\n    }\n\n    socket.username = effectivePrincipal.username;\n    socket.canonicalUsername = effectivePrincipal.canonicalUsername;\n    socket.identityKind = effectivePrincipal.kind;\n    socket.role = effectivePrincipal.role;\n    socket.isAdmin = false;\n\n    const previousRoom = socket.currentRoom;\n    if (previousRoom && previousRoom !== roomName) {\n      removeSocketFromRoom(socket, previousRoom);\n      emitRoomListUpdate();\n    }\n\n    const canonicalUser = socket.canonicalUsername;"
  );
}

fs.writeFileSync(target, source);
console.log('Applied guarded Auth v2 index.js patch through Task 4.');
