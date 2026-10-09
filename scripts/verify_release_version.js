const fs = require('node:fs');
const path = require('node:path');

function verifyMetadata(root = path.resolve(__dirname, '..')) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const expo = JSON.parse(read('app.json')).expo;
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
  const source = read('src/utils/version.ts').match(/APP_VERSION\s*=\s*'([^']+)'/);
  const cargo = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m);
  const versions = [lock.version, lock.packages[''].version, expo.version, tauri.version, source?.[1], cargo?.[1]];
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || versions.some(version => version !== pkg.version)) {
    throw new Error('Alinhe a versão em package.json, package-lock.json, app.json, version.ts, Cargo.toml e tauri.conf.json antes de publicar.');
  }
  if (!Number.isInteger(expo.android.versionCode) || expo.android.versionCode <= 0) {
    throw new Error('O Android precisa de um versionCode inteiro positivo.');
  }
  return pkg.version;
}

async function verifyPublishedRelease(version, platform, env = process.env, request = fetch) {
  const ref = env.GITHUB_REF || '';
  if (!['refs/heads/main', 'refs/heads/master'].includes(ref) && !ref.startsWith('refs/tags/v')) return;
  if (ref.startsWith('refs/tags/') && ref !== `refs/tags/v${version}`) {
    throw new Error(`A tag deve ser v${version}, igual à versão incorporada nos aplicativos.`);
  }
  if (!env.GITHUB_REPOSITORY || !['android', 'windows'].includes(platform)) {
    throw new Error('Informe GITHUB_REPOSITORY e RELEASE_PLATFORM para validar a publicação.');
  }
  const response = await request(
    `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/releases/tags/v${version}`,
    { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GITHUB_TOKEN}` },
      signal: AbortSignal.timeout(10000) },
  );
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Não foi possível validar a versão publicada (HTTP ${response.status}).`);
  const release = await response.json();
  const published = (release.assets || []).some(asset => typeof asset.name === 'string' &&
    (platform === 'android' ? /\.apk$/i.test(asset.name) : /\.(exe|msi)$/i.test(asset.name) && !/portable/i.test(asset.name)));
  if (published) throw new Error(`Lumen ${version} para ${platform} já foi publicado. Incremente a versão antes de distribuir novas alterações.`);
  if (/^[a-f0-9]{40}$/i.test(release.target_commitish || '') && release.target_commitish !== env.GITHUB_SHA) {
    throw new Error('Os pacotes Android e Windows da mesma versão devem ser gerados pelo mesmo commit. Incremente a versão para novas alterações.');
  }
}

if (require.main === module) {
  Promise.resolve().then(async () => {
    const version = verifyMetadata();
    if (process.env.RELEASE_PLATFORM) await verifyPublishedRelease(version, process.env.RELEASE_PLATFORM);
    console.log(`Versão ${version} validada.`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { verifyMetadata, verifyPublishedRelease };
