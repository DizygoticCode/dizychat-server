'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  applyUploadResponseHeaders,
  isActiveUploadDocument,
} = require('../src/uploads/upload-response-security');

const repoRoot = path.resolve(__dirname, '..');

const makeResponse = () => {
  const headers = new Map();
  return {
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
  };
};

test('active uploaded documents are never rendered inline from the DizyChat origin', () => {
  for (const filename of [
    '/uploads/file-1.html',
    '/uploads/file-2.htm',
    '/uploads/file-3.xhtml',
    '/uploads/file-4.svg',
    '/uploads/file-5.svgz',
    '/uploads/file-6.xml',
    '/uploads/file-7.xsl',
    '/uploads/file-8.xslt',
    '/uploads/file-9.js',
    '/uploads/file-10.mjs',
    '/uploads/file-11.cjs',
  ]) {
    assert.equal(isActiveUploadDocument(filename), true, filename);
    const res = makeResponse();
    applyUploadResponseHeaders(res, filename);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.equal(res.headers.get('content-disposition'), 'attachment');
    assert.equal(res.headers.get('content-security-policy'), "sandbox; default-src 'none'");
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('ordinary image audio video and document uploads keep inline behavior', () => {
  for (const filename of [
    '/uploads/photo.jpg',
    '/uploads/photo.png',
    '/uploads/song.mp3',
    '/uploads/voice.webm',
    '/uploads/video.mp4',
    '/uploads/document.pdf',
    '/uploads/archive.zip',
  ]) {
    assert.equal(isActiveUploadDocument(filename), false, filename);
    const res = makeResponse();
    applyUploadResponseHeaders(res, filename);
    assert.equal(res.headers.get('content-disposition'), 'inline');
    assert.equal(res.headers.has('content-security-policy'), false);
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  }
});

test('server static upload route delegates response headers to the security helper', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const start = server.indexOf("app.use(\n  '/uploads'");
  const end = server.indexOf("app.use(express.static", start);
  assert.ok(start >= 0 && end > start);

  const uploadStatic = server.slice(start, end);
  assert.match(uploadStatic, /setHeaders: \(res, filePath\) => \{/);
  assert.match(uploadStatic, /applyUploadResponseHeaders\(res, filePath\)/);
  assert.doesNotMatch(uploadStatic, /Content-Disposition', 'inline'/);
});
