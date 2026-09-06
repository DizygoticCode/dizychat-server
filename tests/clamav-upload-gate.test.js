const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const serverPath = path.join(repoRoot, 'index.js');
const serverCorePath = path.join(repoRoot, 'server-core.js');
const scannerPath = path.join(repoRoot, 'src', 'uploads', 'clamav-scanner.js');
const serverSource = `${fs.readFileSync(serverPath, 'utf8')}\n${fs.readFileSync(serverCorePath, 'utf8')}`;

assert.equal(
  fs.existsSync(scannerPath),
  true,
  'expected a local ClamAV scanner module for upload verdicts',
);

assert.match(
  serverSource,
  /UPLOAD_QUARANTINE_DIR[\s\S]*\/var\/lib\/dizychat\/upload-quarantine/,
  'uploads must land in a private quarantine directory before scanning',
);
assert.match(
  serverSource,
  /destination:\s*\([^)]*\)\s*=>[\s\S]*UPLOAD_QUARANTINE_DIR/,
  'multer must write incoming files to quarantine rather than the public upload directory',
);
assert.match(
  serverSource,
  /app\.post\('\/upload'[\s\S]*async\s*\(req,\s*res\)[\s\S]*scanFileWithClamAv\([\s\S]*fsPromises\.rename\([\s\S]*res\.json\(/,
  'the upload route must scan before promoting a clean file into the public upload store',
);
assert.doesNotMatch(
  serverSource,
  /UPLOAD_EXTENSION_CONFIG|isAllowedUploadType|verifyUploadFileSignature|file-signature gating/,
  'ClamAV must not reintroduce the retired MIME/signature rejection matrix',
);

console.log('ClamAV upload gate contract passed');
