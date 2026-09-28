'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { MOBILE_WEB_CORE_PATHS } = require('../src/mobile-web/bundle-manifest');

const bootstrapSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'mobile-bootstrap.js'), 'utf8',
);

async function simulateBootstrap(native) {
  const scripts = [];
  const errors = [];
  const document = {
    createElement: () => ({}),
    getElementById: () => null,
    head: {
      appendChild: (script) => {
        scripts.push(script.src);
        script.onload?.();
      },
    },
    body: { appendChild: () => {} },
  };
  const runtime = {
    isNativeRuntime: () => native,
    resolveBackendOrigin: () => native ? 'https://dizychat.com' : '',
    installBackendFetchRouting: () => {},
    installNativeMediaPermissions: () => {},
    installNativeMediaSourceRouting: () => {},
  };
  const window = {
    dizychatMobileRuntime: runtime,
    dizychatConfig: { defaultNativeBackendUrl: 'https://dizychat.com' },
    Capacitor: native ? {
      Plugins: {
        WebBundle: {
          syncAndActivate: async () => ({ reloading: false }),
          markHealthy: async () => {},
        },
      },
    } : {},
  };

  vm.runInNewContext(bootstrapSource, {
    window,
    document,
    console: {
      warn: () => {},
      error: (...args) => errors.push(args),
    },
  }, { filename: 'mobile-bootstrap.js' });
  await new Promise((resolve) => setImmediate(resolve));
  return { scripts, errors };
}

test('native bootstrap does not request preview files absent from the signed APK allowlist', async () => {
  const { scripts, errors } = await simulateBootstrap(true);
  assert.equal(errors.length, 0, 'native startup must not enter the purple error path');
  assert.ok(scripts.includes('https://dizychat.com/socket.io/socket.io.js'));
  assert.ok(scripts.includes('/chat.js'));
  assert.ok(scripts.includes('/mobile-push-runtime.js'));
  assert.ok(!scripts.includes('/link-preview-loader.js'));
  assert.ok(!scripts.includes('/facebook-video-embed.js'));
  const core = new Set(MOBILE_WEB_CORE_PATHS);
  for (const script of scripts.filter((src) => src.startsWith('/'))) {
    assert.ok(core.has(script.slice(1)), `unbundled native asset ${script}`);
  }
});

test('browser bootstrap still loads both preview helpers before chat.js', async () => {
  const { scripts, errors } = await simulateBootstrap(false);
  assert.equal(errors.length, 0);
  const link = scripts.indexOf('/link-preview-loader.js');
  const facebook = scripts.indexOf('/facebook-video-embed.js');
  const chat = scripts.indexOf('/chat.js');
  assert.ok(link >= 0 && facebook > link && chat > facebook);
});
