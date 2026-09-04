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
    const auth = window.dizychatAuthV2;
    if (typeof auth?.restoreNativeSession === 'function') {
      await auth.restoreNativeSession();
    }

    const runtime = window.dizychatMobileRuntime;
    if (!runtime) throw new Error('Mobile runtime is unavailable.');

    const backend = runtime.resolveBackendOrigin(window, window.dizychatConfig);
    runtime.installBackendFetchRouting(window, backend);

    if (backend) window.dizychatConfig.socketUrl = backend;

    await loadScript('/vendor/socket.io.min.js');
    await loadScript('/chat.js');
  } catch (error) {
    console.error('[DizyChat] bootstrap failed', error);
    showBootstrapError(error);
  }
})();
