'use strict';

(function initBrowserNotifications(root, factory) {
  const runtime = factory();
  if (typeof module === 'object' && module.exports) module.exports = runtime;
  if (root && typeof root === 'object') root.dizychatBrowserNotifications = runtime;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const STORAGE_KEY = 'dizychat.desktopNotifications';
  const IO_DECORATOR_MARKER = Symbol.for('dizychat.browser.notifications.io-decorator');
  const SOCKET_DECORATOR_MARKER = Symbol.for('dizychat.browser.notifications.socket-decorator');
  const PRESENCE_TTL_MS = 45_000;
  const PRESENCE_RENEW_MS = 30_000;

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

  const applicationServerKey = (value) => {
    const padded = clean(value).replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (clean(value).length % 4)) % 4);
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
      bytes[index] = raw.charCodeAt(index);
    }
    return bytes;
  };

  const createBrowserNotificationController = (win = {}) => {
    const NotificationApi = win?.Notification;
    const supported = !isNative(win) && typeof NotificationApi === 'function';
    const webPushSupported = supported
      && Boolean(win?.navigator?.serviceWorker)
      && typeof win?.PushManager !== 'undefined';
    const button = win?.document?.getElementById?.('toggle-desktop-notifications') || null;
    const auth = win?.dizychatAuthV2;
    let enabled = supported && readPreference(win);
    let subscription = null;
    let webPushActive = false;
    let joinedRoom = '';
    let presenceTimer = null;
    let registrationPromise = null;

    const readBearer = () => clean(auth?.readToken?.());

    const syncButton = () => {
      if (!button) return;
      button.hidden = !supported;
      if (!supported) return;

      const permission = NotificationApi.permission;
      const active = enabled && permission === 'granted';
      button.setAttribute?.('aria-pressed', active ? 'true' : 'false');

      if (permission === 'denied') {
        button.title = 'Notifications blocked by browser';
        button.disabled = true;
      } else if (active) {
        button.title = 'Disable notifications';
        button.disabled = false;
      } else {
        button.title = 'Enable notifications';
        button.disabled = false;
      }

      const label = button.querySelector?.('.sr-only');
      if (label) label.textContent = active
        ? 'Disable notifications'
        : 'Enable notifications';
    };

    const setEnabled = (next) => {
      enabled = supported && Boolean(next);
      writePreference(win, enabled);
      syncButton();
      return enabled;
    };

    const post = async (path, body) => {
      const bearer = readBearer();
      if (!bearer || typeof win?.fetch !== 'function') return null;
      const response = await win.fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body || {}),
      });
      if (!response?.ok) {
        const error = new Error(`DizyChat Web Push request failed (${response?.status || 'network'})`);
        error.status = response?.status;
        throw error;
      }
      try {
        return await response.json();
      } catch (_err) {
        return {};
      }
    };

    const stopPresenceTimer = () => {
      if (presenceTimer != null) win?.clearInterval?.(presenceTimer);
      presenceTimer = null;
    };

    const updatePresence = async () => {
      const endpoint = clean(subscription?.endpoint);
      if (!webPushActive || !endpoint || !readBearer()) return null;
      const interactive = win?.document?.visibilityState === 'visible'
        && win?.document?.hasFocus?.() === true;
      return post('/api/web-push/presence', interactive
        ? { endpoint, interactive: true, ttlMs: PRESENCE_TTL_MS }
        : { endpoint, interactive: false });
    };

    const startPresenceTimer = () => {
      stopPresenceTimer();
      presenceTimer = win?.setInterval?.(() => {
        void updatePresence().catch((error) => win?.console?.warn?.('[WebPush] presence update failed', error));
      }, PRESENCE_RENEW_MS);
    };

    const registerWithServer = async () => {
      if (!subscription || !readBearer()) return null;
      const json = subscription.toJSON?.() || subscription;
      const result = await post('/api/web-push/register', {
        subscription: json,
        deviceLabel: (
          win?.navigator?.standalone === true
          || win?.dizychatPwaRuntime?.isStandalone?.(win) === true
        ) ? 'iPhone Home Screen' : 'Web',
      });
      webPushActive = Boolean(result?.ok);
      if (webPushActive && joinedRoom) {
        await post('/api/web-push/room', {
          endpoint: subscription.endpoint,
          room: joinedRoom,
          subscribed: true,
        });
        await updatePresence();
        startPresenceTimer();
      }
      return result;
    };

    const ensureWebPushRegistration = async () => {
      if (!webPushSupported || !enabled || NotificationApi.permission !== 'granted' || !readBearer()) {
        return null;
      }
      if (registrationPromise) return registrationPromise;

      registrationPromise = (async () => {
        let serviceWorker = await win.navigator.serviceWorker.getRegistration?.('/');
        if (!serviceWorker) {
          serviceWorker = await win.navigator.serviceWorker.register('/dizychat-sw.js');
        }
        const ready = await win.navigator.serviceWorker.ready;
        const registration = ready || serviceWorker;
        let current = await registration.pushManager.getSubscription();

        if (!current) {
          const configResponse = await win.fetch('/api/web-push/config', {
            headers: { Accept: 'application/json' },
          });
          if (!configResponse?.ok) throw new Error('DizyChat Web Push configuration unavailable');
          const config = await configResponse.json();
          if (!config?.enabled || !clean(config?.publicKey)) {
            throw new Error('DizyChat Web Push is not enabled on the server');
          }
          current = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey(config.publicKey),
          });
        }

        subscription = current;
        await registerWithServer();
        return current;
      })();

      try {
        return await registrationPromise;
      } finally {
        registrationPromise = null;
      }
    };

    const disableWebPush = async () => {
      stopPresenceTimer();
      const endpoint = clean(subscription?.endpoint);
      if (endpoint && readBearer()) {
        try {
          await post('/api/web-push/unregister', { endpoint });
        } catch (error) {
          win?.console?.warn?.('[WebPush] server unregister failed', error);
        }
      }
      try {
        await subscription?.unsubscribe?.();
      } catch (_err) {
        // Browser subscription cleanup is best-effort after server disable.
      }
      subscription = null;
      webPushActive = false;
    };

    const toggle = async () => {
      if (!supported) return false;
      if (enabled && NotificationApi.permission === 'granted') {
        await disableWebPush();
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

      setEnabled(true);
      if (webPushSupported && readBearer()) {
        try {
          await ensureWebPushRegistration();
        } catch (error) {
          win?.console?.warn?.('[WebPush] registration failed', error);
        }
      }
      return true;
    };

    const syncRegistration = async () => {
      if (!enabled || NotificationApi.permission !== 'granted') return null;
      try {
        return await ensureWebPushRegistration();
      } catch (error) {
        win?.console?.warn?.('[WebPush] registration sync failed', error);
        return null;
      }
    };

    const onRoomJoined = async (room = '') => {
      joinedRoom = clean(room || win?.currentRoom);
      if (!joinedRoom || !enabled || NotificationApi.permission !== 'granted') return;
      await syncRegistration();
      if (!webPushActive || !subscription?.endpoint || !readBearer()) return;
      await post('/api/web-push/room', {
        endpoint: subscription.endpoint,
        room: joinedRoom,
        subscribed: true,
      });
      await updatePresence();
      startPresenceTimer();
    };

    const onRoomLeft = async (room = '') => {
      const leavingRoom = clean(room || joinedRoom);
      if (leavingRoom && webPushActive && subscription?.endpoint && readBearer()) {
        try {
          await post('/api/web-push/room', {
            endpoint: subscription.endpoint,
            room: leavingRoom,
            subscribed: false,
          });
        } catch (error) {
          win?.console?.warn?.('[WebPush] room unsubscribe failed', error);
        }
      }
      if (!room || leavingRoom === joinedRoom) joinedRoom = '';
      stopPresenceTimer();
    };

    const onLogout = async () => {
      stopPresenceTimer();
      const endpoint = clean(subscription?.endpoint);
      joinedRoom = '';
      webPushActive = false;
      if (!endpoint || !readBearer()) return;
      try {
        await post('/api/web-push/unregister', { endpoint });
      } catch (_err) {
        // Account logout remains authoritative even if Web Push cleanup races it.
      }
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
      if (webPushActive || isFocused() || isOwnMessage(message)) return null;

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

    const onChatReady = async () => {
      if (!supported) return;
      win?.document?.addEventListener?.('visibilitychange', () => {
        void updatePresence().catch((error) => win?.console?.warn?.('[WebPush] visibility presence update failed', error));
      });
      win?.addEventListener?.('focus', () => {
        void updatePresence().catch((error) => win?.console?.warn?.('[WebPush] focus presence update failed', error));
      });
      win?.addEventListener?.('blur', () => {
        void updatePresence().catch((error) => win?.console?.warn?.('[WebPush] blur presence update failed', error));
      });
      await syncRegistration();
    };

    if (supported && button?.addEventListener) {
      button.addEventListener('click', toggle);
    }
    syncButton();

    return Object.freeze({
      supported,
      webPushSupported,
      show,
      toggle,
      syncRegistration,
      onRoomJoined,
      onRoomLeft,
      onLogout,
      onChatReady,
      isEnabled: () => enabled && NotificationApi?.permission === 'granted',
      isWebPushActive: () => webPushActive,
    });
  };

  const decorateSocket = (socket, controller, win = {}) => {
    if (!socket || socket[SOCKET_DECORATOR_MARKER]) return socket;
    Object.defineProperty(socket, SOCKET_DECORATOR_MARKER, { value: true });
    const originalEmit = socket.emit.bind(socket);
    let pendingJoinRoom = '';

    socket.emit = function dizyBrowserNotificationAwareEmit(eventName, ...args) {
      if (eventName === 'join room' && args[0] && typeof args[0] === 'object') {
        pendingJoinRoom = clean(args[0].room);
      }
      if (eventName === 'leave room') {
        void controller.onRoomLeft?.(clean(args[0]?.room || win?.currentRoom));
      }
      if (eventName === 'account logout') {
        void controller.onLogout?.();
      }
      return originalEmit(eventName, ...args);
    };

    socket.on?.('chat message', (message) => {
      controller.show(message);
    });
    socket.on?.('connect', () => {
      void controller.syncRegistration?.();
    });
    socket.on?.('join room success', () => {
      void controller.onRoomJoined?.(pendingJoinRoom || win?.currentRoom);
    });
    return socket;
  };

  const decorateIoFactory = (win = {}, controller) => {
    if (!controller?.supported || typeof win.io !== 'function') return false;
    if (win.io[IO_DECORATOR_MARKER]) return true;

    const originalIo = win.io;
    const decoratedIo = function dizyBrowserNotificationAwareIo(...args) {
      return decorateSocket(originalIo(...args), controller, win);
    };
    Object.assign(decoratedIo, originalIo);
    Object.setPrototypeOf(decoratedIo, Object.getPrototypeOf(originalIo));
    Object.defineProperty(decoratedIo, IO_DECORATOR_MARKER, { value: true });
    win.io = decoratedIo;
    return true;
  };

  return Object.freeze({
    applicationServerKey,
    createBrowserNotificationController,
    decorateIoFactory,
  });
});
