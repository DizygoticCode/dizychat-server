'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { scanFileWithClamAv } = require('./clamav-scanner');

const DEFAULT_UPLOAD_QUARANTINE_DIR = '/var/lib/dizychat/upload-quarantine';

const callStorageOption = (option, req, file, fallback) => new Promise((resolve, reject) => {
  if (typeof option === 'function') {
    option(req, file, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
    return;
  }
  resolve(option || fallback);
});

const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const normalizeScanErrorForUpload = (error) => {
  if (error?.code === 'CLAMAV_INFECTED') {
    const rejected = new Error('Upload rejected by antivirus scan.');
    rejected.code = 'CLAMAV_INFECTED';
    rejected.threat = error.threat || '';
    rejected.cause = error;
    return rejected;
  }

  const unavailable = new Error('Upload antivirus scan unavailable. Try again later.');
  unavailable.code = error?.code || 'CLAMAV_ERROR';
  unavailable.cause = error;
  return unavailable;
};

const createClamAvDiskStorage = ({
  options = {},
  quarantineDir = process.env.UPLOAD_QUARANTINE_DIR || DEFAULT_UPLOAD_QUARANTINE_DIR,
  scanFile = scanFileWithClamAv,
} = {}) => {
  const resolvedQuarantineDir = path.resolve(String(quarantineDir || DEFAULT_UPLOAD_QUARANTINE_DIR));

  return {
    _handleFile(req, file, callback) {
      (async () => {
        const finalDirRaw = await callStorageOption(options.destination, req, file, process.cwd());
        const filenameRaw = await callStorageOption(options.filename, req, file, `${Date.now()}-upload`);
        const finalDir = path.resolve(String(finalDirRaw));
        const filename = path.basename(String(filenameRaw));
        const quarantinePath = path.join(resolvedQuarantineDir, filename);
        const finalPath = path.join(finalDir, filename);

        await fs.promises.mkdir(resolvedQuarantineDir, { recursive: true, mode: 0o700 });
        await fs.promises.mkdir(finalDir, { recursive: true });

        let promoted = false;
        try {
          const output = fs.createWriteStream(quarantinePath, {
            flags: 'wx',
            mode: 0o600,
          });
          await pipeline(file.stream, output);

          try {
            await scanFile(quarantinePath);
          } catch (scanError) {
            throw normalizeScanErrorForUpload(scanError);
          }

          await fs.promises.rename(quarantinePath, finalPath);
          promoted = true;
          const stats = await fs.promises.stat(finalPath);

          callback(null, {
            destination: finalDir,
            filename,
            path: finalPath,
            size: stats.size,
          });
        } catch (error) {
          if (!promoted) {
            try {
              await safeUnlink(quarantinePath);
            } catch (cleanupError) {
              console.error('[Upload] Failed to remove quarantined file:', cleanupError?.message || cleanupError);
            }
          }
          callback(error);
        }
      })().catch(callback);
    },

    _removeFile(_req, file, callback) {
      const targetPath = file?.path;
      delete file.destination;
      delete file.filename;
      delete file.path;
      if (!targetPath) {
        callback(null);
        return;
      }
      fs.unlink(targetPath, (error) => {
        if (error?.code === 'ENOENT') callback(null);
        else callback(error || null);
      });
    },
  };
};

const installClamAvMulterGate = ({
  multerModule = require('multer'),
  quarantineDir = process.env.UPLOAD_QUARANTINE_DIR || DEFAULT_UPLOAD_QUARANTINE_DIR,
  scanFile = scanFileWithClamAv,
} = {}) => {
  if (multerModule.__dizyClamAvGateInstalled) return;

  multerModule.diskStorage = (options = {}) => createClamAvDiskStorage({
    options,
    quarantineDir,
    scanFile,
  });
  Object.defineProperty(multerModule, '__dizyClamAvGateInstalled', {
    value: true,
    enumerable: false,
    configurable: false,
  });
};

module.exports = {
  DEFAULT_UPLOAD_QUARANTINE_DIR,
  createClamAvDiskStorage,
  installClamAvMulterGate,
};
