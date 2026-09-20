'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const fsp = fs.promises;
const FILTER_CHAIN = [
  'silenceremove=start_periods=1:start_duration=0.04:start_threshold=-50dB',
  'areverse',
  'silenceremove=start_periods=1:start_duration=0.08:start_threshold=-50dB',
  'areverse',
  'loudnorm=I=-16:TP=-1.5:LRA=7',
].join(',');

const buildSoundboardFfmpegArgs = (inputPath, outputPath) => [
  '-hide_banner',
  '-loglevel', 'error',
  '-y',
  '-i', inputPath,
  '-vn',
  '-af', FILTER_CHAIN,
  '-ar', '48000',
  '-c:a', 'aac',
  '-b:a', '128k',
  '-movflags', '+faststart',
  outputPath,
];

const runFfmpeg = (
  args,
  { ffmpegPath = String(process.env.FFMPEG_PATH || '').trim() || 'ffmpeg' } = {}
) => new Promise((resolve, reject) => {
  let settled = false;
  let stderr = '';
  const child = spawn(ffmpegPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  child.stderr?.on('data', (chunk) => {
    if (stderr.length < 8192) stderr += String(chunk);
  });

  const fail = (cause) => {
    if (settled) return;
    settled = true;
    const error = new Error('Soundboard audio normalization failed');
    error.code = 'SOUNDBOARD_AUDIO_NORMALIZATION_FAILED';
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
    await fsp.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const normalizeSoundboardAudio = async ({
  sourceBuffer,
  targetPath,
  runFfmpegImpl = runFfmpeg,
} = {}) => {
  if (!Buffer.isBuffer(sourceBuffer) || !sourceBuffer.length) {
    throw new TypeError('Soundboard source audio buffer is required');
  }

  const rawTarget = String(targetPath || '').trim();
  if (!rawTarget) throw new TypeError('Soundboard target path is required');
  const destination = path.resolve(rawTarget);

  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const token = crypto.randomUUID();
  const inputPath = path.join(path.dirname(destination), `.soundboard-source-${token}.bin`);
  const outputPath = path.join(path.dirname(destination), `.soundboard-clean-${token}.m4a`);

  try {
    await fsp.writeFile(inputPath, sourceBuffer, { flag: 'wx' });
    await runFfmpegImpl(buildSoundboardFfmpegArgs(inputPath, outputPath));
    const stat = await fsp.stat(outputPath);
    if (!stat.isFile() || stat.size <= 0) {
      const error = new Error('Normalized soundboard clip was empty');
      error.code = 'SOUNDBOARD_AUDIO_NORMALIZATION_EMPTY';
      throw error;
    }

    await fsp.rename(outputPath, destination);
    return {
      path: destination,
      size: stat.size,
      mimeType: 'audio/mp4',
      extension: 'm4a',
    };
  } finally {
    await removeIfPresent(inputPath);
    await removeIfPresent(outputPath);
  }
};

module.exports = {
  FILTER_CHAIN,
  buildSoundboardFfmpegArgs,
  runFfmpeg,
  normalizeSoundboardAudio,
};
