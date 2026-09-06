const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..');
const publicDir = path.join(repoRoot, 'public');

function readPublic(name) {
  return fs.readFileSync(path.join(publicDir, name), 'utf8');
}

test('iPhone web app manifest launches DizyChat standalone at the login screen', () => {
  const manifestPath = path.join(publicDir, 'manifest.webmanifest');
  assert.equal(fs.existsSync(manifestPath), true, 'public/manifest.webmanifest must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.name, 'DizyChat');
  assert.equal(manifest.short_name, 'DizyChat');
  assert.equal(manifest.start_url, '/login.html');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons));
  assert.ok(manifest.icons.some((icon) => icon.src === '/logo.png' && icon.type === 'image/png'));
});

test('shared helper installs manifest and Apple standalone metadata', () => {
  const helperPath = path.join(publicDir, 'iphone-install.js');
  assert.equal(fs.existsSync(helperPath), true, 'public/iphone-install.js must exist');
  const helper = readPublic('iphone-install.js');

  assert.match(helper, /manifest\.webmanifest/);
  assert.match(helper, /apple-touch-icon/);
  assert.match(helper, /apple-mobile-web-app-capable/);
  assert.match(helper, /apple-mobile-web-app-title/);
  assert.match(helper, /theme-color/);
  assert.match(helper, /logo\.png/);
});

test('landing and login both load the same iPhone install helper', () => {
  const landing = readPublic('index.html');
  const bootstrap = readPublic('mobile-bootstrap.js');

  assert.match(landing, /src=["']\/iphone-install\.js["']/i, 'landing page must load the shared iPhone install helper');
  assert.match(bootstrap, /loadScript\(['"]\/iphone-install\.js['"]\)/, 'login bootstrap must load the shared iPhone install helper');
  assert.match(landing, /window\.location\.href='\/login'/, 'normal landing navigation must remain unchanged');
});

test('shared helper renders the idiot-proof install button and three Safari steps', () => {
  const helper = readPublic('iphone-install.js');
  assert.match(helper, /iphone-install-button/);
  assert.match(helper, /iphone-install-guide/);
  assert.match(helper, /Install on iPhone/i);
  assert.match(helper, /Tap Share/i);
  assert.match(helper, /Add to Home Screen/i);
  assert.match(helper, /Tap Add/i);
  assert.match(helper, /iphone-install\.css/);
});

test('install helper offers guidance only on iOS outside standalone/native mode', () => {
  const helperPath = path.join(publicDir, 'iphone-install.js');
  assert.equal(fs.existsSync(helperPath), true, 'public/iphone-install.js must exist');
  const { shouldOfferInstall } = require(helperPath);

  const iphoneSafari = {
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
      standalone: false,
    },
    matchMedia: () => ({ matches: false }),
  };
  assert.equal(shouldOfferInstall(iphoneSafari), true);

  const installed = {
    ...iphoneSafari,
    navigator: { ...iphoneSafari.navigator, standalone: true },
  };
  assert.equal(shouldOfferInstall(installed), false);

  const nativeIos = {
    ...iphoneSafari,
    Capacitor: { isNativePlatform: () => true },
  };
  assert.equal(shouldOfferInstall(nativeIos), false);

  const ipadDesktopMode = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'MacIntel',
      maxTouchPoints: 5,
      standalone: false,
    },
    matchMedia: () => ({ matches: false }),
  };
  assert.equal(shouldOfferInstall(ipadDesktopMode), true);

  const desktopSafari = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      standalone: false,
    },
    matchMedia: () => ({ matches: false }),
  };
  assert.equal(shouldOfferInstall(desktopSafari), false);
});
