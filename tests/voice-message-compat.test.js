'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const helperPath = 'src/uploads/voice-message-normalizer.js';
const normalizer = require(path.join(root, helperPath));

const withTempDirs = async (fn) => {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dizychat-voice-'));
  const quarantine = path.join(base, 'quarantine');
  const uploads = path.join(base, 'uploads');
  await fs.promises.mkdir(quarantine);
  await fs.promises.mkdir(uploads);
  try {
    await fn({ quarantine, uploads });
  } finally {
    await fs.promises.rm(base, { recursive: true, force: true });
  }
};

test('voice recorder prefers old-iPhone-compatible MP4/AAC before WebM or Ogg', () => {
  const source = read('public/chat.js');
  const voiceSlice = source.match(/const pickMimeType = \(\) => \{[\s\S]{0,900}?return undefined;\n    \};/)?.[0] || '';
  assert.match(voiceSlice, /audio\/mp4;codecs=mp4a\.40\.2/);
  assert.match(voiceSlice, /audio\/mp4/);
  assert.ok(
    voiceSlice.indexOf('audio/mp4') < voiceSlice.indexOf('audio/webm;codecs=opus'),
    'MP4/AAC must be preferred before WebM/Opus when MediaRecorder supports it'
  );
});

test('recorded voice uploads are explicitly marked without changing ordinary attachment uploads', () => {
  const source = read('public/chat.js');
  const uploadSlice = source.match(/const uploadFileAndSend = async \(fileOrBlob, options = \{\}\) => \{[\s\S]{0,2800}?\n\};/)?.[0] || '';
  assert.match(uploadSlice, /voiceMessage/);
  assert.match(uploadSlice, /formData\.append\(["']voiceMessage["'],\s*["']1["']\)/);

  const voiceSlice = source.match(/\/\/ ------------------- Voice Messages[\s\S]{0,14000}?\/\/ ------------------- Live Calls/)?.[0] || '';
  assert.match(voiceSlice, /uploadFileAndSend\(blob,[\s\S]{0,500}?voiceMessage:\s*true/);

  const attachmentSlice = source.match(/const uploadDroppedFiles = async[\s\S]{0,1200}?\n  \};/)?.[0] || '';
  assert.match(attachmentSlice, /uploadFileAndSend\(file\)/);
  assert.doesNotMatch(attachmentSlice, /voiceMessage/);
});

test('legacy WebM and Ogg voice MIME types normalize to AAC in an M4A container', () => {
  const { shouldNormalizeVoiceMime, buildCompatibleVoiceFilename, buildFfmpegArgs } = normalizer;

  assert.equal(shouldNormalizeVoiceMime('audio/webm;codecs=opus'), true);
  assert.equal(shouldNormalizeVoiceMime('audio/webm'), true);
  assert.equal(shouldNormalizeVoiceMime('audio/ogg;codecs=opus'), true);
  assert.equal(shouldNormalizeVoiceMime('audio/ogg'), true);
  assert.equal(shouldNormalizeVoiceMime('audio/mp4'), false);
  assert.equal(shouldNormalizeVoiceMime('audio/mpeg'), false);
  assert.equal(shouldNormalizeVoiceMime('audio/wav'), false);

  assert.equal(buildCompatibleVoiceFilename('voice-123.webm'), 'voice-123.m4a');
  assert.equal(buildCompatibleVoiceFilename('voice-123.ogg'), 'voice-123.m4a');

  assert.deepEqual(buildFfmpegArgs('/tmp/source.webm', '/uploads/voice-123.m4a'), [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', '/tmp/source.webm',
    '-vn',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-movflags', '+faststart',
    '/uploads/voice-123.m4a',
  ]);
});

test('WebM voice conversion publishes M4A/audio-mp4 and removes the incompatible source', async () => {
  await withTempDirs(async ({ quarantine, uploads }) => {
    const sourcePath = path.join(quarantine, 'file-123.webm');
    await fs.promises.writeFile(sourcePath, 'webm-source');

    const result = await normalizer.normalizeVoiceMessageUpload({
      sourcePath,
      storedFilename: 'file-123.webm',
      originalName: 'voice-2026-09-06.webm',
      mimeType: 'audio/webm;codecs=opus',
      uploadDir: uploads,
      runFfmpegImpl: async (args) => {
        assert.equal(args.at(-1), path.join(uploads, 'file-123.m4a'));
        await fs.promises.writeFile(args.at(-1), 'aac-output');
      },
    });

    assert.deepEqual(result, {
      filename: 'file-123.m4a',
      originalName: 'voice-2026-09-06.m4a',
      mimeType: 'audio/mp4',
      size: Buffer.byteLength('aac-output'),
    });
    await assert.rejects(fs.promises.stat(sourcePath), { code: 'ENOENT' });
    assert.equal(await fs.promises.readFile(path.join(uploads, 'file-123.m4a'), 'utf8'), 'aac-output');
  });
});

test('already-compatible voice audio is promoted unchanged and never invokes FFmpeg', async () => {
  await withTempDirs(async ({ quarantine, uploads }) => {
    const sourcePath = path.join(quarantine, 'file-456.m4a');
    await fs.promises.writeFile(sourcePath, 'compatible-audio');

    const result = await normalizer.normalizeVoiceMessageUpload({
      sourcePath,
      storedFilename: 'file-456.m4a',
      originalName: 'voice-2026-09-06.m4a',
      mimeType: 'audio/mp4',
      uploadDir: uploads,
      runFfmpegImpl: async () => {
        throw new Error('FFmpeg must not run for compatible voice audio');
      },
    });

    assert.deepEqual(result, {
      filename: 'file-456.m4a',
      originalName: 'voice-2026-09-06.m4a',
      mimeType: 'audio/mp4',
      size: Buffer.byteLength('compatible-audio'),
    });
    assert.equal(await fs.promises.readFile(path.join(uploads, 'file-456.m4a'), 'utf8'), 'compatible-audio');
  });
});

test('upload route normalizes only marked voice clips after antivirus scanning', () => {
  const source = read('index.js');
  assert.match(source, /voice-message-normalizer/);
  const route = source.match(/app\.post\(['"]\/upload['"][\s\S]{0,6000}?\n\}\);/)?.[0] || '';
  assert.match(route, /scanFileWithClamAv\(quarantinePath\)/);
  assert.match(route, /voiceMessage/);
  assert.match(route, /normalizeVoiceMessageUpload/);
  assert.ok(
    route.indexOf('scanFileWithClamAv(quarantinePath)') < route.indexOf('normalizeVoiceMessageUpload'),
    'antivirus scan must complete before FFmpeg processes a voice upload'
  );
  assert.match(route, /await fsPromises\.rename\(quarantinePath, finalPath\)/, 'ordinary uploads must keep the existing promotion path');

  const helper = read(helperPath);
  assert.match(helper, /spawn\(/);
  assert.doesNotMatch(helper, /shell\s*:\s*true/);
  assert.match(helper, /FFMPEG_PATH/);
});
