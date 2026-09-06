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

test('landing and login pages expose manifest and Apple standalone metadata', () => {
  for (const filename of ['index.html', 'login.html']) {
    const html = readPublic(filename);
    assert.match(html, /<link[^>]+rel=["']manifest["'][^>]+href=["']\/manifest\.webmanifest["']/i, `${filename} must link the web manifest`);
    assert.match(html, /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']\/logo\.png["']/i, `${filename} must expose the Home Screen icon`);
    assert.match(html, /<meta[^>]+name=["']apple-mobile-web-app-capable["'][^>]+content=["']yes["']/i, `${filename} must opt into Apple standalone mode`);
    assert.match(html, /<meta[^>]+name=["']apple-mobile-web-app-title["'][^>]+content=["']DizyChat["']/i, `${filename} must set the Apple web app title`);
    assert.match(html, /<meta[^>]+name=["']theme-color["'][^>]+content=["']#020617["']/i, `${filename} must declare the app theme color`);
  }
});

test('landing page provides an iPhone-only install guide hook without changing normal navigation', () => {
  const html = readPublic('index.html');
  assert.match(html, /id=["']iphone-install-button["'][^>]*hidden/i);
  assert.match(html, /id=["']iphone-install-guide["'][^>]*hidden/i);
  assert.match(html, /src=["']\/iphone-install\.js["']/i);
  assert.match(html, /window\.location\.href='\/login'/);
});

test('install helper offers guidance only on iOS outside standalone mode', () => {
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
