'use strict';

(function attachPwaRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root) return;

  root.dizychatPwaRuntime = api;
  if (!root.document) return;

  const start = () => api.mount(root);
  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : null, function createPwaRuntimeApi() {
  const SW_URL = '/dizychat-sw.js';
  const UPDATE_CHECK_MS = 60 * 60 * 1000;
  const RESUME_RECONNECT_MS = 90 * 1000;

  const isNative = (win) => {
    try {
      return Boolean(win?.Capacitor?.isNativePlatform?.());
    } catch (_error) {
      return false;
    }
  };

  const isStandalone = (win) => {
    if (win?.navigator?.standalone === true) return true;
    try {
      return Boolean(win?.matchMedia?.('(display-mode: standalone)')?.matches);
    } catch (_error) {
      return false;
    }
  };

  const ensureStylesheet = (doc) => {
    if (!doc?.head || doc.querySelector('link[href="/pwa-runtime.css"]')) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/pwa-runtime.css';
    doc.head.appendChild(link);
  };

  const ensureBanner = (doc) => {
    let shell = doc?.getElementById?.('pwa-runtime-banner');
    if (shell) return shell;
    if (!doc?.body) return null;

    shell = doc.createElement('aside');
    shell.id = 'pwa-runtime-banner';
    shell.className = 'pwa-runtime-banner';
    shell.hidden = true;
    shell.setAttribute('role', 'status');
    shell.setAttribute('aria-live', 'polite');
    shell.innerHTML = `
      <span class="pwa-runtime-message"></span>
      <button class="pwa-runtime-action" type="button" hidden></button>
    `;
    doc.body.appendChild(shell);
    return shell;
  };

  const mount = (win) => {
    const doc = win?.document;
    if (!doc || isNative(win)) return null;

    ensureStylesheet(doc);
    const standalone = isStandalone(win);
    doc.body?.classList?.toggle?.('pwa-standalone', standalone);

    const state = {
      registration: null,
      waitingWorker: null,
      offline: win?.navigator?.onLine === false,
      reloadOnControllerChange: false,
      hiddenAt: doc.visibilityState === 'hidden' ? Date.now() : 0,
      updateTimer: null,
    };

    const banner = ensureBanner(doc);
    const message = banner?.querySelector?.('.pwa-runtime-message') || null;
    const action = banner?.querySelector?.('.pwa-runtime-action') || null;

    const renderBanner = () => {
      if (!banner || !message || !action) return;

      if (state.offline) {
        banner.hidden = false;
        banner.dataset.tone = 'offline';
        message.textContent = 'You’re offline — DizyChat will reconnect when the connection returns.';
        action.hidden = true;
        action.onclick = null;
        return;
      }

      if (state.waitingWorker) {
        banner.hidden = false;
        banner.dataset.tone = 'update';
        message.textContent = 'A new DizyChat version is ready.';
        action.hidden = false;
        action.textContent = 'Update';
        action.onclick = () => {
          state.reloadOnControllerChange = true;
          state.waitingWorker?.postMessage?.({ type: 'SKIP_WAITING' });
        };
        return;
      }

      banner.hidden = true;
      delete banner.dataset.tone;
      action.hidden = true;
      action.onclick = null;
    };

    const dispatchResume = (backgroundMs = 0, source = 'visibility') => {
      if (!standalone || typeof win.CustomEvent !== 'function') return;
      win.dispatchEvent?.(new win.CustomEvent('dizychat:pwa-resume', {
        detail: {
          standalone: true,
          backgroundMs: Math.max(0, Number(backgroundMs) || 0),
          reconnectRecommended: Number(backgroundMs) >= RESUME_RECONNECT_MS,
          source,
        },
      }));
    };

    const bindRegistration = (registration) => {
      if (!registration) return;
      state.registration = registration;

      if (registration.waiting && win.navigator?.serviceWorker?.controller) {
        state.waitingWorker = registration.waiting;
        renderBanner();
      }

      registration.addEventListener?.('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener?.('statechange', () => {
          if (
            installing.state === 'installed'
            && win.navigator?.serviceWorker?.controller
          ) {
            state.waitingWorker = registration.waiting || installing;
            renderBanner();
          }
        });
      });

      state.updateTimer = win.setInterval?.(() => {
        void registration.update?.().catch?.(() => {});
      }, UPDATE_CHECK_MS);
    };

    const register = async () => {
      if (!win.navigator?.serviceWorker?.register) return null;
      try {
        const registration = await win.navigator.serviceWorker.register(SW_URL, { scope: '/' });
        bindRegistration(registration);
        return registration;
      } catch (error) {
        win.console?.warn?.('[PWA] service worker registration failed', error);
        return null;
      }
    };

    win.navigator?.serviceWorker?.addEventListener?.('controllerchange', () => {
      if (!state.reloadOnControllerChange) return;
      state.reloadOnControllerChange = false;
      win.location?.reload?.();
    });

    win.addEventListener?.('offline', () => {
      state.offline = true;
      renderBanner();
    });

    win.addEventListener?.('online', () => {
      state.offline = false;
      renderBanner();
      void state.registration?.update?.().catch?.(() => {});
      dispatchResume(state.hiddenAt ? Date.now() - state.hiddenAt : 0, 'online');
    });

    doc.addEventListener?.('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') {
        state.hiddenAt = Date.now();
        return;
      }
      const backgroundMs = state.hiddenAt ? Date.now() - state.hiddenAt : 0;
      state.hiddenAt = 0;
      dispatchResume(backgroundMs, 'visibility');
      void state.registration?.update?.().catch?.(() => {});
    });

    win.addEventListener?.('pageshow', (event) => {
      if (event?.persisted) dispatchResume(RESUME_RECONNECT_MS, 'pageshow');
      void state.registration?.update?.().catch?.(() => {});
    });

    doc.addEventListener?.('click', (event) => {
      if (!standalone) return;
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor || anchor.hasAttribute?.('download')) return;
      if (String(anchor.target || '').toLowerCase() !== '_blank') return;
      try {
        const target = new URL(anchor.href, win.location?.href);
        if (target.origin !== win.location?.origin) return;
        event.preventDefault?.();
        win.location?.assign?.(target.href);
      } catch (_error) {
        // Leave malformed/external links to the browser.
      }
    }, true);

    renderBanner();
    void register();

    return {
      standalone,
      state,
      register,
      renderBanner,
      dispatchResume,
    };
  };

  return {
    isNative,
    isStandalone,
    mount,
    SW_URL,
    RESUME_RECONNECT_MS,
  };
});
