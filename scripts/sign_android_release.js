const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function normalizeFingerprint(value) {
  const normalized = String(value || '').replace(/[:\s]/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('ANDROID_CERT_SHA256 must be the SHA-256 certificate fingerprint of the APK already distributed.');
  }
  return normalized;
}

function validateConfiguration(env = process.env) {
  for (const name of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    if (!env[name]?.trim()) throw new Error(`Configure the repository secret ${name} before publishing Android updates.`);
  }
  const expectedFingerprint = normalizeFingerprint(env.ANDROID_CERT_SHA256);
  const encoded = env.ANDROID_KEYSTORE_BASE64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error('ANDROID_KEYSTORE_BASE64 is not valid base64.');
  }
  return { expectedFingerprint, keystore: Buffer.from(encoded, 'base64') };
}

function verifySignatureReport(report, expectedFingerprint) {
  const fingerprints = [...report.matchAll(/^Signer #\d+ certificate SHA-256 digest:\s*([a-f0-9]+)\s*$/gim)];
  if (fingerprints.length !== 1 || normalizeFingerprint(fingerprints[0][1]) !== expectedFingerprint) {
    throw new Error('APK signing certificate does not match ANDROID_CERT_SHA256. Publication stopped to preserve update compatibility.');
  }
}

function run(command, args, encoding = 'utf8') {
  const result = spawnSync(command, args, { encoding, env: process.env });
  if (result.error || result.status !== 0) {
    // Do not print arguments or environment: they can contain signing credentials.
    throw new Error(`Signing tool ${path.basename(command)} failed. Check the keystore, alias, passwords and Android SDK configuration.`);
  }
  return result.stdout;
}

function signApk(apkPath) {
  const { expectedFingerprint, keystore } = validateConfiguration();
  if (!apkPath || !fs.statSync(apkPath).isFile()) throw new Error('Release APK not found.');
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdkRoot) throw new Error('Android SDK path is missing.');
  const toolsRoot = path.join(sdkRoot, 'build-tools');
  const versions = fs.readdirSync(toolsRoot).filter(version => /^\d+\.\d+\.\d+$/.test(version))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error('Stable Android build-tools were not found.');
  const tools = path.join(toolsRoot, versions.at(-1));
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-signing-'));
  try {
    const keyPath = path.join(temporaryDirectory, 'release.keystore');
    fs.writeFileSync(keyPath, keystore, { mode: 0o600 });
    const certificate = run('keytool', ['-exportcert', '-keystore', keyPath,
      '-alias', process.env.ANDROID_KEY_ALIAS, '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD'], null);
    if (crypto.createHash('sha256').update(certificate).digest('hex') !== expectedFingerprint) {
      throw new Error('The keystore differs from the certificate pinned in ANDROID_CERT_SHA256. Keep the existing signing key; do not generate a replacement.');
    }
    const alignedPath = path.join(temporaryDirectory, 'aligned.apk');
    run(path.join(tools, 'zipalign'), ['-P', '16', '-f', '4', path.resolve(apkPath), alignedPath]);
    run(path.join(tools, 'apksigner'), ['sign', '--ks', keyPath,
      '--ks-key-alias', process.env.ANDROID_KEY_ALIAS,
      '--ks-pass', 'env:ANDROID_KEYSTORE_PASSWORD', '--key-pass', 'env:ANDROID_KEY_PASSWORD',
      '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true', alignedPath]);
    const report = run(path.join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', alignedPath]);
    verifySignatureReport(report, expectedFingerprint);
    fs.copyFileSync(alignedPath, apkPath);
    console.log('Release APK signature verified against the pinned certificate.');
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    if (process.argv[2] === '--check') validateConfiguration();
    else signApk(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { normalizeFingerprint, validateConfiguration, verifySignatureReport };
