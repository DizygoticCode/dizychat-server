const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('DizyJam onboarding is OS-aware and keeps credentials out of the command', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');

  assert.match(source, /detectDizyJamPlatform/);
  assert.match(source, /Install JackTrip for \$\{escapeHtml\(platform\.label\)\}/);
  assert.match(source, /C:\\\\Program Files\\\\JackTrip\\\\jacktrip\.exe/);
  assert.match(source, /--password/);
  assert.match(source, /Temporary room credentials/);
  assert.match(source, /Advanced connection details/);
  assert.match(source, /DizyJam audio runs on a computer/);

  const commandBuilder = source.slice(
    source.indexOf('const buildDizyJamClientCommand'),
    source.indexOf('const renderSession =', source.indexOf('const buildDizyJamClientCommand'))
  );
  assert.doesNotMatch(commandBuilder, /session\?\.password|session\.password/);
});

test('DizyJam onboarding styling exposes guided steps and advanced details', () => {
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'chat.css'), 'utf8');

  assert.match(css, /\.jam-session-steps/);
  assert.match(css, /\.jam-session-step-number/);
  assert.match(css, /\.jam-session-command-card/);
  assert.match(css, /\.jam-session-credentials/);
  assert.match(css, /\.jam-session-advanced/);
});

test('DizyJam provider copy is musician-generic', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(source, /installing JackTrip and connecting to this room/);
  assert.match(source, /interface, microphone, keyboard or DAW audio routing/);
});
