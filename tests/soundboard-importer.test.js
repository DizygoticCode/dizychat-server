'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseBoardUrl,
  parseSoundPageUrl,
  challengeDetected,
  extractBoard,
  extractSearchBoards,
  createSoundboardImporter,
} = require('../src/soundboards/board-importer');
const {
  FILTER_CHAIN,
  buildSoundboardFfmpegArgs,
} = require('../src/soundboards/audio-normalizer');

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

test('live 101Soundboards helpers keep search and clip URLs inside the allowed host boundary', () => {
  const clip = parseSoundPageUrl('https://101soundboards.com/sounds/123-test-clip?junk=1');
  assert.equal(clip.url, 'https://www.101soundboards.com/sounds/123-test-clip');

  assert.throws(
    () => parseSoundPageUrl('https://example.com/sounds/123-test-clip'),
    /Only HTTPS 101Soundboards/,
  );

  const boards = extractSearchBoards(`
    <a href="/boards/100-first-board">First Board</a>
    <a href="https://www.101soundboards.com/boards/200-second-board">Second Board</a>
    <a href="/boards/100-first-board">First Board duplicate</a>
    <a href="/sounds/999-not-a-board">Not a board</a>
    <a href="https://example.com/boards/300-blocked">Blocked</a>
  `, 'https://www.101soundboards.com/search/test');

  assert.deepEqual(boards, [
    {
      provider: '101soundboards',
      boardId: '100-first-board',
      title: 'First Board',
      url: 'https://www.101soundboards.com/boards/100-first-board',
    },
    {
      provider: '101soundboards',
      boardId: '200-second-board',
      title: 'Second Board',
      url: 'https://www.101soundboards.com/boards/200-second-board',
    },
  ]);
});

test('live 101Soundboards search ignores unrelated promotional board links and ranks query matches', () => {
  const boards = extractSearchBoards(`
    <a href="/boards/900-create-a-new-soundboard">Create a new soundboard</a>
    <a href="/boards/901-clone-my-voice">Clone My Voice</a>
    <a href="/boards/902-free-song-maker">Free song maker</a>
    <a href="/boards/10716-arnold-schwarzenegger-soundboard">Arnold Schwarzenegger Soundboard</a>
    <a href="/boards/20732-arnold-schwarzenegger-original-soundboard">Arnold Schwarzenegger Original Soundboard</a>
    <a href="/boards/10416-arnold-schwarzenegger-soundboard-the-running-man">Arnold Schwarzenegger Soundboard: The Running Man</a>
  `, 'https://www.101soundboards.com/search/arnold', 'arnold');

  assert.deepEqual(
    boards.map((board) => board.boardId),
    [
      '10716-arnold-schwarzenegger-soundboard',
      '20732-arnold-schwarzenegger-original-soundboard',
      '10416-arnold-schwarzenegger-soundboard-the-running-man',
    ],
  );
  assert.equal(boards.some((board) => /create-a-new|clone-my-voice|free-song-maker/.test(board.boardId)), false);
});

test('live search keeps site-ranked non-exact board results while suppressing promotional boards', () => {
  const boards = extractSearchBoards(`
    <a href="/boards/900-create-a-new-soundboard">Create a new soundboard</a>
    <a href="/boards/901-clone-my-voice">Clone My Voice</a>
    <a href="/boards/100-exact-match"><img alt="Terminator Soundboard"></a>
    <a href="/boards/101-related-action-movie"><img alt="Classic Action Movie Quotes"></a>
    <a href="/boards/102-no-text"></a>
  `, 'https://www.101soundboards.com/search/terminator', 'terminator');

  assert.deepEqual(boards.map((board) => board.boardId), [
    '100-exact-match',
    '101-related-action-movie',
    '102-no-text',
  ]);
  assert.equal(boards[0].title, 'Terminator Soundboard');
  assert.equal(boards[2].title, 'No Text');
});

