import './setup_env';
import fs from 'fs';
import path from 'path';
import { compareSemver, isNewerVersion, parseSemver, APP_VERSION } from '../src/utils/version';
import { StorageService } from '../src/services/storage';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✅ [PASS] ${message}`);
}

async function runKeystoreTransitionAndSemverTests() {
  console.log('================================================================');
  console.log('🛡️  LUMEN 3.4.0: KEYSTORE TRANSITION & SEMVER HARDENING TESTS');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    console.log(`--- Test: ${name} ---`);
    try {
      await fn();
      passed++;
    } catch (e: any) {
      console.error(`Error in ${name}:`, e.message);
      failed++;
    }
    console.log('');
  };

  const projectRoot = path.resolve(__dirname, '..');

  // Test 1: SemVer Comparison logic for automated CI build tags
  await test('1. compareSemver and isNewerVersion prevent false update alerts for official releases', () => {
    // When local is an official release (no build suffix, e.g. 3.4.0)
    // and remote is an automated CI build of the exact same version (e.g. v3.4.0-build-54):
    assert(
      compareSemver('v3.4.0-build-54', '3.4.0') === 0,
      'compareSemver(v3.4.0-build-54, 3.4.0) returns 0 (remote test build is not superior to official release)'
    );
    assert(
      !isNewerVersion('v3.4.0-build-54', '3.4.0'),
      'isNewerVersion(v3.4.0-build-54, 3.4.0) is FALSE (no notification popup for official users)'
    );

    // When local is a test build (e.g. 3.4.0-build-54) and an official release is published (3.4.0):
    assert(
      compareSemver('3.4.0', '3.4.0-build-54') === 1,
      'Official release 3.4.0 is superior to test build 3.4.0-build-54'
    );
    assert(
      isNewerVersion('3.4.0', '3.4.0-build-54'),
      'Test build user is prompted to upgrade to official release 3.4.0'
    );

    // When both are test builds of the same version:
    assert(
      compareSemver('v3.4.0-build-55', 'v3.4.0-build-54') === 1,
      'Build 55 is newer than Build 54'
    );
    assert(
      compareSemver('v3.4.0-build-54', 'v3.4.0-build-55') === -1,
      'Build 54 is older than Build 55'
    );
    assert(
      compareSemver('v3.4.0-build-54', 'v3.4.0-build-54') === 0,
      'Identical builds are equal'
    );

    // When remote is a new patch or minor release:
    assert(
      compareSemver('3.6.1', '3.4.0') === 1,
      'Patch update 3.6.1 is newer than 3.4.0'
    );
    assert(
      compareSemver('v3.6.1', '3.4.0') === 1,
      'Minor update 3.6.1 is newer than 3.4.0'
    );
    assert(
      compareSemver('v3.6.1-build-1', '3.4.0') === 1,
      'Patch build 3.6.1-build-1 is newer than 3.4.0'
    );
  });

  // Test 2: Project-wide version consistency
  await test('2. Version 3.7.4 consistency across package.json, app.json and version.ts', () => {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert(pkg.version === '3.7.4', `package.json version is 3.7.4 (got ${pkg.version})`);

    const appJsonPath = path.join(projectRoot, 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    assert(appJson.expo.version === '3.7.4', `app.json expo.version is 3.7.4 (got ${appJson.expo.version})`);

    assert(APP_VERSION === '3.7.4', `src/utils/version.ts APP_VERSION is 3.7.4 (got ${APP_VERSION})`);
  });


  // Test 3: AppUpdateModal.tsx content and keystore notice verification
  await test('3. AppUpdateModal.tsx contains official keystore transition notice and backup export button', () => {
    const modalPath = path.join(projectRoot, 'src', 'components', 'AppUpdateModal.tsx');
    assert(fs.existsSync(modalPath), 'AppUpdateModal.tsx exists');
    const content = fs.readFileSync(modalPath, 'utf8');

    assert(
      content.includes('Aviso de Transição de Chave Oficial'),
      'AppUpdateModal contains "Aviso de Transição de Chave Oficial"'
    );
    assert(
      content.includes('lumen-release.keystore'),
      'AppUpdateModal references official keystore "lumen-release.keystore"'
    );
    assert(
      content.includes('debug.keystore'),
      'AppUpdateModal references test keystore "debug.keystore"'
    );
    assert(
      content.includes('Conflito de Pacote Android'),
      'AppUpdateModal alerts user about Android package signature conflict'
    );
    assert(
      content.includes('Exportar Backup dos Meus Dados'),
      'AppUpdateModal provides "Exportar Backup dos Meus Dados" button'
    );
    assert(
      content.includes('Restaurar Backup'),
      'AppUpdateModal instructs user to use "Restaurar Backup" after installing the official release'
    );
    assert(
      content.includes('StorageService.exportBackup'),
      'AppUpdateModal calls StorageService.exportBackup for data portability'
    );
    assert(
      content.includes('Share.share'),
      'AppUpdateModal shares the generated backup json file via system share dialog'
    );
  });

  // Test 4: StorageService.exportBackup functionality
  await test('4. StorageService.exportBackup generates a valid structured BackupData without leaking sensitive secrets', async () => {
    const backupData = await StorageService.exportBackup();
    assert(typeof backupData === 'object' && backupData !== null, 'exportBackup returns a BackupData object');
    assert(backupData.version === 2, 'Backup includes version identifier (2)');
    assert(typeof backupData.timestamp === 'string', 'Backup includes timestamp');
    assert(Array.isArray(backupData.subjects), 'Backup includes subjects array');
    assert(typeof backupData.settings === 'object', 'Backup includes settings object');

    const backupJson = JSON.stringify(backupData, null, 2);
    assert(typeof backupJson === 'string' && backupJson.length > 0, 'Backup serializes to valid JSON string');

    // Ensure sensitive secrets are not dumped
    assert((backupData as any).geminiApiKey === undefined, 'Backup does NOT export raw geminiApiKey');
    assert((backupData as any).apiKey === undefined, 'Backup does NOT export raw apiKey');
  });

  console.log('================================================================');
  console.log(`KEYSTORE & SEMVER TEST SUMMARY: ${passed}/${passed + failed} Passed (${failed} Failed)`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runKeystoreTransitionAndSemverTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
