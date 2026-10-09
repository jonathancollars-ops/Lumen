import './setup_env';
import { parseSemver, compareSemver, isNewerVersion, bumpVersion, APP_VERSION } from '../src/utils/version';
import { AppUpdateService } from '../src/services/AppUpdateService';
import { SecuritySanitizer } from '../src/services/SecuritySanitizer';
import { AppUpdateInfo, VersionBumpType } from '../src/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  totalTests++;
  if (actual === expected) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${message} (Expected: ${expected}, Got: ${actual})`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runSemverAndAutoUpdateTests() {
  console.log('================================================================');
  console.log('🚀 LUMEN 3.1: SEMVER & APP AUTO-UPDATER TEST SUITE');
  console.log('================================================================\n');

  // --- 1. SemVer Parsing Tests ---
  console.log('--- 1. Semantic Version Parsing (parseSemver) ---');
  {
    const p1 = parseSemver('3.1.0');
    assertEqual(p1.major, 3, 'Major is 3');
    assertEqual(p1.minor, 1, 'Minor is 1');
    assertEqual(p1.patch, 0, 'Patch is 0');
    assertEqual(p1.raw, '3.1.0', 'Raw normalized is 3.1.0');

    const p2 = parseSemver('v3.2.24');
    assertEqual(p2.major, 3, 'v3.2.24 -> Major is 3');
    assertEqual(p2.minor, 2, 'v3.2.24 -> Minor is 2');
    assertEqual(p2.patch, 24, 'v3.2.24 -> Patch is 24');

    const p3 = parseSemver('4.0.0-rc1');
    assertEqual(p3.major, 4, '4.0.0-rc1 -> Major is 4');
    assertEqual(p3.minor, 0, '4.0.0-rc1 -> Minor is 0');
    assertEqual(p3.patch, 0, '4.0.0-rc1 -> Patch is 0');
    assertEqual(p3.build, 0, '4.0.0-rc1 -> Build is 0');

    const pBuild = parseSemver('v3.3.0-build-54');
    assertEqual(pBuild.major, 3, 'v3.3.0-build-54 -> Major is 3');
    assertEqual(pBuild.minor, 3, 'v3.3.0-build-54 -> Minor is 3');
    assertEqual(pBuild.patch, 0, 'v3.3.0-build-54 -> Patch is 0');
    assertEqual(pBuild.build, 54, 'v3.3.0-build-54 -> Build is 54');

    const p4 = parseSemver('');
    assertEqual(p4.raw, '0.0.0', 'Empty string safely yields 0.0.0');
    assertEqual(p4.build, 0, 'Empty string build is 0');

    const p5 = parseSemver(null as any);
    assertEqual(p5.raw, '0.0.0', 'Null safely yields 0.0.0');
    assertEqual(p5.build, 0, 'Null safely yields build 0');
  }

  // --- 2. SemVer Comparison Tests ---
  console.log('\n--- 2. Semantic Version Comparison (compareSemver & isNewerVersion) ---');
  {
    assertEqual(compareSemver('3.1.0', '3.0.0'), 1, '3.1.0 > 3.0.0');
    assertEqual(compareSemver('3.0.0', '3.1.0'), -1, '3.0.0 < 3.1.0');
    assertEqual(compareSemver('3.1.0', '3.1.0'), 0, '3.1.0 === 3.1.0');
    assertEqual(compareSemver('v3.1.0', '3.1.0'), 0, 'v3.1.0 === 3.1.0 (ignores prefix)');

    // Patch comparison
    assertEqual(compareSemver('3.1.1', '3.1.0'), 1, '3.1.1 > 3.1.0 (patch update)');
    assertEqual(compareSemver('3.1.0', '3.1.1'), -1, '3.1.0 < 3.1.1');

    // Minor comparison
    assertEqual(compareSemver('3.3.0', '3.1.99'), 1, '3.3.0 > 3.1.99 (minor takes precedence)');

    // Major comparison
    assertEqual(compareSemver('4.0.0', '3.99.99'), 1, '4.0.0 > 3.99.99 (major takes precedence)');

    // Build tiebreaker comparison
    assertEqual(compareSemver('v3.4.0-build-54', 'v3.4.0-build-53'), 1, 'v3.4.0-build-54 > v3.4.0-build-53 (build tiebreaker)');
    assertEqual(compareSemver('v3.4.0-build-53', 'v3.4.0-build-54'), -1, 'v3.4.0-build-53 < v3.4.0-build-54');
    assertEqual(compareSemver('v3.4.0-build-54', 'v3.4.0'), 0, 'v3.4.0-build-54 == v3.4.0 (local without build is official, not inferior to test build)');
    assertEqual(compareSemver('v3.4.0', 'v3.4.0-build-54'), 1, 'v3.4.0 > v3.4.0-build-54 (official release superior to test build)');
    assertEqual(compareSemver('v3.4.0-build-54', 'v3.4.0-build-54'), 0, 'Equal versions and builds yield 0');

    // isNewerVersion tests
    assert(isNewerVersion('3.1.1', '3.1.0'), '3.1.1 is newer than 3.1.0');
    assert(isNewerVersion('3.3.0', '3.1.0'), '3.3.0 is newer than 3.1.0');
    assert(isNewerVersion('4.0.0', '3.1.0'), '4.0.0 is newer than 3.1.0');
    assert(!isNewerVersion('3.1.0', '3.1.0'), '3.1.0 is NOT newer than 3.1.0');
    assert(!isNewerVersion('3.0.9', '3.1.0'), '3.0.9 is NOT newer than 3.1.0');
    assert(!isNewerVersion('v3.4.0-build-54', '3.4.0'), 'v3.4.0-build-54 is NOT newer than official 3.4.0');
    assert(isNewerVersion('v3.4.0-build-54', 'v3.4.0-build-53'), 'v3.4.0-build-54 is newer than v3.4.0-build-53');

    // Default currentVersion (APP_VERSION = '3.7.7') & False-Positive Prevention
    assertEqual(APP_VERSION, '3.7.7', 'APP_VERSION constant is exactly 3.7.7');
    assert(!isNewerVersion('3.7.7'), 'Same version 3.7.7 does not trigger update');
    assert(!isNewerVersion('3.4.0'), 'Older version 3.4.0 does not trigger update');
    assert(!isNewerVersion('3.7.0'), 'Older version 3.7.0 does not trigger update');
    assert(!isNewerVersion('v3.7.7-build-55'), 'Remote build tag does NOT trigger false-positive update for official 3.7.7 users');
    assert(!isNewerVersion('v3.7.7-build-99'), 'Remote build 99 does NOT trigger update for official 3.7.7 release');
    assert(isNewerVersion('3.7.8'), 'Newer patch 3.7.8 triggers update for 3.7.7');
    assert(isNewerVersion('3.8.0'), 'Newer minor 3.8.0 triggers update for 3.7.7');
    assert(isNewerVersion('4.0.0'), 'Newer major 4.0.0 triggers update for 3.7.7');
    assert(isNewerVersion('v3.7.8-build-1'), 'Newer patch with build tag triggers update for 3.7.7');
    assert(isNewerVersion('v3.7.7', '3.7.7-build-54'), 'Official 3.7.7 triggers upgrade for test build 54 user');
  }

  // --- 3. Strict SemVer Increment Rules (bumpVersion) ---
  console.log('\n--- 3. Strict SemVer Incrementing Rules (bumpVersion) ---');
  {
    // Rule 1: Patch +0.0.1 (bugfixes, UI tweaks)
    const patchNext = bumpVersion('3.1.0', 'patch');
    assertEqual(patchNext, '3.1.1', 'Patch increment from 3.1.0 -> 3.1.1 (+0.0.1)');

    const patchNext2 = bumpVersion('3.1.9', 'patch');
    assertEqual(patchNext2, '3.1.10', 'Patch increment from 3.1.9 -> 3.1.10');

    // Rule 2: Minor +0.1.0 (medium features / additions, resets patch)
    const minorNext = bumpVersion('3.1.5', 'minor');
    assertEqual(minorNext, '3.2.0', 'Minor increment from 3.1.5 -> 3.3.0 (+0.1.0 and patch reset to 0)');

    // Rule 3: Major +1.0.0 (major overhauls, resets minor and patch)
    const majorNext = bumpVersion('3.4.7', 'major');
    assertEqual(majorNext, '4.0.0', 'Major increment from 3.4.7 -> 4.0.0 (+1.0.0 and resets minor/patch)');
  }

  // --- 4. AppUpdateService Unit Tests ---
  console.log('\n--- 4. AppUpdateService Mock Tests & Ignored Versions ---');
  {
    // Current version assertion
    assertEqual(AppUpdateService.getCurrentVersion(), '3.7.7', 'Current version is 3.7.7');

    // State persistence & ignore version
    await AppUpdateService.ignoreVersion('3.7.7');
    const state = await AppUpdateService.getUpdateState();
    assertEqual(state.ignoredVersion, '3.7.7', 'Ignored version persisted correctly');

    // Prompt cooldown checks
    await AppUpdateService.saveUpdateState({ lastPromptDismissedAt: undefined });
    const canPromptInitial = await AppUpdateService.shouldShowAutomaticPrompt();
    assert(canPromptInitial, 'shouldShowAutomaticPrompt returns true when no prompt has been dismissed');

    await AppUpdateService.recordPromptDismissed();
    const canPromptDismissed = await AppUpdateService.shouldShowAutomaticPrompt();
    assert(!canPromptDismissed, 'shouldShowAutomaticPrompt returns false immediately after recordPromptDismissed');

    // Reset state
    await AppUpdateService.saveUpdateState({ ignoredVersion: undefined, lastCheckedAt: undefined, lastPromptDismissedAt: undefined });
    const resetState = await AppUpdateService.getUpdateState();
    assert(resetState.ignoredVersion === undefined, 'State reset safely');
  }

  // --- 5. Network & Offline Resilience ---
  console.log('\n--- 5. Offline & Network Resilience ---');
  {
    // Calling openDownloadUrl with empty or invalid url returns false without crash
    const resEmpty = await AppUpdateService.openDownloadUrl('');
    assertEqual(resEmpty, false, 'openDownloadUrl with empty string returns false safely');

    const resMalicious = await AppUpdateService.openDownloadUrl("javascript:alert('xss')");
    assertEqual(resMalicious, false, 'openDownloadUrl with javascript scheme returns false safely');

    const resFile = await AppUpdateService.openDownloadUrl('file:///etc/passwd');
    assertEqual(resFile, false, 'openDownloadUrl with file scheme returns false safely');

    // Sanitizer directly protects URLs
    assertEqual(SecuritySanitizer.sanitizeUrl('javascript:void(0)'), '', 'SecuritySanitizer blocks javascript');
    assertEqual(SecuritySanitizer.sanitizeUrl('file:///c:/passwords.txt'), '', 'SecuritySanitizer blocks file');
    assertEqual(
      SecuritySanitizer.sanitizeUrl('https://github.com/organiza/lumen.apk'),
      'https://github.com/organiza/lumen.apk',
      'SecuritySanitizer preserves valid HTTPS APK url'
    );
  }

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passedTests}/${totalTests} Tests Passed (${failedTests} Failed)`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSemverAndAutoUpdateTests().catch(err => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