test('live source browser can search, browse, preview, and import only one selected clip', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dizychat-live-soundboard-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const dataRoot = path.join(root, 'data');
  const publicRoot = path.join(root, 'public');
  await fsp.mkdir(dataRoot, { recursive: true });

  const searchUrl = 'https://www.101soundboards.com/search/duke';
  const boardUrl = 'https://www.101soundboards.com/boards/321-duke-board';
  const firstSoundUrl = 'https://www.101soundboards.com/sounds/901-first-clip';
  const secondSoundUrl = 'https://www.101soundboards.com/sounds/902-second-clip';
  const firstAudioUrl = 'https://www.101soundboards.com/media/first.mp3';
  const responses = new Map([
    [searchUrl, new FakeResponse({
      url: searchUrl,
      body: '<a href="/boards/321-duke-board">Duke Board</a>',
      headers: { 'content-type': 'text/html' },
    })],
    [boardUrl, new FakeResponse({
      url: boardUrl,
      body: '<h1>Duke Board</h1><a href="/sounds/901-first-clip">First clip</a><a href="/sounds/902-second-clip">Second clip</a>',
      headers: { 'content-type': 'text/html' },
    })],
    [firstSoundUrl, new FakeResponse({
      url: firstSoundUrl,
      body: '<h1>First clip</h1><audio src="/media/first.mp3"></audio>Length 2 seconds',
      headers: { 'content-type': 'text/html' },
    })],
    [firstAudioUrl, new FakeResponse({
      url: firstAudioUrl,
      body: Buffer.from('FIRST-AUDIO'),
      headers: { 'content-type': 'audio/mpeg' },
    })],
  ]);

  const requested = [];
  const importer = createSoundboardImporter({
    fetchImpl: async (url) => {
      requested.push(url);
      const response = responses.get(url);
      if (!response) throw new Error(`Unexpected fetch: ${url}`);
      return response;
    },
    dataRoot,
    publicRoot,
    normalizeAudioImpl: async ({ sourceBuffer, targetPath }) => {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.writeFile(targetPath, Buffer.concat([Buffer.from('NORMALIZED:'), sourceBuffer]));
      return { path: targetPath, mimeType: 'audio/mp4', extension: 'm4a' };
    },
  });

  const search = await importer.searchBoards({ query: 'duke' });
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].url, boardUrl);

  const board = await importer.browseBoard({ boardUrl });
  assert.equal(board.title, 'Duke Board');
  assert.equal(board.clips.length, 2);
  assert.equal(board.clips[0].soundPageUrl, firstSoundUrl);

  const preview = await importer.resolveClip({ soundPageUrl: firstSoundUrl });
  assert.equal(preview.title, 'First clip');
  assert.equal(preview.audioUrl, firstAudioUrl);

  requested.length = 0;
  const imported = await importer.importBoard({
    boardUrl,
    onlySoundPageUrl: firstSoundUrl,
  });
  assert.equal(imported.imported, 1);
  assert.equal(imported.processed, 1);
  assert.equal(requested.includes(secondSoundUrl), false);

  const saved = JSON.parse(await fsp.readFile(path.join(dataRoot, '321-duke-board.json'), 'utf8'));
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].title, 'First clip');
  assert.equal(saved.items[0].sourceUrl, firstSoundUrl);
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

  const normalizeCalls = [];
  const normalizeAudioImpl = async ({ sourceBuffer, targetPath }) => {
    normalizeCalls.push({ sourceBuffer: Buffer.from(sourceBuffer), targetPath });
    await fsp.writeFile(targetPath, Buffer.concat([Buffer.from('CLEAN:'), sourceBuffer]));
    return { path: targetPath, size: sourceBuffer.length + 6, mimeType: 'audio/mp4', extension: 'm4a' };
  };

  const importer = createSoundboardImporter({ fetchImpl, dataRoot, publicRoot, normalizeAudioImpl });
  const result = await importer.importBoard({ boardUrl });

  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.replaced, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.totalItems, 2);
  assert.equal(normalizeCalls.length, 1);
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
  const newFile = path.basename(board.items[1].file);
  assert.match(newFile, /^new-clip-[0-9a-f]{10}\.m4a$/);
  assert.equal(
    (await fsp.readFile(path.join(publicRoot, '999-test-board', newFile))).toString(),
    'CLEAN:NEW-AUDIO',
  );
});

