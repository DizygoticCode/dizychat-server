'use strict';

(function initMobileRuntime(root, factory) {
  const runtime = factory();
  if (typeof module === 'object' && module.exports) module.exports = runtime;
  if (root && typeof root === 'object') root.dizychatMobileRuntime = runtime;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const FETCH_ROUTER_MARKER = Symbol.for('dizychat.mobile.fetch-router');
  const trimTrailingSlash = (value) => String(value || '').trim().replace(/\/+$/, '');

  const isNativeRuntime = (win = {}) => {
    try {
      if (win?.Capacitor?.isNativePlatform?.()) return true;
    } catch (_err) {
      /* fall through to origin detection */
    }

    const origin = String(win?.location?.origin || '').trim().toLowerCase();
    const protocol = String(win?.location?.protocol || '').trim().toLowerCase();
    return (
      protocol === 'capacitor:'
      || protocol === 'file:'
      || origin === 'capacitor://localhost'
      || origin === 'file://'
      || origin === 'http://localhost'
      || origin === 'https://localhost'
    );
  };

  const normaliseHttpOrigin = (value) => {
    const raw = trimTrailingSlash(value);
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      parsed.username = '';
      parsed.password = '';
      parsed.pathname = '';
      parsed.search = '';
      parsed.hash = '';
      return trimTrailingSlash(parsed.origin);
    } catch (_err) {
      return '';
    }
  };

  const resolveBackendOrigin = (win = {}, config = {}) => {
    if (!isNativeRuntime(win)) return '';

    const storageKey = String(config.backendUrlStorageKey || '').trim();
    if (storageKey && win?.localStorage) {
      try {
        const override = normaliseHttpOrigin(win.localStorage.getItem(storageKey));
        if (override) return override;
      } catch (_err) {
        /* ignore inaccessible developer override storage */
      }
    }

    return normaliseHttpOrigin(config.defaultNativeBackendUrl);
  };

  const shouldRouteBackendRequest = (value) => {
    if (typeof value !== 'string') return false;
    const target = value.trim();
    if (!target.startsWith('/')) return false;
    const pathname = target.split(/[?#]/, 1)[0];
    return (
      pathname === '/upload'
      || pathname.startsWith('/api/')
      || pathname === '/tenor-proxy'
      || pathname === '/giphy-search'
      || pathname === '/soundboard-clips'
      || pathname === '/link-preview'
      || pathname === '/version'
    );
  };

  const resolveBackendUrl = (value, backendOrigin) => {
    if (typeof value !== 'string') return value;
    const target = value.trim();
    const origin = normaliseHttpOrigin(backendOrigin);
    if (!origin || !shouldRouteBackendRequest(target)) return value;
    return `${origin}${target}`;
  };

  const installBackendFetchRouting = (win = {}, backendOrigin) => {
    const origin = normaliseHttpOrigin(backendOrigin);
    if (!origin || typeof win.fetch !== 'function') return win.fetch;
    if (win.fetch[FETCH_ROUTER_MARKER]) return win.fetch;

    const originalFetch = win.fetch.bind(win);
    const routedFetch = (input, init) => {
      const routedInput = typeof input === 'string'
        ? resolveBackendUrl(input, origin)
        : input;
      return originalFetch(routedInput, init);
    };
    Object.defineProperty(routedFetch, FETCH_ROUTER_MARKER, { value: true });
    win.fetch = routedFetch;
    return routedFetch;
  };

  const shouldOpenExternally = (value, backendOrigin) => {
    if (typeof value !== 'string') return false;
    const target = value.trim();
    if (!/^https?:\/\//i.test(target)) return false;
    try {
      const parsed = new URL(target);
      const backend = normaliseHttpOrigin(backendOrigin);
      if (!backend) return true;
      return parsed.origin !== backend;
    } catch (_err) {
      return false;
    }
  };

  const decideBackAction = ({ transientOpen = false, inChat = false } = {}) => {
    if (transientOpen) return 'close-transient';
    if (inChat) return 'leave-chat';
    return 'exit-app';
  };

  return Object.freeze({
    isNativeRuntime,
    resolveBackendOrigin,
    shouldRouteBackendRequest,
    resolveBackendUrl,
    installBackendFetchRouting,
    shouldOpenExternally,
    decideBackAction,
  });
});
