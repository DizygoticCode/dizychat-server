(() => {
  'use strict';

  const status = document.getElementById('status');
  const retry = document.getElementById('retry');

  const setStatus = (message, retryable = false) => {
    if (status) status.textContent = message;
    if (retry) retry.hidden = !retryable;
  };

  const start = async () => {
    const backendUrl = String(window.dizychatConfig?.defaultNativeBackendUrl || '').trim();
    const WebBundle = window.Capacitor?.Plugins?.WebBundle;

    if (!/^https:\/\//i.test(backendUrl)) {
      setStatus('DizyChat has no trusted update server configured.', true);
      return;
    }
    if (!WebBundle || typeof WebBundle.syncAndActivate !== 'function') {
      setStatus('DizyChat updater is unavailable on this installation.', true);
      return;
    }

    setStatus('Checking for the latest verified app files…');
    try {
      const result = await WebBundle.syncAndActivate({ backendUrl });
      if (!result?.reloading) {
        setStatus('Verified app files are ready. Opening DizyChat…');
      }
    } catch (error) {
      console.error('[DizyChat] web bundle bootstrap failed', error);
      setStatus('Could not load the verified DizyChat files. Check your connection and Retry.', true);
    }
  };

  retry?.addEventListener('click', () => {
    retry.hidden = true;
    void start();
  });

  void start();
})();
