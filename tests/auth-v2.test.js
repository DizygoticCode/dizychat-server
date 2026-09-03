const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function freshTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dizychat-auth-v2-'));
}

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

test('Auth v2 password and store modules exist with durable account/session boundaries', async () => {
  const { hashPassword, verifyPassword } = require('../src/auth/passwords');
  const { createAuthStore } = require('../src/auth/store');

  const encoded = await hashPassword('correct horse battery staple');
  assert.match(encoded, /^scrypt\$v=1\$N=16384,r=8,p=1\$/);
  assert.equal(await verifyPassword('correct horse battery staple', encoded), true);
  assert.equal(await verifyPassword('wrong password', encoded), false);

  const dataDir = freshTempDir();
  const store = createAuthStore({ dataDir, sessionTtlMs: 60_000 });
  const user = await store.createUser({
    username: 'ExampleUser',
    displayName: 'Example User',
    password: 'correct horse battery staple',
    role: 'user',
  });
  assert.equal(user.username, 'ExampleUser');
  await assert.rejects(
    () => store.createUser({ username: 'exampleuser', displayName: 'Duplicate', password: 'another long password', role: 'user' }),
    /USERNAME_TAKEN/
  );
  assert.equal(await store.guestNameAvailable('EXAMPLEUSER'), false);

  const session = store.createSession(user.id);
  assert.match(session.token, /^[A-Za-z0-9_-]{32,}$/);
  const dbBytes = fs.readFileSync(path.join(dataDir, 'auth.sqlite'));
  assert.equal(dbBytes.includes(Buffer.from(session.token)), false, 'raw session token must not be persisted');
  assert.equal(store.resolveSession(session.token).id, user.id);
  store.revokeSession(session.token);
  assert.equal(store.resolveSession(session.token), null);
  store.close();
});

test('reserved privileged identities cannot be claimed by guests', async () => {
  const { createAuthStore } = require('../src/auth/store');
  const store = createAuthStore({ dataDir: freshTempDir() });
  store.reservePrivilegedIdentity({ username: 'Psybin', displayName: 'Psybin', role: 'admin' });
  assert.equal(await store.guestNameAvailable('psybin'), false);
  const psybin = store.findUserByUsername('PSYBIN');
  assert.equal(psybin.role, 'admin');
  assert.equal(psybin.state, 'disabled');
  store.close();
});

test('legacy migration preserves Dizygotic owner and Psybin admin identities', async () => {
  const { createAuthStore } = require('../src/auth/store');
  const { legacyEncodeForTests, migrateLegacyAdmins } = require('../src/auth/legacy-admin-migration');
  const store = createAuthStore({ dataDir: freshTempDir() });

  const result = await migrateLegacyAdmins({
    store,
    credentials: [
      { username: 'Dizygotic', kind: 'scrypt', credential: legacyEncodeForTests('owner-password-value') },
      { username: 'Psybin', kind: 'scrypt', credential: legacyEncodeForTests('admin-password-value') },
    ],
  });
  assert.equal(result.status, 'completed');
  assert.equal(store.findUserByUsername('dizygotic').role, 'owner');
  assert.equal(store.findUserByUsername('psybin').role, 'admin');
  assert.equal((await store.authenticate('Dizygotic', 'owner-password-value')).role, 'owner');
  assert.equal((await store.authenticate('Psybin', 'admin-password-value')).role, 'admin');

  const again = await migrateLegacyAdmins({ store, credentials: [] });
  assert.equal(again.status, 'completed');
  assert.equal(store.findUserByUsername('dizygotic').role, 'owner');
  store.close();
});

test('missing Psybin credential reserves the historical admin identity', async () => {
  const { createAuthStore } = require('../src/auth/store');
  const { legacyEncodeForTests, migrateLegacyAdmins } = require('../src/auth/legacy-admin-migration');
  const store = createAuthStore({ dataDir: freshTempDir() });
  await migrateLegacyAdmins({
    store,
    credentials: [
      { username: 'Dizygotic', kind: 'scrypt', credential: legacyEncodeForTests('owner-password-value') },
    ],
  });
  const psybin = store.findUserByUsername('Psybin');
  assert.equal(psybin.role, 'admin');
  assert.equal(psybin.state, 'disabled');
  assert.equal(await store.guestNameAvailable('Psybin'), false);
  store.close();
});

test('client navigation never serialises room passwords', () => {
  const client = read('public/chat.js');
  assert.doesNotMatch(client, /params\.set\(["']password["']/);
  assert.match(client, /function updateQueryParams\(room\)/);
  assert.doesNotMatch(client, /updateQueryParams\([^\n]*password/);
});

test('server does not allow first client to define a room password', () => {
  const server = read('index.js');
  assert.doesNotMatch(server, /roomPasswords\.set\(roomName,\s*providedPassword\)/);
  assert.match(server, /ROOM_PASSWORDS_JSON|ROOM_PASSWORD_/);
});

test('message schema keeps display name compatibility and adds stable identity metadata', () => {
  const model = read('src/models/message.js');
  assert.match(model, /userId/);
  assert.match(model, /identityType/);
  assert.match(model, /user:\s*\{\s*type:\s*String,\s*required:\s*true/);
});

test('mobile layout uses visual viewport and explicit narrow-phone contracts', () => {
  const client = read('public/chat.js');
  const css = read('public/chat.css');
  assert.match(client, /visualViewport/);
  assert.match(client, /--app-height/);
  assert.match(css, /--app-height/);
  assert.match(css, /@media\s*\(max-width:\s*480px\)/);
  assert.match(css, /@media\s*\(max-width:\s*360px\)/);
  assert.match(css, /overflow-x:\s*hidden/);
});
