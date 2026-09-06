'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const runtimePath = 'public/browser-notifications.js';

const loadRuntime = () => {
  const source = exists(runtimePath) ? read(runtimePath) : '';
  const context = vm.createContext({ window: {}, globalThis: {}, module: { exports: {} }, console });
  vm.runInContext(source, context);
  return context.module.exports && Object.keys(context.module.exports).length
    ? context.module.exports
    : context.window.dizychatBrowserNotifications;
};

const createButton = () => {
  const listeners = new Map();
  const attrs = new Map();
  return {
    hidden: true,
    title: '',
    disabled: false,
    addEventListener(name, fn) { listeners.set(name, fn); },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.get(name); },
    click() { return listeners.get('click')?.(); },
  };
};

const createHarness = ({ native = false, visibilityState = 'hidden', focused = false, permission = 'default' } = {}) => {
  const button = createButton();
  const storage = new Map();
  const notifications = [];
  const requestCalls = [];
  let focusCalls = 0;

  function Notification(title, options) {
    this.title = title;
    this.options = options;
    this.closed = false;
    this.close = () => { this.closed = true; };
    notifications.push(this);
  }
  Notification.permission = permission;
  Notification.requestPermission = async () => {
    requestCalls.push(true);
    Notification.permission = 'granted';
    return 'granted';
  };

  const win = {
    Notification,
    currentUser: 'Rob',
    currentRoom: 'General Chat',
    Capacitor: { isNativePlatform: () => native },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    document: {
      visibilityState,
      hasFocus: () => focused,
      getElementById: (id) => id === 'toggle-desktop-notifications' ? button : null,
    },
    focus() { focusCalls += 1; },
  };

  return { win, button, storage, notifications, requestCalls, getFocusCalls: () => focusCalls };
};

test('browser notification runtime exists and exposes the bounded controller seam', () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'browser notification runtime must exist');
  assert.equal(typeof runtime.createBrowserNotificationController, 'function');
  assert.equal(typeof runtime.decorateIoFactory, 'function');
});

test('permission is requested only from the explicit enable button and preference persists locally', async () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'browser notification runtime must exist');
  const h = createHarness();
  const controller = runtime.createBrowserNotificationController(h.win);

  assert.equal(controller.supported, true);
  assert.equal(h.button.hidden, false);
  assert.equal(h.requestCalls.length, 0, 'page load must not prompt for notification permission');
  assert.equal(h.storage.get('dizychat.desktopNotifications'), undefined);

  await h.button.click();
  assert.equal(h.requestCalls.length, 1);
  assert.equal(h.storage.get('dizychat.desktopNotifications'), 'on');
  assert.equal(h.button.getAttribute('aria-pressed'), 'true');
});

test('incoming message from somebody else notifies only while DizyChat is unfocused', async () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'browser notification runtime must exist');
  const h = createHarness({ visibilityState: 'hidden', focused: false, permission: 'granted' });
  h.storage.set('dizychat.desktopNotifications', 'on');
  const controller = runtime.createBrowserNotificationController(h.win);

  const shown = controller.show({ user: 'Alice', room: 'General Chat', message: '<b>Hello</b> Rob' });
  assert.ok(shown);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].title, 'DizyChat — General Chat');
  assert.equal(h.notifications[0].options.body, 'Alice: Hello Rob');

  h.win.document.visibilityState = 'visible';
  h.win.document.hasFocus = () => true;
  assert.equal(controller.show({ user: 'Alice', message: 'Focused' }), null);
  assert.equal(h.notifications.length, 1, 'focused DizyChat must not create an OS notification');
});

test('own messages never create desktop notifications', () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'browser notification runtime must exist');
  const h = createHarness({ permission: 'granted' });
  h.storage.set('dizychat.desktopNotifications', 'on');
  const controller = runtime.createBrowserNotificationController(h.win);

  assert.equal(controller.show({ user: 'rob', message: 'my own message' }), null);
  assert.equal(h.notifications.length, 0);
});

test('notification click focuses DizyChat and closes the notification', () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'browser notification runtime must exist');
  const h = createHarness({ permission: 'granted' });
  h.storage.set('dizychat.desktopNotifications', 'on');
  const controller = runtime.createBrowserNotificationController(h.win);
  const notification = controller.show({ user: 'Alice', message: 'Ping' });

  notification.onclick();
  assert.equal(h.getFocusCalls(), 1);
  assert.equal(notification.closed, true);
});

test('native Capacitor runtime is inert and never exposes the Chrome enable control', () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'browser notification runtime must exist');
  const h = createHarness({ native: true, permission: 'granted' });
  h.storage.set('dizychat.desktopNotifications', 'on');
  const controller = runtime.createBrowserNotificationController(h.win);

  assert.equal(controller.supported, false);
  assert.equal(h.button.hidden, true);
  assert.equal(controller.show({ user: 'Alice', message: 'Native' }), null);
});

test('Socket.IO decorator observes chat messages without changing the existing socket API', () => {
  const runtime = loadRuntime();
  assert.ok(runtime, 'browser notification runtime must exist');
  const h = createHarness({ permission: 'granted' });
  h.storage.set('dizychat.desktopNotifications', 'on');
  const controller = runtime.createBrowserNotificationController(h.win);
  const handlers = new Map();
  const socket = {
    on(name, fn) { handlers.set(name, fn); return this; },
    emit() { return this; },
  };
  const io = () => socket;
  io.Manager = function Manager() {};
  h.win.io = io;

  assert.equal(runtime.decorateIoFactory(h.win, controller), true);
  const decoratedSocket = h.win.io('/');
  assert.equal(decoratedSocket, socket);
  assert.equal(h.win.io.Manager, io.Manager);
  assert.equal(typeof handlers.get('chat message'), 'function');
  handlers.get('chat message')({ user: 'Alice', message: 'Via socket' });
  assert.equal(h.notifications.length, 1);
});

test('login and bootstrap expose browser notifications without service-worker or Web Push background behavior', () => {
  const login = read('public/login.html');
  const bootstrap = read('public/mobile-bootstrap.js');
  const runtimeSource = exists(runtimePath) ? read(runtimePath) : '';

  assert.match(login, /id="toggle-desktop-notifications"/);
  assert.match(login, /Enable desktop notifications/);
  const runtimeAt = bootstrap.indexOf("/browser-notifications.js");
  const chatAt = bootstrap.indexOf("/chat.js");
  assert.ok(runtimeAt >= 0 && chatAt > runtimeAt, 'notification runtime must decorate Socket.IO before chat.js creates the socket');
  assert.doesNotMatch(runtimeSource, /serviceWorker|PushManager|pushManager|ServiceWorkerRegistration/);
});
