const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const deployment = path.join(root, 'deploy', 'livekit');
const compose = fs.readFileSync(path.join(deployment, 'compose.yaml'), 'utf8');
const template = fs.readFileSync(path.join(deployment, 'livekit.yaml.example'), 'utf8');
const runbook = fs.readFileSync(path.join(deployment, 'README.md'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'self-host-ui-test.yml'), 'utf8');

assert.match(compose, /^\s*image: livekit\/livekit-server:v1\.13\.5\s*$/m, 'LiveKit image must pin the reviewed release');
assert.doesNotMatch(compose, /:latest\b/, 'deployment must not float on latest');
assert.match(compose, /network_mode: host/, 'host networking avoids invalid WebRTC port translation');
assert.match(template, /tcp_port: 7881/);
assert.match(template, /port_range_start: 50000/);
assert.match(template, /port_range_end: 50100/);
assert.match(template, /LIVEKIT_API_KEY_PLACEHOLDER: LIVEKIT_API_SECRET_PLACEHOLDER/);
assert.doesNotMatch(template, /devkey|\bsecret\b\s*$/m, 'template must not contain LiveKit development credentials');
assert.match(gitignore, /^deploy\/livekit\/livekit\.yaml$/m, 'generated credential config must be ignored');
for (const expected of ['7880', '7881', '50000-50100', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'wss://']) {
  assert.ok(runbook.includes(expected), `runbook must document ${expected}`);
}
for (const expected of [
  './deploy/livekit/generate-config.sh > /dev/null',
  'config --quiet',
  'up --detach livekit',
  'http://127.0.0.1:7880/',
  'logs --no-color livekit',
  'down --volumes --remove-orphans',
]) {
  assert.ok(workflow.includes(expected), `CI must exercise LiveKit with: ${expected}`);
}

const temporaryDeployment = fs.mkdtempSync(path.join(os.tmpdir(), 'dizychat-livekit-'));
try {
  fs.copyFileSync(path.join(deployment, 'livekit.yaml.example'), path.join(temporaryDeployment, 'livekit.yaml.example'));
  fs.copyFileSync(path.join(deployment, 'generate-config.sh'), path.join(temporaryDeployment, 'generate-config.sh'));
  fs.chmodSync(path.join(temporaryDeployment, 'generate-config.sh'), 0o755);
  const generated = spawnSync('./generate-config.sh', { cwd: temporaryDeployment, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const config = fs.readFileSync(path.join(temporaryDeployment, 'livekit.yaml'), 'utf8');
  assert.doesNotMatch(config, /PLACEHOLDER/, 'generator must replace every credential placeholder');
  assert.match(config, /^  [a-f0-9]{32}: [A-Za-z0-9+/=]{40,}$/m, 'generator must create strong key material');
  assert.equal(fs.statSync(path.join(temporaryDeployment, 'livekit.yaml')).mode & 0o777, 0o600);
  const refused = spawnSync('./generate-config.sh', { cwd: temporaryDeployment, encoding: 'utf8' });
  assert.notEqual(refused.status, 0, 'generator must refuse to overwrite credentials');
} finally {
  fs.rmSync(temporaryDeployment, { recursive: true, force: true });
}

console.log('LiveKit self-host deployment contract passed');
