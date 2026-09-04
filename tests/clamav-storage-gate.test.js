const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');

const { createClamAvDiskStorage } = require('../src/uploads/clamav-storage-gate');

const handleFile = (storage, file) => new Promise((resolve, reject) => {
  storage._handleFile({}, file, (error, info) => {
    if (error) reject(error);
    else resolve(info);
  });
});

const makeFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dizychat-clamav-'));
  const quarantineDir = path.join(root, 'quarantine');
  const finalDir = path.join(root, 'uploads');
  const options = {
    destination: (_req, _file, callback) => callback(null, finalDir),
    filename: (_req, _file, callback) => callback(null, 'file-123.mobilebin'),
  };
  const file = {
    originalname: 'phone-file.mobilebin',
    mimetype: 'application/octet-stream',
    stream: Readable.from(Buffer.from('mobile upload payload')),
  };
  return { root, quarantineDir, finalDir, options, file };
};

test('clean uploads are scanned in private quarantine before promotion', async (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let scannedPath = '';

  const storage = createClamAvDiskStorage({
    options: fixture.options,
    quarantineDir: fixture.quarantineDir,
    scanFile: async (filePath) => {
      scannedPath = filePath;
      assert.equal(fs.existsSync(filePath), true, 'quarantine file should exist while ClamAV scans it');
      assert.equal(filePath.startsWith(fixture.quarantineDir + path.sep), true);
      return { clean: true, threat: '' };
    },
  });

  const info = await handleFile(storage, fixture.file);
  assert.equal(scannedPath.startsWith(fixture.quarantineDir + path.sep), true);
  assert.equal(info.path, path.join(fixture.finalDir, 'file-123.mobilebin'));
  assert.equal(fs.existsSync(info.path), true);
  assert.equal(fs.existsSync(scannedPath), false, 'clean quarantine file should be atomically promoted');
  assert.equal(fs.readFileSync(info.path, 'utf8'), 'mobile upload payload');
});

test('infected uploads are deleted from quarantine and never enter the public store', async (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const storage = createClamAvDiskStorage({
    options: fixture.options,
    quarantineDir: fixture.quarantineDir,
    scanFile: async () => {
      const error = new Error('Upload rejected by ClamAV');
      error.code = 'CLAMAV_INFECTED';
      error.threat = 'Eicar-Signature';
      throw error;
    },
  });

  await assert.rejects(
    handleFile(storage, fixture.file),
    (error) => error.code === 'CLAMAV_INFECTED',
  );
  assert.equal(fs.existsSync(path.join(fixture.finalDir, 'file-123.mobilebin')), false);
  assert.deepEqual(fs.existsSync(fixture.quarantineDir) ? fs.readdirSync(fixture.quarantineDir) : [], []);
});

test('scanner failures also delete quarantine files and fail closed', async (t) => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const storage = createClamAvDiskStorage({
    options: fixture.options,
    quarantineDir: fixture.quarantineDir,
    scanFile: async () => {
      const error = new Error('ClamAV scanner is unavailable');
      error.code = 'CLAMAV_UNAVAILABLE';
      throw error;
    },
  });

  await assert.rejects(
    handleFile(storage, fixture.file),
    (error) => error.code === 'CLAMAV_UNAVAILABLE',
  );
  assert.equal(fs.existsSync(path.join(fixture.finalDir, 'file-123.mobilebin')), false);
  assert.deepEqual(fs.existsSync(fixture.quarantineDir) ? fs.readdirSync(fixture.quarantineDir) : [], []);
});
