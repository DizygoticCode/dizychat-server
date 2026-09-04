'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('native origin allowlist is explicit and limited to Capacitor localhost origins', () => {
  const match = source.match(/const TRUSTED_NATIVE_ORIGINS\s*=\s*new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, 'TRUSTED_NATIVE_ORIGINS must exist');
  const origins = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]).sort();
  assert.deepEqual(origins, [
    'capacitor://localhost',
    'http://localhost',
    'https://localhost',
  ]);
});

test('Socket.IO configured allowlist includes trusted native origins without widening to wildcard', () => {
  assert.match(source, /SOCKET_IO_CORS_ORIGIN_CONFIG/);
  assert.match(source, /\.\.\.TRUSTED_NATIVE_ORIGINS/);
  assert.doesNotMatch(source, /TRUSTED_NATIVE_ORIGINS[\s\S]{0,500}Access-Control-Allow-Origin['"],\s*['"]\*['"]/);
});

test('HTTP CORS reflects only a trusted native origin and handles preflight', () => {
  assert.match(source, /isTrustedNativeHttpOrigin/);
  assert.match(source, /TRUSTED_NATIVE_ORIGINS\.has\(origin\)/);
  assert.match(source, /res\.setHeader\(['"]Access-Control-Allow-Origin['"],\s*origin\)/);
  assert.match(source, /res\.setHeader\(['"]Vary['"],\s*['"]Origin['"]\)/);
  assert.match(source, /res\.setHeader\(['"]Access-Control-Allow-Methods['"],\s*['"]GET,POST,OPTIONS['"]\)/);
  assert.match(source, /res\.setHeader\(['"]Access-Control-Allow-Headers['"],\s*['"]Content-Type,Authorization['"]\)/);
  assert.match(source, /req\.method\s*===\s*['"]OPTIONS['"][\s\S]{0,120}sendStatus\(204\)/);
});
