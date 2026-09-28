'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const chat = fs.readFileSync(path.join(root, 'public/chat.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/login.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/chat.css'), 'utf8');
const begin = chat.indexOf('function renderRecentRoomList(');
const end = chat.indexOf('function renderPublicRooms(', begin);
assert.ok(begin >= 0 && end > begin, 'production recent-room renderer must be discoverable');

function element() {
  const handlers = {};
  const node = {
    children: [], textContent: '', hidden: false, value: '', disabled: false,
    appendChild(child) { this.children.push(child); },
    addEventListener(type, handler) { handlers[type] = handler; },
    setAttribute(name, value) { this[name] = value; },
    click() { handlers.click?.(); },
    focus() { this.focused = true; },
  };
  let markup = '';
  Object.defineProperty(node, 'innerHTML', {
    get() { return markup; },
    set(value) { markup = value; node.children = []; },
  });
  return node;
}

function fixture() {
  const recentRoomsSection = element();
  const recentRoomList = element();
  const roomInput = element();
  const passwordInput = element();
  const emitted = [];
  const callbacks = [];
  const toasts = [];
  const identity = { kind: 'account', userId: 'alice', username: 'Alice' };
  const accountState = { identity };
  const socket = { connected: true, emit(name, payload, callback) {
    emitted.push({ name, payload });
    if (typeof callback === 'function') callbacks.push({ name, callback });
  } };
  let joins = 0;
  const context = vm.createContext({
    accountState, socket, recentRoomsSection, recentRoomList, roomInput, passwordInput,
    document: { createElement: element },
    showToast: (message) => toasts.push(message),
    emitJoinRequest: () => { joins += 1; },
    syncLandingJoinFlow() {},
  });
  vm.runInContext(chat.slice(begin, end), context);
  return {
    context, accountState, emitted, callbacks, toasts,
    recentRoomsSection, recentRoomList, roomInput, passwordInput,
    get joins() { return joins; },
  };
}

test('signed-in landing renders account-only rooms as text, not HTML', () => {
  const c = fixture();
  c.context.renderRecentRoomList([
    { name: '<img src=x onerror=alert(1)>', requiresPassword: false },
    { name: 'Private', requiresPassword: true },
  ]);
  assert.equal(c.recentRoomsSection.hidden, false);
  assert.equal(c.recentRoomList.children.length, 2);
  assert.equal(c.recentRoomList.children[0].children[0].textContent,
    'Continue to #<img src=x onerror=alert(1)>');
  assert.equal(c.recentRoomList.children[0].children[0].innerHTML, '');
  assert.match(c.recentRoomList.children[1].children[1].textContent, /password required/);

  c.accountState.identity = null;
  c.context.renderRecentRoomList([{ name: 'Private', requiresPassword: true }]);
  assert.equal(c.recentRoomsSection.hidden, true);
  assert.equal(c.recentRoomList.children.length, 0);
});

test('private room selection requires password re-entry; public selection follows ordinary join', () => {
  const c = fixture();
  c.context.renderRecentRoomList([
    { name: 'Private', requiresPassword: true },
    { name: 'Public', requiresPassword: false },
  ]);
  c.passwordInput.value = 'previous-secret';
  c.recentRoomList.children[0].children[0].click();
  assert.equal(c.joins, 0);
  assert.equal(c.roomInput.value, 'Private');
  assert.equal(c.passwordInput.value, '');
  assert.equal(c.passwordInput.focused, true);
  assert.ok(c.toasts.some((value) => value.includes('room password')));

  c.recentRoomList.children[1].children[0].click();
  assert.equal(c.joins, 1);
  assert.equal(c.roomInput.value, 'Public');
  assert.equal(c.passwordInput.value, '');
});

test('delayed previous-account replies do not expose private room history', () => {
  const c = fixture();
  c.context.requestRecentRooms();
  assert.equal(c.emitted[0].name, 'recent rooms get');
  c.accountState.identity = { kind: 'account', userId: 'bob', username: 'Bob' };
  c.callbacks[0].callback({ ok: true, rooms: [{ name: 'AlicePrivate', requiresPassword: true }] });
  assert.equal(c.recentRoomList.children.length, 0);
  assert.equal(c.recentRoomsSection.hidden, false, 'stale response must not render or overwrite current UI');
  c.accountState.identity = null;
  c.context.requestRecentRooms();
  assert.equal(c.recentRoomsSection.hidden, true);
  assert.equal(c.recentRoomList.children.length, 0);
});

test('remove is a verified server request, not a local membership or password change', () => {
  const c = fixture();
  c.context.renderRecentRoomList([{ name: 'Public', requiresPassword: false }]);
  c.recentRoomList.children[0].children[2].click();
  assert.equal(c.emitted.at(-1).name, 'recent rooms forget');
  assert.equal(c.emitted.at(-1).payload.room, 'Public');
  c.callbacks.at(-1).callback({ ok: true, rooms: [] });
  assert.equal(c.recentRoomsSection.hidden, true);
  assert.equal(c.joins, 0);
});

test('login markup and mobile-safe focus styles preserve identity-first and guest flows', () => {
  assert.match(html, /id="registered-login"[\s\S]*id="guest-login"[\s\S]*id="room-entry-step"/);
  assert.match(html, /id="recent-rooms-section"[^>]*hidden/);
  assert.match(html, /id="recent-room-list"/);
  assert.match(css, /#room-entry-step \.recent-rooms\[hidden\]/);
  assert.match(css, /#room-entry-step \.recent-room-join:focus-visible/);
  assert.match(css, /min-height: 44px/);
  const source = chat.slice(begin, end);
  assert.doesNotMatch(source, /localStorage|sessionStorage|roomPassword|passwordHash/);
  assert.match(source, /room\.requiresPassword/);
  assert.match(source, /socket\.emit\("recent rooms get"/);
});
