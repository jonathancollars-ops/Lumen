import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const { normalizeFingerprint, validateConfiguration, verifySignatureReport } = require('../scripts/sign_android_release');

const fingerprint = 'ab'.repeat(32);
const configured = {
  ANDROID_KEYSTORE_BASE64: Buffer.from('fixture-only').toString('base64'),
  ANDROID_KEYSTORE_PASSWORD: 'fixture-password', ANDROID_KEY_ALIAS: 'fixture-key',
  ANDROID_KEY_PASSWORD: 'fixture-password', ANDROID_CERT_SHA256: fingerprint,
};
assert.equal(normalizeFingerprint(fingerprint.toUpperCase().match(/../g)!.join(':')), fingerprint);
for (const name of Object.keys(configured)) {
  assert.throws(() => validateConfiguration({ ...configured, [name]: '' }), /Configure|ANDROID_CERT_SHA256/);
}
assert.throws(() => validateConfiguration({ ...configured, ANDROID_KEYSTORE_BASE64: 'invalid!' }), /base64/);
assert.equal(validateConfiguration(configured).expectedFingerprint, fingerprint);
verifySignatureReport(`Signer #1 certificate SHA-256 digest: ${fingerprint}\n`, fingerprint);
assert.throws(() => verifySignatureReport('', fingerprint), /does not match/);
assert.throws(() => verifySignatureReport(`Signer #1 certificate SHA-256 digest: ${'cd'.repeat(32)}\n`, fingerprint), /does not match/);
assert.throws(() => verifySignatureReport(`Signer #1 certificate SHA-256 digest: ${fingerprint}\nSigner #2 certificate SHA-256 digest: ${fingerprint}\n`, fingerprint), /does not match/);
const env = { ...process.env, ...configured, ANDROID_KEYSTORE_PASSWORD: '' };
const check = spawnSync(process.execPath, ['scripts/sign_android_release.js', '--check'], { encoding: 'utf8', env });
assert.equal(check.status, 1);
assert.ok(!check.stderr.includes('fixture-password'));
assert.ok(check.stderr.includes('ANDROID_KEYSTORE_PASSWORD'));
console.log('PASS: missing signing credentials, malformed fingerprints and changed/multiple APK signers are rejected without printing credentials');

if (process.platform === 'win32') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-signature-test-'));
  try {
    const psExecutable = (() => {
      try {
        const probe = spawnSync('pwsh', ['-v']);
        return probe.status === 0 ? 'pwsh' : 'powershell';
      } catch {
        return 'powershell';
      }
    })();
    const scriptPath = path.resolve(__dirname, '../scripts/verify_windows_signatures.ps1');
    const verify = () => spawnSync(psExecutable, ['-NoProfile', '-NonInteractive', '-File', scriptPath, '-Path', directory],
      { encoding: 'utf8', env: process.env });
    assert.notEqual(verify().status, 0, 'An empty artifact directory cannot pass verification');
    fs.writeFileSync(path.join(directory, 'unsigned.exe'), 'unsigned fixture');
    const unsigned = verify();
    assert.notEqual(unsigned.status, 0, 'Unsigned executables cannot pass verification');
    assert.match((unsigned.stderr || '') + (unsigned.stdout || ''), /Invalid or untrusted/);
    console.log('PASS: Windows verification rejects absent artifacts and unsigned executables');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
