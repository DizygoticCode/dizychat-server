'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const helperPath = 'src/uploads/voice-message-normalizer.js';

const loadNormalizer = () => {
  assert.equal(exists(helperPath), true, 'voice-message normalizer must exist');
  return require(path.join(root, helperPath));
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
  const uploadSlice = source.match(/const uploadFileAndSend = async \(fileOrBlob, options = \{\}\) => \{[\s\S]{0,2600}?\n\};/)?.[0] || '';
  assert.match(uploadSlice, /voiceMessage/);
  assert.match(uploadSlice, /formData\.append\(["']voiceMessage["'],\s*["']1["']\)/);

  const voiceSlice = source.match(/\/\/ ------------------- Voice Messages[\s\S]{0,12000}?\/\/ ------------------- Live Calls/)?.[0] || '';
  assert.match(voiceSlice, /uploadFileAndSend\(blob,[\s\S]{0,500}?voiceMessage:\s*true/);

  const attachmentSlice = source.match(/const uploadDroppedFiles = async[\s\S]{0,1200}?\n  \};/)?.[0] || '';
  assert.match(attachmentSlice, /uploadFileAndSend\(file\)/);
  assert.doesNotMatch(attachmentSlice, /voiceMessage/);
});

test('legacy WebM and Ogg voice MIME types normalize to AAC in an M4A container', () => {
  const {
    shouldNormalizeVoiceMime,
    buildCompatibleVoiceFilename,
    buildFfmpegArgs,
  } = loadNormalizer();

  assert.equal(shouldNormalizeVoiceMime('audio/webm;codecs=opus'), true);
  assert.equal(shouldNormalizeVoiceMime('audio/webm'), true);
  assert.equal(shouldNormalizeVoiceMime('audio/ogg;codecs=opus'), true);
  assert.equal(shouldNormalizeVoiceMime('audio/ogg'), true);
  assert.equal(shouldNormalizeVoiceMime('audio/mp4'), false);
  assert.equal(shouldNormalizeVoiceMime('audio/mpeg'), false);
  assert.equal(shouldNormalizeVoiceMime('audio/wav'), false);

  assert.equal(buildCompatibleVoiceFilename('voice-123.webm'), 'voice-123.m4a');
  assert.equal(buildCompatibleVoiceFilename('voice-123.ogg'), 'voice-123.m4a');

  const args = buildFfmpegArgs('/tmp/source.webm', '/uploads/voice-123.m4a');
  assert.deepEqual(args, [
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

test('upload route normalizes only marked incompatible voice clips after antivirus scanning', () => {
  const source = read('index.js');
  assert.match(source, /voice-message-normalizer/);
  const route = source.match(/app\.post\(['"]\/upload['"][\s\S]{0,5000}?\n\}\);/)?.[0] || '';
  assert.match(route, /scanFileWithClamAv\(quarantinePath\)/);
  assert.match(route, /voiceMessage/);
  assert.match(route, /normalizeVoiceMessageUpload/);
  assert.ok(
    route.indexOf('scanFileWithClamAv(quarantinePath)') < route.indexOf('normalizeVoiceMessageUpload'),
    'antivirus scan must complete before FFmpeg processes a voice upload'
  );
  assert.match(route, /audio\/mp4/);

  const helper = exists(helperPath) ? read(helperPath) : '';
  assert.match(helper, /spawn\(/);
  assert.doesNotMatch(helper, /shell\s*:\s*true/);
  assert.match(helper, /FFMPEG_PATH/);
});
