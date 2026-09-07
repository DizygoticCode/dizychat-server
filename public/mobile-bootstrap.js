'use strict';

(async () => {
  const showBootstrapError = (error) => {
    const message = error?.message || String(error || 'Unable to start DizyChat.');
    let node = document.getElementById('dizychat-bootstrap-error');
    if (!node) {
      node = document.createElement('div');
      node.id = 'dizychat-bootstrap-error';
      node.setAttribute('role', 'alert');
      node.style.cssText = 'position:fixed;inset:16px;z-index:99999;padding:16px;border-radius:12px;background:#3b0d24;color:#fff;font:600 14px/1.4 system-ui,sans-serif;';
      document.body.appendChild(node);
    }
    node.textContent = `DizyChat could not connect: ${message}`;
  };

  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => resolve(src);
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

  try {
    const runtime = window.dizychatMobileRuntime;
    if (!runtime) throw new Error('Mobile runtime is unavailable.');
    const isNative = runtime.isNativeRuntime(window);
    const WebBundle = isNative ? window.Capacitor?.Plugins?.WebBundle : null;

    if (!isNative) {
      await loadScript('/iphone-install.js');
    }

    if (WebBundle?.syncAndActivate) {
      try {
        const updateResult = await WebBundle.syncAndActivate({
          backendUrl: window.dizychatConfig?.defaultNativeBackendUrl
        });
        if (updateResult?.reloading) return;
      } catch (error) {
        console.warn('[DizyChat] web bundle update check failed', error);
      }
    }

    const auth = window.dizychatAuthV2;
    if (typeof auth?.restoreNativeSession === 'function') {
      await auth.restoreNativeSession();
    }

    const backend = runtime.resolveBackendOrigin(window, window.dizychatConfig);
    runtime.installBackendFetchRouting(window, backend);
    runtime.installNativeMediaPermissions(window);
    runtime.installNativeMediaSourceRouting(window);

    if (backend) window.dizychatConfig.socketUrl = backend;
    if (isNative && !backend) throw new Error('Native backend is not configured.');

    const socketClientUrl = isNative
      ? `${backend}/socket.io/socket.io.js`
      : '/socket.io/socket.io.js';
    await loadScript(socketClientUrl);

    if (!isNative) {
      await loadScript('/browser-notifications.js');
      const browserNotificationRuntime = window.dizychatBrowserNotifications;
      if (browserNotificationRuntime?.createBrowserNotificationController) {
        const browserNotificationController = browserNotificationRuntime.createBrowserNotificationController(window);
        window.dizychatBrowserNotificationController = browserNotificationController;
        browserNotificationRuntime.decorateIoFactory(window, browserNotificationController);
      }
    }

    let pushController = null;
    if (isNative) {
      await loadScript('/mobile-push-runtime.js');
      const pushRuntime = window.dizychatMobilePushRuntime;
      if (pushRuntime?.createPushController) {
        pushController = pushRuntime.createPushController(window, {
          backendOrigin: backend,
          auth,
        });
        window.dizychatMobilePush = pushController;
        pushRuntime.decorateIoFactory(window, pushController);
      }
    }

    await loadScript('/chat.js');
    await loadScript('/public-auth-ui.js');
    if (pushController) await pushController.onChatReady();
    if (isNative && WebBundle?.markHealthy) await WebBundle.markHealthy();
  } catch (error) {
    console.error('[DizyChat] bootstrap failed', error);
    showBootstrapError(error);
  }
})();
