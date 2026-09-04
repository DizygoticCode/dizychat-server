from pathlib import Path

path = Path('index.js')
source = path.read_text()


def replace_once(old, new, label):
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    source = source.replace(old, new, 1)


replace_once(
    "const User = require('./src/models/user');\nconst Room = require('./src/models/room');",
    "const User = require('./src/models/user');\nconst MobileSession = require('./src/models/mobile-session');\nconst Room = require('./src/models/room');",
    'MobileSession import',
)

replace_once(
    "const { createSessionStore } = require('./src/auth/session-store');",
    "const { createSessionStore } = require('./src/auth/session-store');\nconst { createMobileSessionService } = require('./src/auth/mobile-session-service');",
    'mobile session service import',
)

replace_once(
    "const parseSocketCorsOrigins = () => {",
    """const TRUSTED_NATIVE_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
]);

const isTrustedNativeOrigin = (socket) => {
  const origin = String(socket?.handshake?.headers?.origin || '').trim().toLowerCase();
  return TRUSTED_NATIVE_ORIGINS.has(origin);
};

const parseSocketCorsOrigins = () => {""",
    'trusted native origins',
)

replace_once(
    """const SOCKET_IO_CORS_ORIGIN = parseSocketCorsOrigins();
const ALLOWED_SOCKET_IO_ORIGINS = Array.isArray(SOCKET_IO_CORS_ORIGIN)
  ? new Set(SOCKET_IO_CORS_ORIGIN)
  : null;""",
    """const SOCKET_IO_CORS_ORIGIN_CONFIG = parseSocketCorsOrigins();
const SOCKET_IO_CORS_ORIGIN = Array.isArray(SOCKET_IO_CORS_ORIGIN_CONFIG)
  ? [...new Set([...SOCKET_IO_CORS_ORIGIN_CONFIG, ...TRUSTED_NATIVE_ORIGINS])]
  : SOCKET_IO_CORS_ORIGIN_CONFIG;
const ALLOWED_SOCKET_IO_ORIGINS = Array.isArray(SOCKET_IO_CORS_ORIGIN)
  ? new Set(SOCKET_IO_CORS_ORIGIN)
  : null;""",
    'native Socket.IO CORS allowance',
)

replace_once(
    """const accountService = createAccountService({ UserModel: User, legacyCredentials: adminCredentials });
const accountSessions = createSessionStore({ ttlMs: ADMIN_SESSION_TTL_MS });
const roomPasswordService = createRoomPasswordService({ RoomModel: Room });""",
    """const accountService = createAccountService({ UserModel: User, legacyCredentials: adminCredentials });
const accountSessions = createSessionStore({ ttlMs: ADMIN_SESSION_TTL_MS });
const mobileAccountSessions = createMobileSessionService({
  MobileSessionModel: MobileSession,
  UserModel: User,
});
const resolveAccountSessionToken = async (token) => {
  if (typeof token !== 'string' || !token) return null;
  const browserSession = accountSessions.resolve(token);
  if (browserSession) return browserSession;
  return mobileAccountSessions.resolve(token);
};
const revokeAccountSessionToken = async (token) => {
  if (typeof token !== 'string' || !token) return false;
  if (accountSessions.revoke(token)) return true;
  return mobileAccountSessions.revoke(token);
};
const roomPasswordService = createRoomPasswordService({ RoomModel: Room });""",
    'mobile session authority construction',
)

