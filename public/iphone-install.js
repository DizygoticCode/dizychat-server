'use strict';

(function attachIphoneInstall(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root) return;

  root.dizychatIphoneInstall = api;
  if (!root.document) return;

  const start = () => api.mountInstallGuide(root);
  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : null, function createIphoneInstallApi() {
  const isNative = (win) => {
    try {
      return Boolean(win?.Capacitor?.isNativePlatform?.());
    } catch (_error) {
      return false;
    }
  };

  const isIos = (win) => {
    const navigator = win?.navigator;
    if (!navigator) return false;

    const userAgent = String(navigator.userAgent || '');
    const platform = String(navigator.platform || '');
    return /iPad|iPhone|iPod/i.test(userAgent)
      || (platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  };

  const isStandalone = (win) => {
    if (win?.navigator?.standalone === true) return true;
    try {
      return Boolean(win?.matchMedia?.('(display-mode: standalone)')?.matches);
    } catch (_error) {
      return false;
    }
  };

  const shouldOfferInstall = (win) => isIos(win) && !isNative(win) && !isStandalone(win);

  const ensureLink = (doc, rel, href) => {
    if (doc.querySelector(`link[rel="${rel}"]`)) return;
    const link = doc.createElement('link');
    link.rel = rel;
    link.href = href;
    doc.head.appendChild(link);
  };

  const ensureMeta = (doc, name, content) => {
    let meta = doc.querySelector(`meta[name="${name}"]`);
    if (!meta) {
      meta = doc.createElement('meta');
      meta.name = name;
      doc.head.appendChild(meta);
    }
    meta.content = content;
  };

  const ensureMetadata = (doc) => {
    if (!doc?.head) return;
    ensureLink(doc, 'manifest', '/manifest.webmanifest');
    ensureLink(doc, 'apple-touch-icon', '/logo.png');
    ensureLink(doc, 'stylesheet', '/iphone-install.css');
    ensureMeta(doc, 'apple-mobile-web-app-capable', 'yes');
    ensureMeta(doc, 'apple-mobile-web-app-title', 'DizyChat');
    ensureMeta(doc, 'apple-mobile-web-app-status-bar-style', 'black-translucent');
    ensureMeta(doc, 'theme-color', '#020617');
  };

  const mountInstallGuide = (win) => {
    const doc = win?.document;
    if (!doc) return null;

    ensureMetadata(doc);
    if (!shouldOfferInstall(win)) return null;

    const existing = doc.getElementById('iphone-install-shell');
    if (existing) return existing;

    const shell = doc.createElement('aside');
    shell.id = 'iphone-install-shell';
    shell.className = 'iphone-install-shell';
    shell.setAttribute('aria-label', 'Install DizyChat on iPhone');
    shell.innerHTML = `
      <button id="iphone-install-button" class="iphone-install-button" type="button" aria-expanded="false" aria-controls="iphone-install-guide">
        📱 Install on iPhone
      </button>
      <section id="iphone-install-guide" class="iphone-install-guide" hidden aria-labelledby="iphone-install-title">
        <button id="iphone-install-close" class="iphone-install-close" type="button" aria-label="Close install instructions">×</button>
        <h2 id="iphone-install-title">Add DizyChat to your Home Screen</h2>
        <p class="iphone-install-intro">In Safari, it takes three taps:</p>
        <ol>
          <li><strong>Tap Share</strong> <span aria-hidden="true">⬆️</span> — the square with the up arrow.</li>
          <li><strong>Tap Add to Home Screen</strong>.</li>
          <li><strong>Tap Add</strong>. DizyChat will appear on your Home Screen like an app.</li>
        </ol>
      </section>`;

    doc.body.appendChild(shell);

    const button = shell.querySelector('#iphone-install-button');
    const guide = shell.querySelector('#iphone-install-guide');
    const close = shell.querySelector('#iphone-install-close');

    const openGuide = () => {
      guide.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      close.focus();
    };
    const closeGuide = () => {
      guide.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.focus();
    };

    button.addEventListener('click', openGuide);
    close.addEventListener('click', closeGuide);
    return shell;
  };

  return {
    isIos,
    isStandalone,
    shouldOfferInstall,
    ensureMetadata,
    mountInstallGuide,
  };
});
