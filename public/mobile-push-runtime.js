'use strict';

(function initMobilePushRuntime(root, factory) {
  const runtime = factory();
  if (typeof module === 'object' && module.exports) module.exports = runtime;
  if (root && typeof root === 'object') root.dizychatMobilePushRuntime = runtime;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const IO_DECORATOR_MARKER = Symbol.for('dizychat.mobile.push.io-decorator');
  const SOCKET_DECORATOR_MARKER = Symbol.for('dizychat.mobile.push.socket-decorator');
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

  const createPushController = (win = {}, {
    backendOrigin = '',
    auth = win?.dizychatAuthV2,
    fetchImpl = win?.fetch?.bind?.(win),
    setIntervalImpl = win?.setInterval?.bind?.(win) || setInterval,
    clearIntervalImpl = win?.clearInterval?.bind?.(win) || clearInterval,
  } = {}) => {
    const plugin = win?.Capacitor?.Plugins?.DizyPush;
    const native = isNative(win) && Boolean(plugin);
    let registration = null;
    let configured = false;
    let listenersInstalled = false;
    let permissionRequestedThisRuntime = false;
    let presenceTimer = null;
    let joinedRoom = '';
    let pendingRoute = null;
    let reconcilePromise = null;

    const readBearer = () => clean(auth?.readToken?.());
    const endpoint = (path) => `${clean(backendOrigin).replace(/\/+$/, '')}${path}`;

    const post = async (path, body) => {
      const bearer = readBearer();
      if (!native || !bearer || typeof fetchImpl !== 'function') return null;
      const response = await fetchImpl(endpoint(path), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify(body || {}),
      });
      if (!response?.ok) {
        const error = new Error(`DizyChat push request failed (${response?.status || 'network'})`);
        error.status = response?.status;
        throw error;
      }
      try {
        return await response.json();
      } catch (_err) {
        return {};
      }
    };

    const get = async (path) => {
      const bearer = readBearer();
      if (!native || !bearer || typeof fetchImpl !== 'function') return null;
      const response = await fetchImpl(endpoint(path), {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearer}` },
      });
      if (!response?.ok) return null;
      try {
        return await response.json();
      } catch (_err) {
        return null;
      }
    };

    const configure = async () => {
      if (!native || configured) return native;
      const origin = clean(backendOrigin).replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(origin)) return false;
      await plugin.configure({ backendOrigin: origin });
      configured = true;
      return true;
    };

    const register = async (replacementToken = '') => {
      if (!native || !readBearer()) return null;
      await configure();
      let next = registration;
      if (!next?.deviceId || (!replacementToken && !next?.fcmToken)) {
        next = await plugin.getRegistration();
      }
      const deviceId = clean(next?.deviceId);
      const fcmToken = clean(replacementToken || next?.fcmToken || next?.notificationToken || next?.pushToken);
      if (!deviceId || !fcmToken) return null;
      registration = { deviceId, fcmToken };
      await post('/api/mobile/push/register', {
        deviceId,
        fcmToken,
        platform: 'android',
        deviceLabel: 'Android',
      });
      return registration;
    };

    const reconcileNotifications = async () => {
      if (!native || !readBearer()
          || typeof plugin?.listNotificationRooms !== 'function'
          || typeof plugin?.applyReadCursor !== 'function') return;
      if (reconcilePromise) return reconcilePromise;

      reconcilePromise = (async () => {
        try {
          await configure();
          const listed = await plugin.listNotificationRooms();
          for (const rawRoom of listed?.rooms || []) {
            const room = clean(rawRoom);
            if (!room) continue;
            try {
              const state = await get(`/api/read-state?room=${encodeURIComponent(room)}`);
              const cursor = state?.cursor;
              const messageId = clean(cursor?.messageId);
              const messageTimestamp = clean(cursor?.messageTimestamp);
              if (!messageId || !messageTimestamp) continue;
              await plugin.applyReadCursor({ room, messageId, messageTimestamp });
            } catch (error) {
              win.console?.warn?.('[DizyChat] notification reconciliation failed', { room, error });
            }
          }
        } catch (error) {
          win.console?.warn?.('[DizyChat] notification room listing failed', error);
        }
      })();

      try {
        await reconcilePromise;
      } finally {
        reconcilePromise = null;
      }
    };

    const isInteractive = async () => {
      if (!native || win?.document?.visibilityState !== 'visible') return false;
      try {
        const screen = await plugin.isScreenOn();
        return screen?.on === true;
      } catch (_err) {
        return false;
      }
    };

    const updatePresence = async () => {
      if (!native || !joinedRoom || !readBearer()) return null;
      const current = registration || await register();
      if (!current?.deviceId) return null;
      const interactive = await isInteractive();
      return post('/api/mobile/push/presence', interactive
        ? { deviceId: current.deviceId, interactive: true, ttlMs: PRESENCE_TTL_MS }
        : { deviceId: current.deviceId, interactive: false });
    };

    const stopPresenceTimer = () => {
      if (presenceTimer != null) clearIntervalImpl(presenceTimer);
      presenceTimer = null;
    };

    const startPresenceTimer = () => {
      stopPresenceTimer();
      presenceTimer = setIntervalImpl(() => {
        void updatePresence().catch((error) => win.console?.warn?.('[DizyChat] push presence renewal failed', error));
      }, PRESENCE_RENEW_MS);
    };

    const focusMessage = (messageId, attempts = 8) => {
      const id = clean(messageId);
      if (!id) return;
      const tryFocus = (remaining) => {
        if (typeof win.focusMessage === 'function') {
          const node = win.document?.querySelector?.(`.message[data-id="${id}"]`);
          if (node) {
            win.focusMessage(id);
            return;
          }
        }
        if (remaining > 0) win.setTimeout?.(() => tryFocus(remaining - 1), 250);
      };
      tryFocus(attempts);
    };

    const openRoute = (route = {}) => {
      const room = clean(route.room);
      const messageId = clean(route.messageId);
      if (!room) return false;
      pendingRoute = { room, messageId };
      if (clean(win.currentRoom) === room) {
        focusMessage(messageId);
        pendingRoute = null;
        return true;
      }
      if (readBearer() && typeof win.joinCurrentRoomAsAccount === 'function') {
        // Protected rooms still pass through normal admission; an empty password never bypasses it.
        win.joinCurrentRoomAsAccount(room, '');
        return true;
      }
      return false;
    };

    const onRoomJoined = async (room = '') => {
      joinedRoom = clean(room || win.currentRoom);
      if (!native || !joinedRoom) return;
      try {
        await register();
        if (!permissionRequestedThisRuntime) {
          permissionRequestedThisRuntime = true;
          await plugin.requestNotificationPermission();
        }
        await updatePresence();
        startPresenceTimer();
        await reconcileNotifications();
      } catch (error) {
        win.console?.warn?.('[DizyChat] native push activation failed', error);
      }
      if (pendingRoute && pendingRoute.room === joinedRoom) {
        focusMessage(pendingRoute.messageId);
        pendingRoute = null;
      }
    };

    const onLogout = async () => {
      stopPresenceTimer();
      const previousRoom = joinedRoom;
      joinedRoom = '';
      if (!native || !previousRoom || !registration?.deviceId || !readBearer()) return;
      try {
        await post('/api/mobile/push/presence', {
          deviceId: registration.deviceId,
          interactive: false,
        });
      } catch (_err) {
        // Server logout/revocation remains authoritative even if lease clearing races it.
      }
    };

    const installListeners = async () => {
      if (!native || listenersInstalled) return;
      listenersInstalled = true;
      win.document?.addEventListener?.('visibilitychange', () => {
        void updatePresence().catch((error) => win.console?.warn?.('[DizyChat] visibility presence update failed', error));
        if (win?.document?.visibilityState === 'visible') {
          void reconcileNotifications();
        }
      });
      if (typeof plugin.addListener === 'function') {
        await plugin.addListener('tokenChanged', (event = {}) => {
          const token = clean(event.fcmToken || event.notificationToken || event.pushToken);
          if (!token || !readBearer()) return;
          void register(token).catch((error) => win.console?.warn?.('[DizyChat] FCM token re-registration failed', error));
        });
        await plugin.addListener('notificationRoute', (route = {}) => {
          openRoute(route);
        });
      }
    };

    const onChatReady = async () => {
      if (!native) return;
      await configure();
      await installListeners();
      try {
        const route = await plugin.consumeLaunchRoute();
        if (route?.room) openRoute(route);
      } catch (error) {
        win.console?.warn?.('[DizyChat] launch notification route unavailable', error);
      }
      await reconcileNotifications();
    };

    return Object.freeze({
      native,
      configure,
      register,
      getDeviceId: () => clean(registration?.deviceId),
      updatePresence,
      reconcileNotifications,
      onRoomJoined,
      onLogout,
      openRoute,
      onChatReady,
    });
  };

  const decorateSocket = (socket, controller, win = {}) => {
    if (!socket || socket[SOCKET_DECORATOR_MARKER]) return socket;
    Object.defineProperty(socket, SOCKET_DECORATOR_MARKER, { value: true });
    const originalEmit = socket.emit.bind(socket);
    let pendingJoinRoom = '';

    socket.emit = function dizyPushAwareEmit(eventName, ...args) {
      if (eventName === 'join room' && args[0] && typeof args[0] === 'object') {
        const payload = { ...args[0] };
        pendingJoinRoom = clean(payload.room);
        const bearer = clean(win?.dizychatAuthV2?.readToken?.());
        if (controller.native && bearer) {
          void controller.register().then((registered) => {
            const deviceId = clean(registered?.deviceId || controller.getDeviceId());
            originalEmit(eventName, deviceId ? { ...payload, deviceId } : payload, ...args.slice(1));
          }).catch(() => {
            originalEmit(eventName, payload, ...args.slice(1));
          });
          return socket;
        }
      }
      if (eventName === 'account logout') {
        void controller.onLogout();
      }
      return originalEmit(eventName, ...args);
    };

    socket.on?.('connect', () => {
      void controller.reconcileNotifications?.();
    });
    socket.on?.('join room success', () => {
      void controller.onRoomJoined(pendingJoinRoom || win.currentRoom);
    });
    return socket;
  };

  const decorateIoFactory = (win = {}, controller) => {
    if (!controller?.native || typeof win.io !== 'function') return false;
    if (win.io[IO_DECORATOR_MARKER]) return true;
    const originalIo = win.io;
    const decoratedIo = function dizyPushAwareIo(...args) {
      return decorateSocket(originalIo(...args), controller, win);
    };
    Object.assign(decoratedIo, originalIo);
    Object.setPrototypeOf(decoratedIo, Object.getPrototypeOf(originalIo));
    Object.defineProperty(decoratedIo, IO_DECORATOR_MARKER, { value: true });
    win.io = decoratedIo;
    return true;
  };

  return Object.freeze({
    createPushController,
    decorateIoFactory,
  });
});
