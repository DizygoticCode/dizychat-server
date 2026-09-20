'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseBoardUrl,
  challengeDetected,
  extractBoard,
  createSoundboardImporter,
} = require('../src/soundboards/board-importer');

class FakeResponse {
  constructor({ url, body, status = 200, headers = {} }) {
    this.url = url;
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''));
    this._headers = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
    );
    if (!this._headers['content-length']) this._headers['content-length'] = String(this.body.length);
    this.headers = {
      get: (name) => this._headers[String(name || '').toLowerCase()] || null,
    };
  }

  async arrayBuffer() {
    return this.body.buffer.slice(
      this.body.byteOffset,
      this.body.byteOffset + this.body.byteLength,
    );
  }
}

test('soundboard importer accepts only HTTPS 101Soundboards board URLs', () => {
  const parsed = parseBoardUrl('https://101soundboards.com/boards/198489-Vine-Boom-Soundboard?junk=1');
  assert.equal(parsed.boardId, '198489-vine-boom-soundboard');
  assert.equal(parsed.url, 'https://www.101soundboards.com/boards/198489-vine-boom-soundboard');

  assert.throws(
    () => parseBoardUrl('https://example.com/boards/198489-vine-boom-soundboard'),
    /Only HTTPS 101Soundboards/,
  );
  assert.throws(
    () => parseBoardUrl('http://www.101soundboards.com/boards/198489-vine-boom-soundboard'),
    /Only HTTPS 101Soundboards/,
  );
  assert.throws(
    () => parseBoardUrl('https://www.101soundboards.com/sounds/24049510-boom-vine'),
    /\/boards\//,
  );
});

test('challenge pages stop cleanly instead of attempting anti-bot bypass', () => {
  assert.equal(challengeDetected('<div class="h-captcha">Verify you are human</div>'), true);
  assert.throws(
    () => extractBoard('<html><body><div class="h-captcha">Verify you are human</div></body></html>', 'https://www.101soundboards.com/boards/1-test'),
    (error) => error?.code === 'BROWSER_APPROVAL_REQUIRED',
  );
});

test('board import is additive: existing board items and index entries survive while new clips append', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dizychat-soundboard-import-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const dataRoot = path.join(root, 'data');
  const publicRoot = path.join(root, 'public');
  await fsp.mkdir(dataRoot, { recursive: true });
  await fsp.mkdir(path.join(publicRoot, '999-test-board'), { recursive: true });

  const existingItem = {
    id: '999-test-board-existing',
    title: 'Existing clip',
    tags: ['legacy'],
    duration: 2,
    file: '999-test-board/existing.mp3',
  };

  await fsp.writeFile(
    path.join(dataRoot, 'index.json'),
    JSON.stringify({ boards: ['legacy-board', '999-test-board'] }, null, 2),
  );
  await fsp.writeFile(
    path.join(dataRoot, '999-test-board.json'),
    JSON.stringify({
      id: '999-test-board',
      title: 'Existing board title',
      source: '101soundboards',
      items: [existingItem],
    }, null, 2),
  );
  await fsp.writeFile(path.join(publicRoot, '999-test-board', 'existing.mp3'), Buffer.from('OLD'));

  const boardUrl = 'https://www.101soundboards.com/boards/999-test-board';
  const newSoundUrl = 'https://www.101soundboards.com/sounds/101-new-clip';
  const audioUrl = 'https://www.101soundboards.com/media/101-new-clip.mp3';
  const responses = new Map([
    [boardUrl, new FakeResponse({
      url: boardUrl,
      body: `
        <html><body>
          <h1>Remote title should not erase local title</h1>
          <a href="/sounds/100-existing-clip">Existing clip</a>
          <a href="/sounds/101-new-clip">New clip</a>
        </body></html>
      `,
      headers: { 'content-type': 'text/html' },
    })],
    [newSoundUrl, new FakeResponse({
      url: newSoundUrl,
      body: `
        <html><head><meta property="og:title" content="New clip"></head>
        <body><h1>New clip</h1><audio src="/media/101-new-clip.mp3"></audio>Length 3 seconds</body></html>
      `,
      headers: { 'content-type': 'text/html' },
    })],
    [audioUrl, new FakeResponse({
      url: audioUrl,
      body: Buffer.from('NEW-AUDIO'),
      headers: { 'content-type': 'audio/mpeg' },
    })],
  ]);

  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const response = responses.get(url);
    if (!response) throw new Error(`Unexpected fetch: ${url}`);
    return response;
  };

  const importer = createSoundboardImporter({ fetchImpl, dataRoot, publicRoot });
  const result = await importer.importBoard({ boardUrl });

  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.totalItems, 2);
  assert.equal(requested.includes('https://www.101soundboards.com/sounds/100-existing-clip'), false);

  const index = JSON.parse(await fsp.readFile(path.join(dataRoot, 'index.json'), 'utf8'));
  assert.deepEqual(index.boards, ['legacy-board', '999-test-board']);

  const board = JSON.parse(await fsp.readFile(path.join(dataRoot, '999-test-board.json'), 'utf8'));
  assert.equal(board.title, 'Existing board title');
  assert.equal(board.items.length, 2);
  assert.deepEqual(board.items[0], existingItem);
  assert.equal(board.items[1].title, 'New clip');
  assert.equal(board.items[1].sourceUrl, newSoundUrl);

  assert.equal(
    (await fsp.readFile(path.join(publicRoot, '999-test-board', 'existing.mp3'))).toString(),
    'OLD',
  );
  assert.equal(
    (await fsp.readFile(path.join(publicRoot, '999-test-board', 'new-clip.mp3'))).toString(),
    'NEW-AUDIO',
  );
});

test('server and client keep board import owner-only and separate from normal soundboard search', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');

  assert.match(server, /app\.post\('\/api\/soundboards\/import'/);
  assert.match(server, /requireHttpAccount, requireHttpOwner/);
  assert.match(server, /req\.accountPrincipal\?\.role !== 'owner'/);
  assert.match(server, /soundboardStore\.reload\(\)/);

  assert.match(client, /data-role="soundboard-import" hidden/);
  assert.match(client, /accountState\.identity\?\.role === "owner"/);
  assert.match(client, /\/api\/soundboards\/import/);
  assert.match(client, /Authorization: `Bearer \$\{token\}`/);
  assert.match(client, /browser-approval-required/);
});
