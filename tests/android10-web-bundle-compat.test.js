const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifestSource = fs.readFileSync(
  path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'chat', 'dizychat', 'WebBundleManifest.java'),
  'utf8',
);

test('web bundle path decoding avoids URLDecoder on Android 10', () => {
  assert.doesNotMatch(
    manifestSource,
    /\bURLDecoder\b/,
    'URLDecoder is rewritten by D8 to a Charset overload that is unavailable on Android 10',
  );
});
