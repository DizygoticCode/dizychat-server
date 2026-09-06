'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const fsPromises = fs.promises;

const normalizeMime = (mimeType = '') =>
  String(mimeType || '').split(';', 1)[0].trim().toLowerCase();

const shouldNormalizeVoiceMime = (mimeType = '') => {
  const base = normalizeMime(mimeType);
  return base === 'audio/webm' || base === 'audio/ogg';
};

const buildCompatibleVoiceFilename = (filename = 'voice-message') => {
  const parsed = path.parse(path.basename(String(filename || 'voice-message')));
  return `${parsed.name || 'voice-message'}.m4a`;
};

const buildFfmpegArgs = (inputPath, outputPath) => [
  '-hide_banner',
  '-loglevel', 'error',
  '-y',
  '-i', inputPath,
  '-vn',
  '-c:a', 'aac',
  '-b:a', '96k',
  '-movflags', '+faststart',
  outputPath,
];

const runFfmpeg = (
  args,
  { ffmpegPath = String(process.env.FFMPEG_PATH || '').trim() || 'ffmpeg' } = {}
) => new Promise((resolve, reject) => {
  let settled = false;
  const child = spawn(ffmpegPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';

  child.stderr?.on('data', (chunk) => {
    if (stderr.length < 8192) stderr += String(chunk);
  });

  const fail = (cause) => {
    if (settled) return;
    settled = true;
    const error = new Error('Voice message conversion failed');
    error.code = 'VOICE_MESSAGE_CONVERSION_FAILED';
    if (cause) error.cause = cause;
    if (stderr) error.details = stderr.slice(0, 8192);
    reject(error);
  };

  child.once('error', fail);
  child.once('close', (code) => {
    if (settled) return;
    if (code === 0) {
      settled = true;
      resolve();
      return;
    }
    fail();
  });
});

const removeIfPresent = async (filePath) => {
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const normalizeVoiceMessageUpload = async ({
  sourcePath,
  storedFilename,
  originalName,
  mimeType,
  uploadDir,
  runFfmpegImpl = runFfmpeg,
} = {}) => {
  const source = String(sourcePath || '').trim();
  const filename = path.basename(String(storedFilename || '').trim());
  const original = String(originalName || filename).trim();
  const baseMime = normalizeMime(mimeType);
  const destinationDir = String(uploadDir || '').trim();

  if (!source || !filename || !destinationDir) {
    throw new TypeError('voice upload paths and filename are required');
  }
  if (!baseMime.startsWith('audio/')) {
    const error = new Error('Voice message upload must be audio');
    error.code = 'VOICE_MESSAGE_INVALID_TYPE';
    throw error;
  }

  if (!shouldNormalizeVoiceMime(baseMime)) {
    const finalPath = path.join(destinationDir, filename);
    await fsPromises.rename(source, finalPath);
    const stat = await fsPromises.stat(finalPath);
    return {
      filename,
      originalName: original,
      mimeType: baseMime,
      size: stat.size,
    };
  }

  const outputFilename = buildCompatibleVoiceFilename(filename);
  const outputOriginalName = buildCompatibleVoiceFilename(original);
  const outputPath = path.join(destinationDir, outputFilename);

  try {
    await runFfmpegImpl(buildFfmpegArgs(source, outputPath));
    const stat = await fsPromises.stat(outputPath);
    await removeIfPresent(source);
    return {
      filename: outputFilename,
      originalName: outputOriginalName,
      mimeType: 'audio/mp4',
      size: stat.size,
    };
  } catch (error) {
    await removeIfPresent(outputPath);
    throw error;
  }
};

module.exports = {
  normalizeMime,
  shouldNormalizeVoiceMime,
  buildCompatibleVoiceFilename,
  buildFfmpegArgs,
  runFfmpeg,
  normalizeVoiceMessageUpload,
};
