'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const multer = require('multer');

async function withUploadServer(fileSize, callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dizychat-multer-'));
  const storage = multer.diskStorage({
    destination(_req, _file, done) { done(null, dir); },
    filename(_req, file, done) { done(null, 'quarantine-' + path.basename(file.originalname) + '.upload'); },
  });
  const upload = multer({ storage, limits: { fileSize } }).single('file');
  const server = http.createServer((req, res) => {
    upload(req, res, (err) => {
      res.setHeader('Content-Type', 'application/json');
      if (err) {
        res.statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        res.end(JSON.stringify({ code: err.code || 'BAD_MULTIPART' }));
        return;
      }
      res.end(JSON.stringify({
        filename: req.file?.filename,
        bytes: req.file?.size,
        originalname: req.file?.originalname,
        voiceMessage: req.body?.voiceMessage,
      }));
    });
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    await callback({ url: 'http://127.0.0.1:' + server.address().port, dir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('Multer 2 normal multipart stays private until the antivirus promotion gate', async () => {
  await withUploadServer(1024, async ({ url, dir }) => {
    const form = new FormData();
    form.append('voiceMessage', '1');
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'test.txt');
    const response = await fetch(url, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.originalname, 'test.txt');
    assert.equal(result.bytes, 5);
    assert.equal(result.voiceMessage, '1');
    assert.ok(result.filename.endsWith('.upload'));
    assert.deepEqual(await fs.readdir(dir), [result.filename]);
  });
});

test('Multer 2 aborts oversized files before publishing any file', async () => {
  await withUploadServer(16, async ({ url, dir }) => {
    const form = new FormData();
    form.append('file', new Blob(['x'.repeat(200)]), 'oversized.bin');
    const response = await fetch(url, { method: 'POST', body: form });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, 'LIMIT_FILE_SIZE');
    assert.deepEqual(await fs.readdir(dir), []);
  });
});

test('Multer 2 rejects malformed multipart without crashing the server', async () => {
  await withUploadServer(1024, async ({ url, dir }) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: 'missing boundary',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await fs.readdir(dir), []);
  });
});
