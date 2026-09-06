'use strict';

(function initBrowserNotifications(root, factory) {
  const runtime = factory();
  if (typeof module === 'object' && module.exports) module.exports = runtime;
  if (root && typeof root === 'object') root.dizychatBrowserNotifications = runtime;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const STORAGE_KEY = 'dizychat.desktopNotifications';
  const IO_DECORATOR_MARKER = Symbol.for('dizychat.browser.notifications.io-decorator');
  const SOCKET_DECORATOR_MARKER = Symbol.for('dizychat.browser.notifications.socket-decorator');

  const clean = (value) => String(value || '').trim();

  const isNative = (win = {}) => {
    try {
      return Boolean(win?.Capacitor?.isNativePlatform?.());
    } catch (_err) {
      return false;
    }
  };

  const readPreference = (win = {}) => {
    try {
      return win?.localStorage?.getItem?.(STORAGE_KEY) === 'on';
    } catch (_err) {
      return false;
    }
  };

  const writePreference = (win = {}, enabled) => {
    try {
      win?.localStorage?.setItem?.(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch (_err) {
      // Notification preference is best-effort local UI state.
    }
  };

  const plainText = (value) => clean(
    String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' '),
  );

  const createBrowserNotificationController = (win = {}) => {
    const NotificationApi = win?.Notification;
    const supported = !isNative(win) && typeof NotificationApi === 'function';
    const button = win?.document?.getElementById?.('toggle-desktop-notifications') || null;
    let enabled = supported && readPreference(win);

    const syncButton = () => {
      if (!button) return;
      button.hidden = !supported;
      if (!supported) return;

      const permission = NotificationApi.permission;
      const active = enabled && permission === 'granted';
      button.setAttribute?.('aria-pressed', active ? 'true' : 'false');

      if (permission === 'denied') {
        button.title = 'Desktop notifications blocked by browser';
        button.disabled = true;
      } else if (active) {
        button.title = 'Disable desktop notifications';
        button.disabled = false;
      } else {
        button.title = 'Enable desktop notifications';
        button.disabled = false;
      }

      const label = button.querySelector?.('.sr-only');
      if (label) label.textContent = active
        ? 'Disable desktop notifications'
        : 'Enable desktop notifications';
    };

    const setEnabled = (next) => {
      enabled = supported && Boolean(next);
      writePreference(win, enabled);
      syncButton();
      return enabled;
    };

    const toggle = async () => {
      if (!supported) return false;
      if (enabled && NotificationApi.permission === 'granted') {
        return setEnabled(false);
      }
      if (NotificationApi.permission === 'denied') {
        setEnabled(false);
        return false;
      }
      if (NotificationApi.permission !== 'granted') {
        const permission = await NotificationApi.requestPermission();
        if (permission !== 'granted') {
          setEnabled(false);
          return false;
        }
      }
      return setEnabled(true);
    };

    const isFocused = () => (
      win?.document?.visibilityState === 'visible'
      && win?.document?.hasFocus?.() === true
    );

    const isOwnMessage = (message = {}) => {
      const sender = clean(message.user);
      const currentUser = clean(win?.currentUser);
      if (!sender) return true;
      return Boolean(currentUser) && sender.toLowerCase() === currentUser.toLowerCase();
    };

    const show = (message = {}) => {
      if (!supported || !enabled || NotificationApi.permission !== 'granted') return null;
      if (isFocused() || isOwnMessage(message)) return null;

      const sender = clean(message.user);
      const room = clean(message.room || win?.currentRoom);
      const text = plainText(message.message);
      const title = room ? `DizyChat — ${room}` : 'DizyChat';
      const body = text ? `${sender}: ${text}` : `New message from ${sender}`;
      const notification = new NotificationApi(title, {
        body,
        icon: '/logo.svg',
        tag: room ? `dizychat:${room}` : 'dizychat',
      });

      notification.onclick = () => {
        try {
          win?.focus?.();
        } finally {
          notification.close?.();
        }
      };
      return notification;
    };

    if (supported && button?.addEventListener) {
      button.addEventListener('click', toggle);
    }
    syncButton();

    return Object.freeze({
      supported,
      show,
      toggle,
      isEnabled: () => enabled && NotificationApi?.permission === 'granted',
    });
  };

  const decorateSocket = (socket, controller) => {
    if (!socket || socket[SOCKET_DECORATOR_MARKER]) return socket;
    Object.defineProperty(socket, SOCKET_DECORATOR_MARKER, { value: true });
    socket.on?.('chat message', (message) => {
      controller.show(message);
    });
    return socket;
  };

  const decorateIoFactory = (win = {}, controller) => {
    if (!controller?.supported || typeof win.io !== 'function') return false;
    if (win.io[IO_DECORATOR_MARKER]) return true;

    const originalIo = win.io;
    const decoratedIo = function dizyBrowserNotificationAwareIo(...args) {
      return decorateSocket(originalIo(...args), controller);
    };
    Object.assign(decoratedIo, originalIo);
    Object.setPrototypeOf(decoratedIo, Object.getPrototypeOf(originalIo));
    Object.defineProperty(decoratedIo, IO_DECORATOR_MARKER, { value: true });
    win.io = decoratedIo;
    return true;
  };

  return Object.freeze({
    createBrowserNotificationController,
    decorateIoFactory,
  });
});
