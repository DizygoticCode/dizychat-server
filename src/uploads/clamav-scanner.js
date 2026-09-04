'use strict';

const { execFile } = require('node:child_process');

const DEFAULT_SCAN_TIMEOUT_MS = 120000;
const MIN_SCAN_TIMEOUT_MS = 5000;
const MAX_SCAN_TIMEOUT_MS = 10 * 60 * 1000;

const parseScanTimeoutMs = (value, fallback = DEFAULT_SCAN_TIMEOUT_MS) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(parsed, MIN_SCAN_TIMEOUT_MS), MAX_SCAN_TIMEOUT_MS);
};

const extractThreatName = (output) => {
  const match = String(output || '').match(/:\s*(.+?)\s+FOUND(?:\r?\n|$)/m);
  return match ? match[1].trim() : 'Threat detected';
};

const makeScannerError = (message, code, extra = {}) => {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
};

const createClamAvScanner = ({
  execFileImpl = execFile,
  command = process.env.CLAMAV_SCAN_COMMAND || 'clamdscan',
  timeoutMs = parseScanTimeoutMs(process.env.CLAMAV_SCAN_TIMEOUT_MS),
} = {}) => {
  const safeCommand = String(command || '').trim() || 'clamdscan';
  const safeTimeoutMs = parseScanTimeoutMs(timeoutMs);

  return (filePath) => new Promise((resolve, reject) => {
    const target = String(filePath || '').trim();
    if (!target) {
      reject(makeScannerError('ClamAV scan target is missing', 'CLAMAV_ERROR'));
      return;
    }

    execFileImpl(
      safeCommand,
      ['--fdpass', '--no-summary', target],
      {
        timeout: safeTimeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout = '', stderr = '') => {
        if (!error) {
          resolve({ clean: true, threat: '' });
          return;
        }

        const combinedOutput = `${stdout || ''}\n${stderr || ''}`;
        if (Number(error.code) === 1 || /\bFOUND\b/.test(combinedOutput)) {
          const threat = extractThreatName(combinedOutput);
          reject(makeScannerError('Upload rejected by ClamAV', 'CLAMAV_INFECTED', { threat }));
          return;
        }

        if (error.code === 'ENOENT' || error.code === 'EACCES') {
          reject(makeScannerError('ClamAV scanner is unavailable', 'CLAMAV_UNAVAILABLE', {
            cause: error,
          }));
          return;
        }

        if (error.killed || error.signal) {
          reject(makeScannerError('ClamAV scan timed out', 'CLAMAV_TIMEOUT', {
            cause: error,
          }));
          return;
        }

        reject(makeScannerError('ClamAV scan failed', 'CLAMAV_ERROR', {
          cause: error,
          scannerOutput: combinedOutput.trim().slice(0, 1000),
        }));
      },
    );
  });
};

const scanFileWithClamAv = createClamAvScanner();

module.exports = {
  DEFAULT_SCAN_TIMEOUT_MS,
  createClamAvScanner,
  parseScanTimeoutMs,
  scanFileWithClamAv,
};
