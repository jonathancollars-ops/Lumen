import './setup_env';
import fs from 'fs';
import path from 'path';
import { AIParsingService, ParsingContext } from '../src/services/AIParsingService';
import { APP_VERSION } from '../src/utils/version';
import { AppUpdateService } from '../src/services/AppUpdateService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✅ [PASS] ${message}`);
}

async function runNomenclatureTests() {
  console.log('================================================================');
  console.log('🏛️  LUMEN 3.0: NOMENCLATURE & BRANDING INTEGRITY TEST SUITE');
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

  // Test 1: package.json branding
  await test('1. package.json nomenclature & version alignment', () => {
    const pkgPath = path.join(projectRoot, 'package.json');
    assert(fs.existsSync(pkgPath), 'package.json exists');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert(pkg.name === 'lumen', `package.json "name" is "lumen" (got: "${pkg.name}")`);
    assert(pkg.version === '3.7.3', `package.json "version" is "3.7.3" (got: "${pkg.version}")`);
  });

  // Test 2: app.json branding
  await test('2. app.json nomenclature & version alignment', () => {
    const appJsonPath = path.join(projectRoot, 'app.json');
    assert(fs.existsSync(appJsonPath), 'app.json exists');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    assert(appJson.expo.name === 'Lumen', `app.json expo.name is "Lumen" (got: "${appJson.expo.name}")`);
    assert(appJson.expo.slug === 'lumen', `app.json expo.slug is "lumen" (got: "${appJson.expo.slug}")`);
    assert(appJson.expo.version === '3.7.3', `app.json expo.version is "3.7.3" (got: "${appJson.expo.version}")`);
  });

  // Test 3: strings.xml Android app_name — only valid after expo prebuild
  await test('3. Android strings.xml app_name alignment', () => {
    const stringsPath = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
    if (!fs.existsSync(stringsPath)) {
      console.log('  ℹ️  strings.xml not yet generated (expected in CI pre-prebuild). Skipping.');
      return;
    }
    const stringsContent = fs.readFileSync(stringsPath, 'utf8');
    assert(
      stringsContent.includes('<string name="app_name">Lumen</string>'),
      'strings.xml specifies <string name="app_name">Lumen</string>'
    );
    assert(
      !stringsContent.includes('<string name="app_name">Organiza</string>'),
      'strings.xml does not contain legacy app_name "Organiza"'
    );
  });

  // Test 4: AIParsingService system prompt branding
  await test('4. AIParsingService system prompt AI persona branding', () => {
    const context: ParsingContext = {
      currentDate: '2026-08-21',
      currentDayOfWeek: 'Sexta-feira',
      registeredSubjects: ['Cálculo 1', 'Algoritmos']
    };
    const prompt = AIParsingService.buildSystemPrompt(context);
    assert(
      prompt.includes('Você é o assistente de inteligência artificial do aplicativo acadêmico Lumen.'),
      'AIParsingService system prompt declares persona as Lumen assistant'
    );
    assert(
      !prompt.includes('aplicativo acadêmico Organiza'),
      'AIParsingService system prompt does not contain legacy "Organiza" branding'
    );
  });

  // Test 5: OnboardingModal UI branding
  await test('5. OnboardingModal.tsx user-facing text branding', () => {
    const onboardingPath = path.join(projectRoot, 'src', 'components', 'OnboardingModal.tsx');
    assert(fs.existsSync(onboardingPath), 'OnboardingModal.tsx exists');
    const onboardingContent = fs.readFileSync(onboardingPath, 'utf8');
    assert(onboardingContent.includes('Guia do Lumen'), 'OnboardingModal contains "Guia do Lumen"');
    assert(onboardingContent.includes('Bem-vindo ao Lumen!'), 'OnboardingModal contains "Bem-vindo ao Lumen!"');
    assert(onboardingContent.includes('Lumen AI & Professor Socrático'), 'OnboardingModal contains "Lumen AI & Professor Socrático"');
    assert(!onboardingContent.includes('Guia do Organiza'), 'OnboardingModal does not contain "Guia do Organiza"');
    assert(!onboardingContent.includes('Bem-vindo ao Organiza'), 'OnboardingModal does not contain "Bem-vindo ao Organiza"');
  });

  // Test 6: AcademicPerformanceScreen UI branding
  await test('6. AcademicPerformanceScreen.tsx branding & headers', () => {
    const academicPath = path.join(projectRoot, 'src', 'screens', 'AcademicPerformanceScreen.tsx');
    assert(fs.existsSync(academicPath), 'AcademicPerformanceScreen.tsx exists');
    const academicContent = fs.readFileSync(academicPath, 'utf8');
    assert(
      academicContent.includes('Desempenho & Curso') || academicContent.includes('Meu CR Acumulado'),
      'AcademicPerformanceScreen contains academic performance branding'
    );
    assert(
      !academicContent.includes('Organiza'),
      'AcademicPerformanceScreen does not reference "Organiza"'
    );
  });

  // Test 7: AppNavigator.tsx header branding
  await test('7. AppNavigator.tsx main header branding', () => {
    const appPath = path.join(projectRoot, 'src', 'navigation', 'AppNavigator.tsx');
    assert(fs.existsSync(appPath), 'AppNavigator.tsx exists');
    const appContent = fs.readFileSync(appPath, 'utf8');
    assert(!appContent.includes('>Organiza<'), 'AppNavigator.tsx does not render ">Organiza<"');
    assert(appContent.includes('>Lumen<'), 'AppNavigator.tsx renders ">Lumen<" branding');

    // Verify header occurrences
    const matches = appContent.match(/>Lumen</g);
    assert(
      matches !== null && matches.length >= 1,
      `AppNavigator.tsx renders ">Lumen<" in header (found ${matches ? matches.length : 0} occurrences)`
    );
  });

  // Test 8: package-lock.json branding
  await test('8. package-lock.json nomenclature alignment', () => {
    const lockPath = path.join(projectRoot, 'package-lock.json');
    assert(fs.existsSync(lockPath), 'package-lock.json exists');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert(lock.name === 'lumen', `package-lock.json root "name" is "lumen" (got: "${lock.name}")`);
    if (lock.packages && lock.packages['']) {
      assert(lock.packages[''].name === 'lumen', `package-lock.json packages[""].name is "lumen" (got: "${lock.packages[''].name}")`);
    }
  });

  // Test 9: Project-wide metadata consistency
  await test('9. Project-wide metadata consistency across manifests and components', () => {
    // Note: android/strings.xml is excluded — it's generated by expo prebuild (not available pre-build)
    const filesToAudit = [
      path.join(projectRoot, 'package.json'),
      path.join(projectRoot, 'package-lock.json'),
      path.join(projectRoot, 'app.json'),
      path.join(projectRoot, 'src', 'navigation', 'AppNavigator.tsx'),
      path.join(projectRoot, 'src', 'services', 'AIParsingService.ts'),
      path.join(projectRoot, 'src', 'components', 'OnboardingModal.tsx'),
      path.join(projectRoot, 'src', 'screens', 'AcademicPerformanceScreen.tsx')
    ];

    // Also validate strings.xml if it exists (local dev / post-prebuild)
    const stringsXml = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
    if (fs.existsSync(stringsXml)) {
      filesToAudit.push(stringsXml);
    }

    for (const f of filesToAudit) {
      assert(fs.existsSync(f), `File exists: ${path.relative(projectRoot, f)}`);
      const content = fs.readFileSync(f, 'utf8');
      assert(
        content.includes('Lumen') || content.includes('lumen'),
        `File contains Lumen branding: ${path.relative(projectRoot, f)}`
      );
    }
  });

  // Test 10: Version 3.7.3 alignment across version.ts, package.json, app.json, and AppUpdateService
  await test('10. Version 3.7.3 alignment across version.ts, package.json, app.json and AppUpdateService', () => {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const appJsonPath = path.join(projectRoot, 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

    assert(APP_VERSION === '3.7.3', `APP_VERSION is "3.7.3" (got: "${APP_VERSION}")`);
    assert(pkg.version === '3.7.3', `package.json version is "3.7.3" (got: "${pkg.version}")`);
    assert(appJson.expo.version === '3.7.3', `app.json expo.version is "3.7.3" (got: "${appJson.expo.version}")`);
    assert(AppUpdateService.getCurrentVersion() === '3.7.3', `AppUpdateService.getCurrentVersion() is "3.7.3" (got: "${AppUpdateService.getCurrentVersion()}")`);
  });

  console.log('================================================================');
  console.log(`NOMENCLATURE & BRANDING SUMMARY: ${passed}/${passed + failed} Tests Passed (${failed} Failed)`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runNomenclatureTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
