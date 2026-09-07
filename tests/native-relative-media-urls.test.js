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
    for (const source of ['/uploads/picture.png', '/soundboards/clip.mp3', '/emojis/custom/reaction.gif', '/newmessage.wav']) {
      const resolved = runtime.resolveMediaUrl(source, makeWindow(false, origin));
      assert.equal(resolved, source);
      assert.equal(new URL(resolved, origin).origin, origin);
    }
  }
});

for (const source of [
  '/uploads/picture.png?version=2#preview',
  '/uploads/voice.webm',
  '/uploads/movie.mp4',
  '/soundboards/board/clip%20one.mp3',
  '/emojis/custom/reaction.gif',
  '/newmessage.wav',
]) {
  test(`native media resolves ${source} using existing backend config`, () => {
    assert.equal(runtime.resolveMediaUrl(source, makeWindow(true)), backend + source);
  });
}

test('native media also recovers app-origin media URLs already resolved against Capacitor localhost', () => {
  const win = makeWindow(true);
  for (const source of [
    'https://localhost/uploads/picture.png?version=2#preview',
    'https://localhost/soundboards/clip.mp3',
    'https://localhost/emojis/custom/cat-potatoes.gif',
    'https://localhost/newmessage.wav',
  ]) {
    const parsed = new URL(source);
    assert.equal(
      runtime.resolveMediaUrl(source, win),
      `${backend}${parsed.pathname}${parsed.search}${parsed.hash}`,
    );
  }
});

test('native media uses the existing backend override and preserves missing-config fallback', () => {
  const win = makeWindow(true);
  win.dizychatConfig.backendUrlStorageKey = 'existing-backend-key';
  win.localStorage = { getItem(key) { assert.equal(key, 'existing-backend-key'); return 'https://override.example/'; } };
  assert.equal(runtime.resolveMediaUrl('/uploads/a.png', win), 'https://override.example/uploads/a.png');
  assert.equal(runtime.resolveMediaUrl('/emojis/custom/a.gif', win), 'https://override.example/emojis/custom/a.gif');
  assert.equal(runtime.resolveMediaUrl('/newmessage.wav', win), 'https://override.example/newmessage.wav');
  win.dizychatConfig = {};
  assert.equal(runtime.resolveMediaUrl('/uploads/a.png', win), '/uploads/a.png');
  assert.equal(runtime.resolveMediaUrl('/emojis/custom/a.gif', win), '/emojis/custom/a.gif');
  assert.equal(runtime.resolveMediaUrl('/newmessage.wav', win), '/newmessage.wav');
});

test('absolute external, blob, data and unrelated packaged sources are untouched', () => {
  for (const native of [false, true]) {
    for (const source of [backend + '/uploads/a.png', 'https://external.example/a.mp3',
      '//external.example/uploads/a.png', 'blob:https://localhost/id', 'data:image/png;base64,AAAA',
      '/logo.svg', '/vendor/socket.io.min.js', '/uploads-other/a.png', '/emojis.json', '', null]) {
      assert.equal(runtime.resolveMediaUrl(source, makeWindow(native)), source);
    }
  }
});

const defineSrcProperty = (Ctor) => {
  Object.defineProperty(Ctor.prototype, 'src', {
    configurable: true,
    enumerable: true,
    get() { return this._src || ''; },
    set(value) { this._src = value; },
  });
};

const makeDomRoutingWindow = (native) => {
  class FakeImage {}
  class FakeMedia {}
  defineSrcProperty(FakeImage);
  defineSrcProperty(FakeMedia);
  class FakeAudio extends FakeMedia {
    constructor(src) {
      super();
      if (src !== undefined) this.src = src;
    }
  }

  return Object.assign(makeWindow(native), {
    HTMLImageElement: FakeImage,
    HTMLMediaElement: FakeMedia,
    Audio: FakeAudio,
  });
};

test('browser DOM media source routing is not installed', () => {
  const win = makeDomRoutingWindow(false);
  const OriginalAudio = win.Audio;
  assert.equal(runtime.installNativeMediaSourceRouting(win), false);
  assert.equal(win.Audio, OriginalAudio);

  const img = new win.HTMLImageElement();
  img.src = '/emojis/custom/cat-potatoes.gif';
  assert.equal(img.src, '/emojis/custom/cat-potatoes.gif');

  const tone = new win.Audio('/newmessage.wav');
  assert.equal(tone.src, '/newmessage.wav');
});

test('native DOM media source routing fixes emoji images and notification audio at the shared boundary', () => {
  const win = makeDomRoutingWindow(true);
  assert.equal(runtime.installNativeMediaSourceRouting(win), true);

  const pickerImage = new win.HTMLImageElement();
  pickerImage.src = '/emojis/custom/cat-potatoes.gif';
  assert.equal(pickerImage.src, `${backend}/emojis/custom/cat-potatoes.gif`);

  const renderedImage = new win.HTMLImageElement();
  renderedImage.src = 'https://localhost/emojis/custom/reaction.gif';
  assert.equal(renderedImage.src, `${backend}/emojis/custom/reaction.gif`);

  const uploadedAudio = new win.HTMLMediaElement();
  uploadedAudio.src = '/uploads/voice.webm';
  assert.equal(uploadedAudio.src, `${backend}/uploads/voice.webm`);

  const soundboardAudio = new win.HTMLMediaElement();
  soundboardAudio.src = '/soundboards/clip.mp3';
  assert.equal(soundboardAudio.src, `${backend}/soundboards/clip.mp3`);

  const externalImage = new win.HTMLImageElement();
  externalImage.src = 'https://external.example/reaction.gif';
  assert.equal(externalImage.src, 'https://external.example/reaction.gif');

  const tone = new win.Audio('/newmessage.wav');
  assert.equal(tone.src, `${backend}/newmessage.wav`);

  assert.equal(runtime.installNativeMediaSourceRouting(win), true, 'installer is idempotent');
  const secondTone = new win.Audio('/newmessage.wav');
  assert.equal(secondTone.src, `${backend}/newmessage.wav`);
});

const bootstrap = fs.readFileSync(path.join(__dirname, '../public/mobile-bootstrap.js'), 'utf8');
test('native DOM media routing is installed before chat.js executes', () => {
  const installAt = bootstrap.indexOf('runtime.installNativeMediaSourceRouting(window);');
  const chatAt = bootstrap.indexOf("await loadScript('/chat.js');");
  assert.ok(installAt >= 0, 'mobile bootstrap must install DOM media routing');
  assert.ok(chatAt > installAt, 'DOM media routing must be active before chat.js creates emoji/audio elements');
});

// Exercise the existing production attachment/lightbox renderers, stubbing DOM mechanics only.
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
