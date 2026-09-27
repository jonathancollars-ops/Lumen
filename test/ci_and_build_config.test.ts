import fs from 'fs';
import path from 'path';

// Helper assertion utilities
let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition: boolean, message: string) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  totalAssertions++;
  if (actual === expected) {
    passedAssertions++;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ❌ FAIL: ${message} (Expected: ${expected}, Got: ${actual})`);
  }
}

console.log('================================================================');
console.log('🏗️  LUMEN 3.0 CI/CD & BUILD CONFIGURATION VALIDATION SUITE');
console.log('================================================================\n');

const projectRoot = path.resolve(__dirname, '..');

// -------------------------------------------------------------
// 1. GitHub Actions: build-android.yml
// -------------------------------------------------------------
console.log('--- 1. Validating .github/workflows/build-android.yml ---');
const buildAndroidWorkflowPath = path.join(projectRoot, '.github', 'workflows', 'build-android.yml');
assert(fs.existsSync(buildAndroidWorkflowPath), '.github/workflows/build-android.yml exists');

if (fs.existsSync(buildAndroidWorkflowPath)) {
  const content = fs.readFileSync(buildAndroidWorkflowPath, 'utf8');
  assert(content.includes('name: Android CI & APK Build'), 'Contains proper workflow name');
  assert(content.includes('push:') && content.includes('pull_request:') && content.includes('workflow_dispatch:'), 'Configured for push, pull_request, and workflow_dispatch triggers');
  assert(content.includes('ubuntu-latest'), 'Runs on ubuntu-latest environment');
  assert(content.includes('actions/checkout@v4'), 'Includes checkout action v4');
  assert(content.includes('actions/setup-node@v4') && content.includes('node-version: 20'), 'Sets up Node.js 20');
  assert(content.includes('actions/setup-java@v4') && content.includes('17'), 'Sets up OpenJDK 17 (Temurin)');
  assert(content.includes('android-actions/setup-android@v4'), 'Sets up Android SDK');
  assert(content.includes('npx tsc --noEmit'), 'Enforces strict TypeScript verification before build');
  assert(content.includes('npm test'), 'Executes automated test harness before build');
  assert(content.includes('chmod +x android/gradlew'), 'Grants execute permissions to Gradle wrapper');
  assert(content.includes('assembleRelease') || content.includes('assembleDebug'), 'Executes Gradle assemble task to compile APK');
  assert(content.includes('sha256sum'), 'Generates SHA-256 integrity checksum for standalone APK');
  assert(content.includes('actions/upload-artifact@v4'), 'Uploads APK artifact using actions/upload-artifact@v4');
  assert(content.includes('lumen-v3.5.2-android-apk'), 'Names artifact lumen-v3.5.2-android-apk');
}

// -------------------------------------------------------------
// 2. GitHub Actions: release.yml
// -------------------------------------------------------------
console.log('\n--- 2. Validating .github/workflows/release.yml ---');
const releaseWorkflowPath = path.join(projectRoot, '.github', 'workflows', 'release.yml');
assert(fs.existsSync(releaseWorkflowPath), '.github/workflows/release.yml exists');

if (fs.existsSync(releaseWorkflowPath)) {
  const content = fs.readFileSync(releaseWorkflowPath, 'utf8');
  assert(content.includes('name: Release Android APK'), 'Contains proper release workflow name');
  assert(content.includes("tags:\n      - 'v*'") || content.includes('tags:') && content.includes('v*'), 'Triggers on tag push (v*)');
  assert(content.includes('workflow_dispatch:'), 'Supports manual release dispatch via workflow_dispatch');
  assert(content.includes('contents: write'), 'Configured with write permissions for GitHub Releases');
  assert(content.includes('actions/checkout@v4'), 'Includes checkout action');
  assert(content.includes('actions/setup-node@v4'), 'Includes Node.js setup');
  assert(content.includes('actions/setup-java@v4') && content.includes('17'), 'Includes Java 17 setup');
  assert(content.includes('npx tsc --noEmit'), 'Runs TypeScript pre-release typecheck');
  assert(content.includes('npm test'), 'Runs pre-release test suite');
  assert(content.includes('assembleRelease') || content.includes('assembleDebug'), 'Builds APK');
  assert(content.includes('softprops/action-gh-release@v2'), 'Uses softprops/action-gh-release@v2 for publishing release');
  assert(content.includes('sha256sum') && content.includes('SHA256SUMS.txt'), 'Generates SHA256SUMS.txt release asset');
  assert(content.includes('actions/upload-artifact@v4'), 'Includes release assets backup upload');
}

// -------------------------------------------------------------
// 3. EAS Build Configuration: eas.json
// -------------------------------------------------------------
console.log('\n--- 3. Validating eas.json ---');
const easPath = path.join(projectRoot, 'eas.json');
assert(fs.existsSync(easPath), 'eas.json exists');

if (fs.existsSync(easPath)) {
  const easConfig = JSON.parse(fs.readFileSync(easPath, 'utf8'));
  assert(typeof easConfig.build === 'object', 'eas.json contains "build" object');
  
  // Preview profile (standalone APK)
  assert(typeof easConfig.build.preview === 'object', 'Contains "preview" profile');
  assertEqual(easConfig.build.preview.distribution, 'internal', 'Preview profile distribution is "internal"');
  assertEqual(easConfig.build.preview.android?.buildType, 'apk', 'Preview profile android.buildType is "apk"');
  
  // Development profile
  assert(typeof easConfig.build.development === 'object', 'Contains "development" profile');
  assertEqual(easConfig.build.development.developmentClient, true, 'Development profile has developmentClient=true');
  assertEqual(easConfig.build.development.android?.buildType, 'apk', 'Development profile android.buildType is "apk"');
  
  // Production profile
  assert(typeof easConfig.build.production === 'object', 'Contains "production" profile');
  assertEqual(easConfig.build.production.android?.buildType, 'app-bundle', 'Production profile android.buildType is "app-bundle"');
}

// -------------------------------------------------------------
// 4. App Manifest & Expo Config: app.json
// -------------------------------------------------------------
console.log('\n--- 4. Validating app.json ---');
const appJsonPath = path.join(projectRoot, 'app.json');
assert(fs.existsSync(appJsonPath), 'app.json exists');

if (fs.existsSync(appJsonPath)) {
  const appConfig = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  assert(typeof appConfig.expo === 'object', 'app.json contains "expo" object');
  assertEqual(appConfig.expo.name, 'Lumen', 'App name is "Lumen"');
  assertEqual(appConfig.expo.slug, 'lumen', 'App slug is "lumen"');
  assertEqual(appConfig.expo.version, '3.5.2', 'App version is "3.5.2"');
  
  // Android specific config
  assert(typeof appConfig.expo.android === 'object', 'Contains android config');
  assert(typeof appConfig.expo.android.package === 'string' && appConfig.expo.android.package.length > 0, 'Android package name is defined');
  
  // Permissions
  const permissions: string[] = appConfig.expo.android.permissions || [];
  assert(permissions.includes('USE_EXACT_ALARM'), 'Permissions include USE_EXACT_ALARM');
  assert(permissions.includes('SCHEDULE_EXACT_ALARM'), 'Permissions include SCHEDULE_EXACT_ALARM');
  assert(permissions.includes('VIBRATE'), 'Permissions include VIBRATE');
  assert(permissions.includes('RECEIVE_BOOT_COMPLETED'), 'Permissions include RECEIVE_BOOT_COMPLETED');
  
  // Extra EAS Project ID
  assert(typeof appConfig.expo.extra?.eas?.projectId === 'string', 'EAS projectId is configured in extra.eas.projectId');
  assert(appConfig.expo.extra.eas.projectId === '0ebf6043-6c5c-4335-a4a5-753770de3865', 'EAS projectId matches project credential');
}

// -------------------------------------------------------------
// 5. Package.json & NPM Scripts
// -------------------------------------------------------------
console.log('\n--- 5. Validating package.json ---');
const packageJsonPath = path.join(projectRoot, 'package.json');
assert(fs.existsSync(packageJsonPath), 'package.json exists');

if (fs.existsSync(packageJsonPath)) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assertEqual(pkg.name, 'lumen', 'Package name is "lumen"');
  assertEqual(pkg.version, '3.5.2', 'Package version is "3.5.2"');
  assert(pkg.scripts?.test?.includes('run_all.ts'), 'NPM test script executes test runner');
}

// -------------------------------------------------------------
// 6. Native Android Directory Structure
// NOTE: In CI the android/ folder is generated by expo prebuild
//       which runs AFTER this test step. We only validate when it exists.
// -------------------------------------------------------------
console.log('\n--- 6. Native Android Project Structure (skipped if not yet generated) ---');
const androidDir = path.join(projectRoot, 'android');
if (fs.existsSync(androidDir)) {
  assert(fs.existsSync(path.join(androidDir, 'build.gradle')), 'android/build.gradle exists');
  assert(fs.existsSync(path.join(androidDir, 'app', 'build.gradle')), 'android/app/build.gradle exists');
  assert(fs.existsSync(path.join(androidDir, 'gradlew')) || fs.existsSync(path.join(androidDir, 'gradlew.bat')), 'Gradle wrapper executable exists');
  console.log('  ℹ️  android/ directory found — native structure validated.');
} else {
  console.log('  ℹ️  android/ directory not yet generated (expected in CI pre-prebuild). Skipping native structure checks.');
}

console.log('\n================================================================');
console.log(`📊 CI & BUILD VALIDATION SUMMARY: ${passedAssertions}/${totalAssertions} ASSERTIONS PASSED`);
console.log('================================================================');

if (failedAssertions > 0) {
  console.error(`❌ FAILED: ${failedAssertions} assertions failed.`);
  process.exit(1);
} else {
  console.log('🎉 ALL CI/CD AND BUILD CONFIGURATION ASSERTIONS PASSED 100% GREEN!');
  process.exit(0);
}
