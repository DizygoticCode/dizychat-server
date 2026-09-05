'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('../public/mobile-runtime');
const backend = 'https://media-backend.example:8443';
const makeWindow = (native, origin = 'https://localhost') => ({
  Capacitor: { isNativePlatform: () => native },
  location: { origin, protocol: 'https:' },
  dizychatConfig: { defaultNativeBackendUrl: backend },
  dizychatMobileRuntime: runtime,
});

test('browser media keeps its relative value and current-origin resolution, including localhost', () => {
  for (const origin of ['https://web.example', 'https://localhost']) {
    for (const source of ['/uploads/picture.png', '/soundboards/clip.mp3']) {
      const resolved = runtime.resolveMediaUrl(source, makeWindow(false, origin));
      assert.equal(resolved, source);
      assert.equal(new URL(resolved, origin).origin, origin);
    }
  }
});

for (const source of ['/uploads/picture.png?version=2#preview', '/uploads/voice.webm', '/uploads/movie.mp4', '/soundboards/board/clip%20one.mp3']) {
  test(`native media resolves ${source} using existing backend config`, () => {
    assert.equal(runtime.resolveMediaUrl(source, makeWindow(true)), backend + source);
  });
}

test('native media uses the existing backend override and preserves missing-config fallback', () => {
  const win = makeWindow(true);
  win.dizychatConfig.backendUrlStorageKey = 'existing-backend-key';
  win.localStorage = { getItem(key) { assert.equal(key, 'existing-backend-key'); return 'https://override.example/'; } };
  assert.equal(runtime.resolveMediaUrl('/uploads/a.png', win), 'https://override.example/uploads/a.png');
  win.dizychatConfig = {};
  assert.equal(runtime.resolveMediaUrl('/uploads/a.png', win), '/uploads/a.png');
});

test('absolute, external, blob, data and unrelated packaged sources are untouched', () => {
  for (const native of [false, true]) {
    for (const source of [backend + '/uploads/a.png', 'https://external.example/a.mp3',
      '//external.example/uploads/a.png', 'blob:https://localhost/id', 'data:image/png;base64,AAAA',
      '/logo.svg', '/vendor/socket.io.min.js', '/uploads-other/a.png', '', null]) {
      assert.equal(runtime.resolveMediaUrl(source, makeWindow(native)), source);
    }
  }
});

// Exercise the production DOM renderers, stubbing DOM mechanics only.
const chat = fs.readFileSync(path.join(__dirname, '../public/chat.js'), 'utf8');
const section = (start, end) => {
  const from = chat.indexOf(start), to = chat.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return chat.slice(from, to);
};
function element(tag = 'div') {
  const selections = new Map();
  return { tag, children: [], dataset: {},
    set innerHTML(value) { this.children = []; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, addEventListener() {}, focus() {}, blur() {},
    appendChild(node) { this.children.push(node); },
    querySelector(selector) {
      if (!selections.has(selector)) selections.set(selector, element());
      return selections.get(selector);
    },
  };
}

for (const native of [false, true]) {
  test(`${native ? 'native' : 'browser'} inline attachments and lightbox assign the correct DOM media src`, () => {
    const body = element();
    const context = vm.createContext({ window: makeWindow(native),
      document: { body, createElement: element, addEventListener() {} }, requestAnimationFrame() {} });
    vm.runInContext(section('// ------------------- Media Lightbox', '// Hook some core socket events')
      + section('// ------------------- Inline Preview Helpers', 'function replaceCustomEmojiLinks')
      + '\nglobalThis.renderMedia = { createInlinePreview, MediaLightbox };', context);
    for (const [type, source] of [['image', '/uploads/a.png'], ['audio', '/uploads/a.webm'],
      ['video', '/uploads/a.mp4'], ['audio', '/soundboards/a.mp3'], ['image', 'https://external.example/a.png']]) {
      const expected = native && source.startsWith('/') ? backend + source : source;
      const preview = context.renderMedia.createInlinePreview(source, type, 'test');
      assert.equal(preview.children[0].children[0].src, expected);
      assert.equal(preview.dataset.src, source, 'message/duplicate-detection URL remains unchanged');
      context.renderMedia.MediaLightbox.open(type, source, 'test');
      assert.equal(body.children[0].querySelector('.media-content').children[0].src, expected);
    }
  });
}
