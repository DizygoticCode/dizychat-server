'use strict';

// A production deployment must not silently turn an absent CORS configuration
// into a wildcard. Preserve the existing permissive behaviour for local tests.
const DEFAULT_PUBLIC_ORIGINS = Object.freeze([
  'https://dizychat.com',
  'https://www.dizychat.com',
]);

function parseSocketCorsOrigins(env = process.env) {
  const raw = String(
    env.SOCKET_IO_CORS_ORIGINS ||
    env.SOCKET_IO_CORS_ORIGIN ||
    env.CORS_ORIGINS ||
    env.CORS_ORIGIN ||
    '',
  ).trim();

  const production = env.NODE_ENV === 'production';
  const requested = raw.split(',').map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const wildcard = requested.includes('*');

  if (!production && (!requested.length || wildcard)) return '*';

  if (production && (!requested.length || wildcard)) {
    console.warn('[Socket.IO] Production wildcard/missing origin configuration; using first-party origins only. Set SOCKET_IO_CORS_ORIGINS for additional trusted browser origins.');
  }

  const explicit = requested.filter((s) => s !== '*');
  return [...new Set(production
    ? [...DEFAULT_PUBLIC_ORIGINS, ...explicit]
    : explicit)];
}

function isSocketOriginAllowed(origin, allowlist) {
  // Native/non-browser clients may omit Origin; authentication and room
  // authorization are still required. Origin is NOT an authentication factor.
  const value = String(origin || '').trim().toLowerCase();
  if (!value || allowlist === '*') return true;
  return Array.isArray(allowlist) && allowlist.includes(value);
}

module.exports = { DEFAULT_PUBLIC_ORIGINS, parseSocketCorsOrigins, isSocketOriginAllowed };
