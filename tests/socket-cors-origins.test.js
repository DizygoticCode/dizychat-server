'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { parseSocketCorsOrigins, isSocketOriginAllowed } = require('../src/config/socket-cors-origins');

test('production never silently permits wildcard browser origins', () => {
  for (const configured of [undefined, '', '*', '*,https://friend.example']) {
    const origins = parseSocketCorsOrigins({
      NODE_ENV: 'production',
      SOCKET_IO_CORS_ORIGINS: configured,
    });
    assert.deepEqual(origins.includes('*'), false);
    assert.ok(origins.includes('https://dizychat.com'));
    assert.ok(origins.includes('https://www.dizychat.com'));
  }
});

test('configured additional browsers and packaged native origins are respected', () => {
  const list = parseSocketCorsOrigins({
    NODE_ENV: 'production',
    SOCKET_IO_CORS_ORIGINS: 'HTTPS://FRIEND.EXAMPLE, https://friend.example',
  });
  assert.equal(list.filter((origin) => origin === 'https://friend.example').length, 1);
  assert.equal(isSocketOriginAllowed('https://friend.example', list), true);
  assert.equal(isSocketOriginAllowed('https://untrusted.example', list), false);
  // Caller adds TRUSTED_NATIVE_ORIGINS to this result before Socket.IO setup.
  const core = fs.readFileSync(path.join(__dirname, '..', 'server-core.js'), 'utf8');
  assert.match(core, /\.\.\.TRUSTED_NATIVE_ORIGINS/);
  assert.match(core, /allowRequest:\s*\(request, callback\)/);
  assert.match(core, /isSocketOriginAllowed\(request.headers.origin, SOCKET_IO_CORS_ORIGIN\)/);
});

test('local wildcard and non-browser clients remain backward compatible', () => {
  assert.equal(parseSocketCorsOrigins({ NODE_ENV: 'test' }), '*');
  assert.equal(isSocketOriginAllowed('https://other.example', '*'), true);
  assert.equal(isSocketOriginAllowed(undefined, ['https://dizychat.com']), true);
});
