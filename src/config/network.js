'use strict';

const DEFAULT_BIND_HOST = '0.0.0.0';

const resolveBindHost = (env = process.env) => {
  const raw = typeof env.DIZYCHAT_BIND_HOST === 'string'
    ? env.DIZYCHAT_BIND_HOST.trim()
    : '';

  if (!raw) return DEFAULT_BIND_HOST;
  if (raw.length > 255 || /[\s/\\]/.test(raw)) {
    throw new Error('DIZYCHAT_BIND_HOST contains an invalid host value');
  }

  return raw;
};

const normalizePeerAddress = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('::ffff:')) return raw.slice('::ffff:'.length);
  return raw;
};

const isLoopbackAddress = (value) => {
  const address = normalizePeerAddress(value);
  return address === '::1' || /^127(?:\.|$)/.test(address);
};

const resolveTrustedRemoteAddress = ({
  peerAddress,
  forwardedFor,
} = {}) => {
  const peer = normalizePeerAddress(peerAddress);
  if (!isLoopbackAddress(peer)) return peer || 'unknown';

  const forwardedChain = typeof forwardedFor === 'string'
    ? forwardedFor.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const forwarded = forwardedChain.length
    ? forwardedChain[forwardedChain.length - 1]
    : '';
  return forwarded || peer || 'unknown';
};

module.exports = {
  DEFAULT_BIND_HOST,
  isLoopbackAddress,
  resolveBindHost,
  resolveTrustedRemoteAddress,
};
