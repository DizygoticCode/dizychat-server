'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { getFacebookVideoEmbedUrl } = require('../public/facebook-video-embed');
const root = path.resolve(__dirname, '..');

test('Facebook public video permalinks use official embedded video player', () => {
  for (const value of [
    'https://www.facebook.com/FacebookDevelopers/videos/10152454700553553/',
    'https://facebook.com/videos/123456789',
    'https://m.facebook.com/reel/123456789',
    'https://www.facebook.com/reels/123456789',
    'https://www.facebook.com/watch/?v=123456789',
    'https://www.facebook.com/video.php?v=123456789',
    'https://www.facebook.com/share/v/abc123',
    'https://www.facebook.com/share/r/abc123',
  ]) {
    const embedded = getFacebookVideoEmbedUrl(value);
    const parsed = new URL(embedded);
    assert.equal(parsed.origin, 'https://www.facebook.com');
    assert.equal(parsed.pathname, '/plugins/video.php');
    assert.equal(parsed.searchParams.get('href'), value);
    assert.equal(parsed.searchParams.get('show_text'), 'false');
    assert.equal(parsed.searchParams.get('autoplay'), 'false');
  }
});

test('ordinary Facebook content and lookalike domains never become video iframes', () => {
  for (const value of [
    'https://www.facebook.com/somebody/posts/12345',
    'https://www.facebook.com/groups/123456',
    'https://www.facebook.com/FacebookDevelopers',
    'https://www.facebook.com/watch/',
    'https://www.facebook.com/videos/',
    'https://www.facebook.com/share/p/123',
    'https://www.facebook.com.evil.example/reel/123',
    'https://attacker.example/facebook.com/reel/123',
    'https://www.facebook.com:8443/reel/123',
    'http://www.facebook.com/reel/123',
    'https://user:password@www.facebook.com/reel/123',
    'javascript:alert(1)',
  ]) {
    assert.equal(getFacebookVideoEmbedUrl(value), '', value);
  }
});

test('Facebook iframe is framed by CSP and keeps an original link as a fallback', () => {
  const server = fs.readFileSync(path.join(root, 'server-core.js'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(root, 'public/mobile-bootstrap.js'), 'utf8');
  const chat = fs.readFileSync(path.join(root, 'public/chat.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/chat.css'), 'utf8');

  assert.match(server, /const TRUSTED_FRAME_SOURCES = \[[\s\S]*?"https:\/\/www\.facebook\.com"/);
  assert.ok(bootstrap.indexOf("await loadScript('/facebook-video-embed.js')") >= 0);
  assert.ok(bootstrap.indexOf("await loadScript('/facebook-video-embed.js')") < bootstrap.indexOf("await loadScript('/chat.js')"));

  assert.match(chat, /facebookPlayerUrl = window\.dizychatFacebookVideo\?\.getFacebookVideoEmbedUrl\(link\)/);
  assert.match(chat, /el\.className = "embed-iframe facebook"/);
  assert.match(chat, /if \(!facebookPlayerUrl\) removeAnchorFor\(link\)/);
  assert.match(chat, /!window\.dizychatFacebookVideo\?\.getFacebookVideoEmbedUrl\(u\)/);
  assert.match(css, /\.embed-iframe\.youtube,\s*\.embed-iframe\.rumble,\s*\.embed-iframe\.facebook\s*\{/);
});
