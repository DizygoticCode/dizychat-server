'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicRoot = path.resolve(__dirname, '../public');

for (const page of ['index.html', 'login.html', 'reset-password.html']) {
  test(`${page} keeps device viewport and safe-area support without disabling user zoom`, () => {
    const html = fs.readFileSync(path.join(publicRoot, page), 'utf8');
    const tag = html.match(/<meta\s+name="viewport"[^>]*>/)?.[0] ||
      html.match(/<meta\s+name="viewport"[\s\S]*?>/)?.[0] || '';
    assert.ok(tag, `${page}: viewport tag is required`);
    assert.match(tag, /width=device-width/);
    assert.match(tag, /initial-scale=1(?:\.0)?/);
    assert.match(tag, /viewport-fit=cover/);
    assert.doesNotMatch(tag, /user-scalable\s*=\s*no/i);
    assert.doesNotMatch(tag, /maximum-scale\s*=\s*1(?:\.0)?(?:["',\s]|$)/i);
  });
}
