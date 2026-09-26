'use strict';

// Fetch Open Graph and Rumble metadata only when a message is near the viewport.
// Bound outbound requests without relaxing the server's SSRF or abuse guards.
(function (scope) {
  const createLinkPreviewLoader = ({
    fetchImpl = typeof fetch === 'function' ? fetch : null,
    container = null,
    Observer = typeof IntersectionObserver === 'function' ? IntersectionObserver : null,
    DomObserver = typeof MutationObserver === 'function' ? MutationObserver : null,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    minGapMs = 2500,
    maxEntries = 128,
  } = {}) => {
    const cache = new Map();
    const queue = [];
    const visibility = new Map();
    let running = false;
    let lastStartedAt = null;

    const viewportObserver = Observer && container
      ? new Observer((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const waiting = visibility.get(entry.target);
          if (!waiting) continue;
          visibility.delete(entry.target);
          viewportObserver.unobserve(entry.target);
          waiting(true);
        }
      }, { root: container, rootMargin: '240px 0px' })
      : null;

    const pruneDetached = () => {
      for (const [target, resolve] of visibility) {
        if (target.isConnected) continue;
        viewportObserver.unobserve(target);
        visibility.delete(target);
        resolve(false);
      }
    };

    if (viewportObserver && DomObserver) {
      const cleanupObserver = new DomObserver(pruneDetached);
      cleanupObserver.observe(container, { childList: true });
    }

    const waitUntilNear = (target) => {
      if (!viewportObserver || !target) return Promise.resolve(true);
      if (!target.isConnected) return Promise.resolve(false);
      return new Promise((resolve) => {
        const existing = visibility.get(target);
        if (existing) {
          // Multiple URLs in one message share the same observer target.
          visibility.set(target, (visible) => { existing(visible); resolve(visible); });
          return;
        }
        visibility.set(target, resolve);
        viewportObserver.observe(target);
      });
    };

    const pacedFetch = async (url) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const delay = lastStartedAt === null
          ? 0 : Math.max(0, minGapMs - (now() - lastStartedAt));
        if (delay) await wait(delay);
        lastStartedAt = now();

        try {
          const response = await fetchImpl('/link-preview?url=' + encodeURIComponent(url));
          if (response?.status === 429) {
            if (attempt === 2) return null;
            const header = Number(response.headers?.get?.('Retry-After'));
            const seconds = Number.isFinite(header) && header > 0 ? header : 1;
            await wait(Math.max(1000, Math.min(90000, seconds * 1000)));
            continue;
          }
          if (!response?.ok) return null;
          const payload = await response.json();
          return payload && typeof payload === 'object' ? payload : null;
        } catch {
          return null;
        }
      }
      return null;
    };

    const pump = async () => {
      if (running) return;
      running = true;
      while (queue.length) {
        const { url, resolve } = queue.shift();
        const payload = await pacedFetch(url);
        if (!payload) cache.delete(url);
        resolve(payload);
      }
      running = false;
    };

    const request = async (url, target = null) => {
      if (!url || typeof fetchImpl !== 'function') return null;
      pruneDetached();
      if (!await waitUntilNear(target)) return null;
      if (target && !target.isConnected) return null;

      const previous = cache.get(url);
      if (previous) return previous;
      let settle;
      const pending = new Promise((resolve) => { settle = resolve; });
      cache.set(url, pending);
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      queue.push({ url, resolve: settle });
      void pump();
      return pending;
    };

    return { request };
  };

  const api = { createLinkPreviewLoader };
  if (scope) scope.dizychatLinkPreviewLoader = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : null);