test('rebuild mode replaces a legacy clip only after normalized output succeeds', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dizychat-soundboard-rebuild-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const dataRoot = path.join(root, 'data');
  const publicRoot = path.join(root, 'public');
  const boardDir = path.join(publicRoot, '777-old-board');
  await fsp.mkdir(dataRoot, { recursive: true });
  await fsp.mkdir(boardDir, { recursive: true });

  await fsp.writeFile(path.join(dataRoot, 'index.json'), JSON.stringify({ boards: ['777-old-board'] }));
  await fsp.writeFile(path.join(dataRoot, '777-old-board.json'), JSON.stringify({
    id: '777-old-board',
    title: 'Old board',
    source: '101soundboards',
    items: [{
      id: 'legacy-id',
      title: 'Legacy Clip',
      tags: ['old'],
      duration: 1,
      file: '777-old-board/legacy-clip.mp3',
    }],
  }));
  await fsp.writeFile(path.join(boardDir, 'legacy-clip.mp3'), Buffer.from('LEGACY'));

  const boardUrl = 'https://www.101soundboards.com/boards/777-old-board';
  const soundUrl = 'https://www.101soundboards.com/sounds/501-legacy-clip';
  const audioUrl = 'https://www.101soundboards.com/media/legacy-clean.mp3';
  const responses = new Map([
    [boardUrl, new FakeResponse({
      url: boardUrl,
      body: '<h1>Old board</h1><a href="/sounds/501-legacy-clip">Legacy Clip</a>',
      headers: { 'content-type': 'text/html' },
    })],
    [soundUrl, new FakeResponse({
      url: soundUrl,
      body: '<h1>Legacy Clip</h1><audio src="/media/legacy-clean.mp3"></audio>Length 2 seconds',
      headers: { 'content-type': 'text/html' },
    })],
    [audioUrl, new FakeResponse({
      url: audioUrl,
      body: Buffer.from('SOURCE-CLEAN'),
      headers: { 'content-type': 'audio/mpeg' },
    })],
  ]);

  const importer = createSoundboardImporter({
    fetchImpl: async (url) => {
      const response = responses.get(url);
      if (!response) throw new Error(`Unexpected fetch: ${url}`);
      return response;
    },
    dataRoot,
    publicRoot,
    normalizeAudioImpl: async ({ sourceBuffer, targetPath }) => {
      await fsp.writeFile(targetPath, Buffer.concat([Buffer.from('NORMALIZED:'), sourceBuffer]));
      return { path: targetPath, size: sourceBuffer.length + 11, mimeType: 'audio/mp4', extension: 'm4a' };
    },
  });

  const result = await importer.importBoard({ boardUrl, replaceExisting: true });
  assert.equal(result.imported, 0);
  assert.equal(result.replaced, 1);
  assert.equal(result.failed, 0);

  const board = JSON.parse(await fsp.readFile(path.join(dataRoot, '777-old-board.json'), 'utf8'));
  assert.equal(board.items.length, 1);
  assert.equal(board.items[0].id, 'legacy-id');
  assert.equal(board.items[0].title, 'Legacy Clip');
  assert.equal(board.items[0].normalized, true);
  assert.match(board.items[0].file, /^777-old-board\/legacy-clip-[0-9a-f]{10}\.m4a$/);
  assert.equal(fs.existsSync(path.join(boardDir, 'legacy-clip.mp3')), false);
  assert.equal(
    (await fsp.readFile(path.join(publicRoot, board.items[0].file))).toString(),
    'NORMALIZED:SOURCE-CLEAN',
  );
});

