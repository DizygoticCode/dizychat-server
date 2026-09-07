const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifestSource = fs.readFileSync(
  path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'chat', 'dizychat', 'WebBundleManifest.java'),
  'utf8',
);

test('web bundle path decoding stays compatible with Android 10', () => {
  assert.doesNotMatch(
    manifestSource,
    /URLDecoder\.decode\(value,\s*StandardCharsets\.UTF_8\)/,
    'Charset URLDecoder overload is unavailable on Android 10',
  );
  assert.match(
    manifestSource,
    /URLDecoder\.decode\(value,\s*"UTF-8"\)/,
    'use the legacy UTF-8 string overload supported by Android 10',
  );
});