replace_once(
    """io.use((socket, next) => {
  const sessionToken = typeof socket.handshake.auth?.sessionToken === 'string'
    ? socket.handshake.auth.sessionToken.trim()
    : '';
  const session = accountSessions.resolve(sessionToken);
  socket.principal = null;
  socket.accountSessionToken = '';
  if (session) {
    socket.principal = session.principal;
    socket.accountSessionToken = session.token;
  }
  next();
});""",
    """io.use(async (socket, next) => {
  const sessionToken = typeof socket.handshake.auth?.sessionToken === 'string'
    ? socket.handshake.auth.sessionToken.trim()
    : '';
  socket.principal = null;
  socket.accountSessionToken = '';
  try {
    const session = await resolveAccountSessionToken(sessionToken);
    if (session) {
      socket.principal = session.principal;
      socket.accountSessionToken = session.token;
    }
    next();
  } catch (err) {
    console.error('[Auth v2] Session handshake unavailable:', err?.message || err);
    next();
  }
});""",
    'Socket.IO combined session handshake',
)

replace_once(
    """      clearAdminAuthFailures(attemptKey);
      if (socket.accountSessionToken) {
        accountSessions.revoke(socket.accountSessionToken);
      }

      const principal = {""",
    """      const wantsMobileSession = payload.sessionKind === 'mobile';
      if (wantsMobileSession && !isTrustedNativeOrigin(socket)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'MOBILE_SESSION_ORIGIN_NOT_ALLOWED' });
        return;
      }

      clearAdminAuthFailures(attemptKey);
      if (socket.accountSessionToken) {
        await revokeAccountSessionToken(socket.accountSessionToken);
      }

      const principal = {""",
    'login mobile-origin guard',
)

replace_once(
    """      const session = accountSessions.issue(principal);
      socket.principal = session.principal;""",
    """      const session = wantsMobileSession
        ? await mobileAccountSessions.issue(principal, { deviceLabel: payload.deviceLabel })
        : accountSessions.issue(principal);
      socket.principal = session.principal;""",
    'mobile session issuance',
)

replace_once(
    """  socket.on('account session', (payload = {}, ack) => {
    const session = accountSessions.resolve(socket.accountSessionToken);
    if (!session) {
      socket.accountSessionToken = '';
      socket.principal = null;
      if (typeof ack === 'function') ack({ ok: true, session: null });
      return;
    }

    socket.principal = session.principal;
    if (typeof ack === 'function') {
      ack({
        ok: true,
        session: {
          token: session.token,
          issuedAt: session.issuedAt,
          expiresAt: session.expiresAt,
          identity: { ...session.principal },
        },
      });
    }
  });""",
    """  socket.on('account session', async (payload = {}, ack) => {
    try {
      const session = await resolveAccountSessionToken(socket.accountSessionToken);
      if (!session) {
        socket.accountSessionToken = '';
        socket.principal = null;
        if (typeof ack === 'function') ack({ ok: true, session: null });
        return;
      }

      socket.principal = session.principal;
      socket.accountSessionToken = session.token;
      if (typeof ack === 'function') {
        ack({
          ok: true,
          session: {
            token: session.token,
            issuedAt: session.issuedAt,
            expiresAt: session.expiresAt,
            identity: { ...session.principal },
          },
        });
      }
    } catch (err) {
      console.error('[Auth v2] Account session unavailable:', err?.message || err);
      if (typeof ack === 'function') ack({ ok: false, error: 'ACCOUNT_SESSION_UNAVAILABLE' });
    }
  });""",
    'durable account-session validation',
)

replace_once(
    """  socket.on('account logout', (payload = {}, ack) => {
    if (socket.accountSessionToken) {
      accountSessions.revoke(socket.accountSessionToken);
    }
    socket.accountSessionToken = '';
    socket.principal = null;
    if (typeof ack === 'function') ack({ ok: true });
  });""",
    """  socket.on('account logout', async (payload = {}, ack) => {
    try {
      if (socket.accountSessionToken) {
        await revokeAccountSessionToken(socket.accountSessionToken);
      }
      socket.accountSessionToken = '';
      socket.principal = null;
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      console.error('[Auth v2] Account logout unavailable:', err?.message || err);
      if (typeof ack === 'function') ack({ ok: false, error: 'ACCOUNT_LOGOUT_UNAVAILABLE' });
    }
  });""",
    'durable logout revocation',
)

path.write_text(source)