test('failed normalization never removes the working legacy clip or rewrites its catalog entry', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dizychat-soundboard-fail-safe-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const dataRoot = path.join(root, 'data');
  const publicRoot = path.join(root, 'public');
  const boardDir = path.join(publicRoot, '888-safe-board');
  await fsp.mkdir(dataRoot, { recursive: true });
  await fsp.mkdir(boardDir, { recursive: true });

  const legacy = {
    id: 'legacy-safe',
    title: 'Safe Clip',
    tags: [],
    duration: 1,
    file: '888-safe-board/safe.mp3',
  };
  await fsp.writeFile(path.join(dataRoot, 'index.json'), JSON.stringify({ boards: ['888-safe-board'] }));
  await fsp.writeFile(path.join(dataRoot, '888-safe-board.json'), JSON.stringify({
    id: '888-safe-board',
    title: 'Safe board',
    source: '101soundboards',
    items: [legacy],
  }));
  await fsp.writeFile(path.join(boardDir, 'safe.mp3'), Buffer.from('KEEP-ME'));

  const boardUrl = 'https://www.101soundboards.com/boards/888-safe-board';
  const soundUrl = 'https://www.101soundboards.com/sounds/601-safe-clip';
  const audioUrl = 'https://www.101soundboards.com/media/safe.mp3';
  const responses = new Map([
    [boardUrl, new FakeResponse({ url: boardUrl, body: '<h1>Safe board</h1><a href="/sounds/601-safe-clip">Safe Clip</a>' })],
    [soundUrl, new FakeResponse({ url: soundUrl, body: '<h1>Safe Clip</h1><audio src="/media/safe.mp3"></audio>' })],
    [audioUrl, new FakeResponse({ url: audioUrl, body: Buffer.from('BROKEN-SOURCE'), headers: { 'content-type': 'audio/mpeg' } })],
  ]);

  const importer = createSoundboardImporter({
    fetchImpl: async (url) => {
      const response = responses.get(url);
      if (!response) throw new Error(`Unexpected fetch: ${url}`);
      return response;
    },
    dataRoot,
    publicRoot,
    normalizeAudioImpl: async () => {
      throw new Error('ffmpeg failed');
    },
  });

  const result = await importer.importBoard({ boardUrl, replaceExisting: true });
  assert.equal(result.replaced, 0);
  assert.equal(result.failed, 1);

  const board = JSON.parse(await fsp.readFile(path.join(dataRoot, '888-safe-board.json'), 'utf8'));
  assert.deepEqual(board.items, [legacy]);
  assert.equal((await fsp.readFile(path.join(boardDir, 'safe.mp3'))).toString(), 'KEEP-ME');
});

test('soundboard FFmpeg recipe trims only edge silence and normalizes level consistently', () => {
  assert.match(FILTER_CHAIN, /silenceremove=start_periods=1/);
  assert.match(FILTER_CHAIN, /areverse/);
  assert.match(FILTER_CHAIN, /loudnorm=I=-16:TP=-1\.5:LRA=7/);

  const args = buildSoundboardFfmpegArgs('/tmp/in.audio', '/tmp/out.m4a');
  assert.deepEqual(args.slice(-9), [
    '-ar', '48000',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '/tmp/out.m4a',
  ]);
  assert.ok(args.includes('-af'));
  assert.ok(args.includes(FILTER_CHAIN));
});

test('server and client keep board import owner-only and separate from normal soundboard search', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');

  assert.match(server, /app\.post\('\/api\/soundboards\/import'/);
  assert.match(server, /app\.post\('\/api\/soundboards\/rebuild-existing'/);
  assert.match(server, /app\.post\('\/api\/soundboards\/import-clip'/);
  assert.match(server, /app\.get\('\/api\/soundboards\/live-search'/);
  assert.match(server, /app\.get\('\/api\/soundboards\/live-board'/);
  assert.match(server, /app\.get\('\/api\/soundboards\/live-clip'/);
  assert.match(server, /replaceExisting:\s*true/);
  assert.match(server, /requireHttpAccount, requireHttpOwner/);
  assert.match(server, /req\.accountPrincipal\?\.role !== 'owner'/);
  assert.match(server, /soundboardStore\.reload\(\)/);

  assert.match(client, /data-role="soundboard-import" hidden/);
  assert.match(client, /accountState\.identity\?\.role === "owner"/);
  assert.match(client, /\/api\/soundboards\/import/);
  assert.match(client, /\/api\/soundboards\/rebuild-existing/);
  assert.match(client, /Rebuild current 101 boards/);
  assert.match(client, /data-soundboard-mode="web"/);
  assert.match(client, /Search 101Soundboards/);
  assert.match(client, /\/api\/soundboards\/live-search/);
  assert.match(client, /\/api\/soundboards\/live-board/);
  assert.match(client, /\/api\/soundboards\/live-clip/);
  assert.match(client, /\/api\/soundboards\/import-clip/);
  assert.match(client, /progress\.phase === "rebuild"/);
  assert.match(client, /Authorization: `Bearer \$\{token\}`/);
  assert.match(client, /browser-approval-required/);
});


test('soundboard picker stays constrained above the composer when owner controls are visible', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'chat.css'), 'utf8');
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');

  assert.match(
    css,
    /#soundboard-picker\s*\{[^}]*display:\s*none;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    css,
    /#soundboard-picker \.soundboard-results\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s,
  );
  assert.match(client, /const availableHeight = Math\.max\(120, rect\.top - 20\);/);
  assert.match(client, /panel\.style\.maxHeight = `\$\{Math\.min\(320, availableHeight\)\}px`;/);
  assert.match(client, /panel\.style\.display = "flex";/);
});
