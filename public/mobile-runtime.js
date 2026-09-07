'use strict';

(function initMobileRuntime(root, factory) {
  const runtime = factory();
  if (typeof module === 'object' && module.exports) module.exports = runtime;
  if (root && typeof root === 'object') {
    root.dizychatMobileRuntime = runtime;
    if (runtime.isNativeRuntime(root)) {
      const backend = runtime.resolveBackendOrigin(root, root.dizychatConfig || {});
      runtime.installExternalLinkHandling(root, backend);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const FETCH_ROUTER_MARKER = Symbol.for('dizychat.mobile.fetch-router');
  const EXTERNAL_LINK_MARKER = Symbol.for('dizychat.mobile.external-links');
  const MEDIA_PERMISSION_MARKER = Symbol.for('dizychat.mobile.media-permissions');
  const MEDIA_SOURCE_ROUTER_MARKER = Symbol.for('dizychat.mobile.media-source-router');
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

  const isBackendMediaPath = (value) => {
    if (typeof value !== 'string') return false;
    const pathname = value.split(/[?#]/, 1)[0];
    return (
      /^\/(uploads|soundboards|emojis)\//.test(pathname)
      || pathname === '/newmessage.wav'
    );
  };

  const resolveMediaUrl = (value, win = {}) => {
    if (typeof value !== 'string') return value;

    // A normal browser on localhost must retain current-origin media URLs.
    try {
      if (!win.Capacitor?.isNativePlatform?.()) return value;
    } catch (_err) {
      return value;
    }

    const backend = resolveBackendOrigin(win, win.dizychatConfig || {});
    if (!backend) return value;

    if (isBackendMediaPath(value)) {
      return `${backend}${value}`;
    }

    // Some renderers may already have resolved a root-relative media path
    // against Capacitor's https://localhost pseudo-origin. Recover that path
    // before it reaches the DOM, while leaving real external URLs untouched.
    try {
      const parsed = new URL(value);
      const appOrigin = normaliseHttpOrigin(win?.location?.origin);
      if (
        appOrigin
        && parsed.origin === appOrigin
        && isBackendMediaPath(parsed.pathname)
      ) {
        return `${backend}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch (_err) {
      /* non-URL values remain unchanged */
    }

    return value;
  };

  const installNativeMediaSourceRouting = (win = {}) => {
    try {
      if (!win?.Capacitor?.isNativePlatform?.()) return false;
    } catch (_err) {
      return false;
    }
    if (win[MEDIA_SOURCE_ROUTER_MARKER]) return true;

    const patchSrcSetter = (Ctor) => {
      const prototype = Ctor?.prototype;
      if (!prototype) return false;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'src');
      if (!descriptor?.set || !descriptor?.get || descriptor.configurable === false) return false;

      Object.defineProperty(prototype, 'src', {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          return descriptor.set.call(this, resolveMediaUrl(value, win));
        },
      });
      return true;
    };

    patchSrcSetter(win.HTMLImageElement);
    patchSrcSetter(win.HTMLMediaElement);

    const NativeAudio = win.Audio;
    if (typeof NativeAudio === 'function' && !NativeAudio[MEDIA_SOURCE_ROUTER_MARKER]) {
      const RoutedAudio = function RoutedAudio(src) {
        if (arguments.length === 0) return new NativeAudio();
        return new NativeAudio(resolveMediaUrl(src, win));
      };
      RoutedAudio.prototype = NativeAudio.prototype;
      try {
        Object.setPrototypeOf(RoutedAudio, NativeAudio);
      } catch (_err) {
        /* static Audio properties are optional */
      }
      Object.defineProperty(RoutedAudio, MEDIA_SOURCE_ROUTER_MARKER, { value: true });
      win.Audio = RoutedAudio;
    }

    Object.defineProperty(win, MEDIA_SOURCE_ROUTER_MARKER, { value: true });
    return true;
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

  const requestedMediaPermissions = (constraints = {}) => {
    if (!constraints || typeof constraints !== 'object') return [];
    const permissions = [];
    if (constraints.audio) permissions.push('microphone');
    if (constraints.video) permissions.push('camera');
    return permissions;
  };

  const mediaPermissionError = (permissions, message = '') => {
    const labels = permissions.length ? permissions.join(' and ') : 'media';
    const error = new Error(message || `Android ${labels} permission was denied.`);
    error.name = 'NotAllowedError';
    return error;
  };

  const installNativeMediaPermissions = (win = {}) => {
    if (!isNativeRuntime(win)) return false;

    const mediaDevices = win?.navigator?.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return false;
    if (mediaDevices.getUserMedia[MEDIA_PERMISSION_MARKER]) return true;

    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    const routedGetUserMedia = async (constraints) => {
      const permissions = requestedMediaPermissions(constraints);
      if (permissions.length) {
        const plugin = win?.Capacitor?.Plugins?.NativePermissions;
        if (!plugin || typeof plugin.requestPermissions !== 'function') {
          throw mediaPermissionError(permissions, 'Android media permission bridge is unavailable.');
        }

        let states;
        try {
          states = await plugin.requestPermissions({ permissions });
        } catch (error) {
          const denied = mediaPermissionError(permissions);
          denied.cause = error;
          throw denied;
        }

        const denied = permissions.filter((alias) => String(states?.[alias] || '').toLowerCase() !== 'granted');
        if (denied.length) throw mediaPermissionError(denied);
      }

      return originalGetUserMedia(constraints);
    };

    Object.defineProperty(routedGetUserMedia, MEDIA_PERMISSION_MARKER, { value: true });
    mediaDevices.getUserMedia = routedGetUserMedia;
    return true;
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

  const installExternalLinkHandling = (win = {}, backendOrigin) => {
    if (!isNativeRuntime(win) || typeof win?.document?.addEventListener !== 'function') return false;
    if (win.document[EXTERNAL_LINK_MARKER]) return true;

    const plugin = win?.Capacitor?.Plugins?.MobileShell;
    if (!plugin || typeof plugin.openExternal !== 'function') return false;

    const backend = normaliseHttpOrigin(backendOrigin);
    const appOrigin = normaliseHttpOrigin(win?.location?.origin);
    const listener = (event = {}) => {
      if (event.defaultPrevented) return;
      if (typeof event.button === 'number' && event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target?.closest?.('a[href]');
      if (!anchor) return;

      const rawHref = typeof anchor.getAttribute === 'function'
        ? String(anchor.getAttribute('href') || '').trim()
        : '';
      if (rawHref && !/^[a-z][a-z0-9+.-]*:/i.test(rawHref) && !rawHref.startsWith('//')) return;

      const href = String(anchor.href || rawHref || '').trim();
      if (!shouldOpenExternally(href, backend)) return;

      if (appOrigin) {
        try {
          if (new URL(href).origin === appOrigin) return;
        } catch (_err) {
          return;
        }
      }

      event.preventDefault?.();
      Promise.resolve(plugin.openExternal({ url: href })).catch((error) => {
        win.console?.warn?.('[DizyChat] external link handoff failed', error);
      });
    };

    win.document.addEventListener('click', listener);
    Object.defineProperty(win.document, EXTERNAL_LINK_MARKER, { value: listener });
    return true;
  };

  const decideBackAction = ({ transientOpen = false, inChat = false } = {}) => {
    if (transientOpen) return 'close-transient';
    if (inChat) return 'leave-chat';
    return 'exit-app';
  };

  return Object.freeze({
    isNativeRuntime,
    resolveBackendOrigin,
    resolveMediaUrl,
    installNativeMediaSourceRouting,
    shouldRouteBackendRequest,
    resolveBackendUrl,
    installBackendFetchRouting,
    installNativeMediaPermissions,
    shouldOpenExternally,
    installExternalLinkHandling,
    decideBackAction,
  });
});
