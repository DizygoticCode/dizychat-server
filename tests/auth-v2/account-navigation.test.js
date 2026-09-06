'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSessionStore } = require('../../src/auth/session-store');
const { createMobileSessionService } = require('../../src/auth/mobile-session-service');
const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const chat = read('public/chat.js');
const server = `${read('index.js')}\n${read('server-core.js')}`;
const between = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing production boundary: ${start}`);
  return source.slice(from, to);
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const identity = { kind: 'account', username: 'AccountTester', canonicalUsername: 'accounttester', role: 'user', userId: 'test-id' };

function element() {
  const events = {};
  return {
    value: '', hidden: false, textContent: '', disabled: false, style: {}, dataset: {}, children: [],
    classList: { add() {}, toggle() {}, remove() {} },
    addEventListener(name, fn) { events[name] = fn; },
    fire(name, event = {}) { return events[name]?.(event); },
    click() { return events.click?.(); }, focus() {},
    appendChild(child) { this.children.push(child); },
  };
}

// Run the production account/room handlers; stub only DOM, transport and unrelated media UI.
function client({ native = false, vault = { token: '' }, logoutAck = { ok: true }, sessionAck, deferLogin = false, deferLogout = false } = {}) {
  const values = new Map();
  const sessionStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const nodes = Object.fromEntries([
    'accountIdentity', 'accountLogoutBtn', 'lobbyAccountLogoutBtn', 'accountLoginStatus',
    'accountUsernameInput', 'accountPasswordInput', 'registeredJoinBtn', 'guestLogin',
    'roomInput', 'passwordInput', 'usernameInput', 'leaveBtn', 'publicRoomList', 'joinBtn',
    'usernamePrompt', 'chatContainer', 'roomName',
  ].map((name) => [name, element()]));
  const events = {}, sent = [], toasts = [], pending = {}, timers = new Map();
  const socket = {
    connected: true, auth: {}, on(name, fn) { events[name] = fn; },
    emit(name, payload, ack) {
      sent.push({ name, payload });
      if (name === 'account login') {
        if (deferLogin) { pending.login = ack; return; }
        ack({ ok: true, session: { token: 'test-token', identity } });
      }
      if (name === 'account logout') {
        if (deferLogout) { pending.logout = ack; return; }
        return ack?.(logoutAck);
      }
      if (name === 'account session') return ack?.(sessionAck ?? { ok: true, session: { token: 'test-token', identity } });
    },
  };
  const window = { sessionStorage, currentRoom: null, currentUser: null, currentPassword: '',
    Capacitor: { isNativePlatform: () => native, Plugins: { SecureSession: {
      async readToken() { return { token: vault.token }; },
      async writeToken({ token }) { vault.token = token; },
      async clearToken() { await vault.beforeClear?.(); vault.token = ''; },
    } } },
  };
  const context = vm.createContext({ window, console: { ...console, warn() {} },
    setTimeout(fn) { const id = Symbol(); timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }, socket, ...nodes,
    guestUsernameInput: nodes.usernameInput, accountAuth: null, events, sent,
    appState: { users: [] }, latestPublicRooms: [], lastRoomName: '', lastRoomPassword: '', isViewingChat: false,
    copyJoinLinkBtn: null, siteLanding: null, pinnedContainer: null, messages: null,
    document: { createElement: element },
    showToast: (text) => toasts.push(text),
    refreshActionMenus() {}, renderUserSidebar() {}, clearReplyTarget() {}, closeWatchPartyModal() {},
    resetChromeToolbarAttention() {}, cancelEnsureMessagesAtBottom() {}, setViewMode() {},
    hideSearchResults() {}, resetMessageReadObserver() {}, setPsybinPlayerRoom() {}, setInfowarsStreamRoom() {},
    updateQueryParams() {},
    completeRoomJoin(username, room, password) { Object.assign(window, { currentUser: username, currentRoom: room, currentPassword: password }); },
  });
  vm.runInContext(read('public/auth-v2-client.js'), context);
  context.accountAuth = window.dizychatAuthV2;
  context.readAccountSessionToken = () => context.accountAuth.readToken();
  context.storeAccountSessionToken = (token) => context.accountAuth.writeToken(token);
  vm.runInContext(between(chat, 'const accountState =', 'const replyState ='), context);
  vm.runInContext(between(chat, 'function showLanding(', 'async function copyTextToClipboard'), context);
  vm.runInContext(between(chat, 'function joinCurrentRoomAsAccount(', 'if (copyJoinLinkBtn) {\n  copyJoinLinkBtn.addEventListener'), context);
  vm.runInContext(between(chat, 'socket.on("connect",', 'socket.on("disconnect",'), context);
  vm.runInContext(between(chat, 'socket.on("disconnect",', 'socket.on("room list",'), context);
  const run = (code) => vm.runInContext(code, context);
  return { ...nodes, window, socket, sent, events, run, vault, toasts, pending,
    expireRequests() { for (const fn of [...timers.values()]) fn(); }, auth: context.accountAuth };
}

test('registered sign-in establishes global identity without selecting or joining a room', async () => {
  const c = client();
  c.accountUsernameInput.value = identity.username;
  c.accountPasswordInput.value = 'password';
  c.registeredJoinBtn.click();
  await flush();
  assert.equal(c.run('accountState.identity?.username'), identity.username);
  assert.equal(c.window.currentRoom, null);
  assert.equal(c.sent.some((e) => e.name === 'join room'), false);
  assert.equal(c.auth.readToken(), 'test-token');
});

test('Leave room preserves identity and token and exposes lobby account Sign out', async () => {
  const c = client({ native: true });
  c.run('applyAccountSession({ token: "test-token", identity: ' + JSON.stringify(identity) + ' })');
  c.window.currentRoom = 'First';
  c.leaveBtn.click();
  await flush();
  assert.equal(c.window.currentRoom, null);
  assert.equal(c.run('accountState.identity.username'), identity.username);
  assert.equal(c.auth.readToken(), 'test-token');
  assert.equal(c.vault.token, 'test-token');
  assert.equal(c.lobbyAccountLogoutBtn.hidden, false);
  c.lobbyAccountLogoutBtn.click();
  await flush();
  assert.equal(c.auth.readToken(), '', 'lobby control must execute account logout');
});

test('authenticated manual joins use account identity without guest fields or implicit logout', () => {
  const c = client();
  c.run('applyAccountSession({ token: "test-token", identity: ' + JSON.stringify(identity) + ' })');
  c.roomInput.value = 'Second';
  c.joinBtn.click();
  assert.equal(c.sent.find((e) => e.name === 'join room')?.payload.username, identity.username);
  assert.equal(c.sent.some((e) => e.name === 'account logout'), false);
});

test('public room activation uses the signed-in account instead of guest-name protection', () => {
  const c = client();
  c.run('applyAccountSession({ token: "test-token", identity: ' + JSON.stringify(identity) + ' })');
  c.run('renderPublicRooms([{ name: "General Chat" }])');
  c.publicRoomList.children[0].click();
  assert.equal(c.sent.find((e) => e.name === 'join room')?.payload.username, identity.username);
  assert.equal(c.sent.some((e) => e.name === 'account logout'), false);
});

test('Enter on registered credentials signs in globally rather than attempting a guest join', async () => {
  const c = client();
  c.accountUsernameInput.value = identity.username;
  c.accountPasswordInput.value = 'password';
  c.accountPasswordInput.fire('keydown', { key: 'Enter', preventDefault() {} });
  await flush();
  assert.equal(c.run('accountState.identity?.username'), identity.username);
});

for (const native of [false, true]) {
  test(`explicit ${native ? 'Android' : 'browser'} logout clears the session and cannot restore it`, async () => {
    const c = client({ native });
    c.run('applyAccountSession({ token: "test-token", identity: ' + JSON.stringify(identity) + ' })');
    await flush();
    c.accountLogoutBtn.click();
    await flush();
    assert.equal(c.sent.filter((e) => e.name === 'account logout').length, 1);
    assert.equal(c.auth.readToken(), '');
    assert.equal(c.run('accountState.identity'), null);
    assert.equal(c.socket.auth.sessionToken, undefined);
    assert.equal(await client({ native, vault: c.vault }).auth.restoreNativeSession(), '');
  });
}

test('failed server logout does not claim success or discard a still-valid durable session', async () => {
  const c = client({ native: true, logoutAck: { ok: false, error: 'ACCOUNT_LOGOUT_UNAVAILABLE' } });
  c.run('applyAccountSession({ token: "test-token", identity: ' + JSON.stringify(identity) + ' })');
  await flush();
  c.accountLogoutBtn.click();
  await flush();
  assert.equal(c.auth.readToken(), 'test-token');
  assert.equal(c.vault.token, 'test-token');
  assert.equal(c.toasts.includes('Signed out'), false);
});

test('temporary session-validation failure retains Android identity and durable token', async () => {
  const c = client({ native: true, sessionAck: { ok: false, error: 'ACCOUNT_SESSION_UNAVAILABLE' } });
  c.run('applyAccountSession({ token: "test-token", identity: ' + JSON.stringify(identity) + ' })');
  await flush();
  c.events.connect();
  await flush();
  assert.equal(c.auth.readToken(), 'test-token');
  assert.equal(c.vault.token, 'test-token');
  assert.equal(c.run('accountState.identity.username'), identity.username);
});

test('server-confirmed invalid session clears Android persistence', async () => {
  const c = client({ native: true, sessionAck: { ok: true, session: null } });
  c.run('applyAccountSession({ token: "test-token", identity: ' + JSON.stringify(identity) + ' })');
  await flush();
  c.events.connect();
  await flush();
  assert.equal(c.auth.readToken(), '');
  assert.equal(c.vault.token, '');
});

test('login document exposes a real Sign out control outside the room container', () => {
  const lobby = read('public/login.html').split('<div id="chat-container"')[0];
  assert.match(lobby, /<button[^>]*id="lobby-account-logout-btn"[^>]*>Sign out of registered account<\/button>/);
  assert.doesNotMatch(lobby, /Sign in &amp; join|Sign in & join/);
});

test('an older native session clear cannot erase a newer registered login', async () => {
  let releaseClear;
  const c = client({ native: true, sessionAck: { ok: true, session: null },
    vault: { token: '', beforeClear: () => new Promise((resolve) => { releaseClear = resolve; }) } });
  c.events.connect();
  await flush();
  c.accountUsernameInput.value = identity.username;
  c.accountPasswordInput.value = 'password';
  c.registeredJoinBtn.click();
  releaseClear();
  await flush();
  assert.equal(c.run('accountState.identity?.username'), identity.username);
  assert.equal(c.auth.readToken(), 'test-token');
  assert.equal(c.socket.auth.sessionToken, 'test-token');
  assert.equal(c.vault.token, 'test-token');
});

for (const action of ['login', 'logout']) {
  test(`lost ${action} acknowledgement recovers on disconnect and ignores the old callback`, async () => {
    const c = client({ deferLogin: action === 'login', deferLogout: action === 'logout' });
    if (action === 'logout') {
      c.run('applyAccountSession({ token: "test-token", identity: ' + JSON.stringify(identity) + ' })');
      c.accountLogoutBtn.click();
    } else {
      c.accountUsernameInput.value = identity.username;
      c.accountPasswordInput.value = 'password';
      c.registeredJoinBtn.click();
    }
    c.events.disconnect();
    c.events.connect();
    await flush();
    assert.equal(c.run('accountState.busy'), false);
    assert.equal(c.run('accountState.identity?.username'), identity.username);
    await c.pending[action]({ ok: true, session: { token: 'stale-token', identity } });
    await flush();
    assert.equal(c.auth.readToken(), 'test-token');
    assert.equal(c.run('accountState.identity?.username'), identity.username);
  });
}

test('an unacknowledged account request times out without clearing the session', async () => {
  const c = client({ deferLogout: true });
  c.run('applyAccountSession({ token: "test-token", identity: ' + JSON.stringify(identity) + ' })');
  c.accountLogoutBtn.click();
  c.expireRequests();
  assert.equal(c.run('accountState.busy'), false);
  assert.equal(c.auth.readToken(), 'test-token');
  await c.pending.logout({ ok: true });
  await flush();
  assert.equal(c.auth.readToken(), 'test-token', 'late acknowledgement cannot mutate a newer client state');
});

test('existing account logout event revokes each session kind through the actual authority', async () => {
  const documents = [];
  const matches = (doc, query) => Object.entries(query).every(([k, v]) => doc[k] === v);
  const MobileSessionModel = {
    async create(doc) { documents.push(doc); return doc; },
    async findOne(query) { return documents.find((doc) => matches(doc, query)) || null; },
    async updateOne(query, update) {
      const doc = documents.find((value) => matches(value, query));
      if (!doc) return { modifiedCount: 0 };
      Object.assign(doc, update.$set); return { modifiedCount: 1 };
    },
    async updateMany() { throw new Error('logout must revoke only the current session'); },
  };
  const accountSessions = createSessionStore();
  const mobileAccountSessions = createMobileSessionService({ MobileSessionModel,
    UserModel: { async findOne() { return { _id: identity.userId, ...identity, state: 'active' }; } },
  });
  for (const service of [accountSessions, mobileAccountSessions]) {
    const session = await service.issue(identity);
    const other = await service.issue(identity);
    const handlers = {};
    const socket = { accountSessionToken: session.token, principal: identity, on(name, fn) { handlers[name] = fn; } };
    const context = vm.createContext({ accountSessions, mobileAccountSessions, socket, console });
    vm.runInContext(between(server, 'const revokeAccountSessionToken =', 'const roomPasswordService ='), context);
    vm.runInContext(between(server, "socket.on('account logout',", "socket.on('account manage user',"), context);
    let ack;
    await handlers['account logout']({}, (value) => { ack = value; });
    assert.equal(ack.ok, true);
    assert.equal(await service.resolve(session.token), null);
    assert.ok(await service.resolve(other.token), 'other device/tab remains signed in');
    assert.equal(socket.accountSessionToken, '');
    assert.equal(socket.principal, null);
  }
  assert.ok(documents[0].revokedAt instanceof Date, 'mobile revocation persists to its Mongo model');
});
