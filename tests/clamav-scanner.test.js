const assert = require('node:assert/strict');
const test = require('node:test');

const { createClamAvScanner } = require('../src/uploads/clamav-scanner');

const runScan = ({ error = null, stdout = '', stderr = '' } = {}, options = {}) => {
  let observed = null;
  const execFileImpl = (command, args, execOptions, callback) => {
    observed = { command, args, execOptions };
    queueMicrotask(() => callback(error, stdout, stderr));
    return { kill() {} };
  };
  const scan = createClamAvScanner({
    execFileImpl,
    command: options.command || 'clamdscan',
    timeoutMs: options.timeoutMs || 43210,
  });
  return { scan, getObserved: () => observed };
};

test('clean ClamAV verdict uses clamdscan fd passing and resolves clean', async () => {
  const { scan, getObserved } = runScan({ stdout: '/tmp/file.jpg: OK\n' });
  const verdict = await scan('/tmp/file.jpg');

  assert.deepEqual(verdict, { clean: true, threat: '' });
  assert.deepEqual(getObserved().args, ['--fdpass', '--no-summary', '/tmp/file.jpg']);
  assert.equal(getObserved().command, 'clamdscan');
  assert.equal(getObserved().execOptions.timeout, 43210);
});

test('infected ClamAV verdict is rejected with the detected threat name', async () => {
  const infected = new Error('Command failed');
  infected.code = 1;
  const { scan } = runScan({
    error: infected,
    stdout: '/tmp/file.bin: Eicar-Signature FOUND\n',
  });

  await assert.rejects(
    scan('/tmp/file.bin'),
    (error) => error.code === 'CLAMAV_INFECTED' && error.threat === 'Eicar-Signature',
  );
});

test('scanner execution errors fail closed as unavailable', async () => {
  const unavailable = new Error('spawn clamdscan ENOENT');
  unavailable.code = 'ENOENT';
  const { scan } = runScan({ error: unavailable });

  await assert.rejects(
    scan('/tmp/file.txt'),
    (error) => error.code === 'CLAMAV_UNAVAILABLE',
  );
});

test('ClamAV exit code 2 fails closed as a scanner error', async () => {
  const scannerError = new Error('scanner error');
  scannerError.code = 2;
  const { scan } = runScan({ error: scannerError, stderr: 'ERROR: Could not connect to clamd\n' });

  await assert.rejects(
    scan('/tmp/file.txt'),
    (error) => error.code === 'CLAMAV_ERROR',
  );
});

test('timed-out ClamAV processes fail closed with an explicit timeout verdict', async () => {
  const timeout = new Error('Command timed out');
  timeout.killed = true;
  timeout.signal = 'SIGTERM';
  const { scan } = runScan({ error: timeout });

  await assert.rejects(
    scan('/tmp/file.txt'),
    (error) => error.code === 'CLAMAV_TIMEOUT',
  );
});
