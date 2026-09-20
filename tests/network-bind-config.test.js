'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_BIND_HOST,
  isLoopbackAddress,
  resolveBindHost,
  resolveTrustedRemoteAddress,
} = require('../src/config/network');

const repoRoot = path.resolve(__dirname, '..');

test('DizyChat bind host preserves the existing all-interface default', () => {
  assert.equal(DEFAULT_BIND_HOST, '0.0.0.0');
  assert.equal(resolveBindHost({}), '0.0.0.0');
  assert.equal(resolveBindHost({ DIZYCHAT_BIND_HOST: '' }), '0.0.0.0');
});

test('DizyChat bind host accepts an explicit loopback host for reverse-proxy deployments', () => {
  assert.equal(resolveBindHost({ DIZYCHAT_BIND_HOST: ' 127.0.0.1 ' }), '127.0.0.1');
  assert.equal(resolveBindHost({ DIZYCHAT_BIND_HOST: '::1' }), '::1');
});

test('DizyChat bind host rejects malformed host values', () => {
  assert.throws(
    () => resolveBindHost({ DIZYCHAT_BIND_HOST: '127.0.0.1 /tmp/socket' }),
    /invalid host value/,
  );
  assert.throws(
    () => resolveBindHost({ DIZYCHAT_BIND_HOST: 'bad\\host' }),
    /invalid host value/,
  );
});

test('proxy client addresses are trusted only when the direct peer is loopback', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.50'), false);

  assert.equal(resolveTrustedRemoteAddress({
    peerAddress: '127.0.0.1',
    forwardedFor: '198.51.100.99, 203.0.113.20',
  }), '203.0.113.20');

  assert.equal(resolveTrustedRemoteAddress({
    peerAddress: '192.168.1.50',
    forwardedFor: '8.8.8.8',
  }), '192.168.1.50');
});

test('production server passes the configured host to server.listen', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(server, /app\.set\('trust proxy', 'loopback'\);/);
  assert.match(server, /const BIND_HOST = resolveBindHost\(process\.env\);/);
  assert.match(server, /resolveTrustedRemoteAddress\(\{/);
  assert.match(server, /server\.listen\(PORT, BIND_HOST,/);
  assert.match(server, /\[Server\] Listening on \$\{BIND_HOST\}:\$\{PORT\}/);
});
