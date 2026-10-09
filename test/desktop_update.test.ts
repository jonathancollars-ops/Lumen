import './setup_env';
import fs from 'fs';
import path from 'path';
import { Platform } from 'react-native';
import { AppUpdateService } from '../src/services/AppUpdateService';
import { SecuritySanitizer } from '../src/services/SecuritySanitizer';
import { mockTauriState, resetMockTauriState, memoryStore } from './setup_env';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string): void {
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

async function testSection(name: string, fn: () => Promise<void> | void): Promise<void> {
  console.log(`\n================================================================`);
  console.log(`💻 DESKTOP UPDATE SUITE: ${name}`);
  console.log(`================================================================`);
  await fn();
}

async function runDesktopUpdateTests(): Promise<void> {
  console.log('################################################################');
  console.log('🚀 NATIVE DESKTOP UPDATER (WINDOWS TAURI) - TEST SUITE');
  console.log('################################################################');

  const origPlatformOS = Platform.OS;

  try {
    // ========================================================================
    // 1. Platform Detection (isDesktop)
    // ========================================================================
    await testSection('Platform Detection - AppUpdateService.isDesktop()', () => {
      (Platform as any).OS = 'windows';
      assert(AppUpdateService.isDesktop() === true, 'isDesktop() returns true when Platform.OS is windows');

      (Platform as any).OS = 'macos';
      assert(AppUpdateService.isDesktop() === true, 'isDesktop() returns true when Platform.OS is macos');

      (Platform as any).OS = 'android';
      assert(AppUpdateService.isDesktop() === false, 'isDesktop() returns false on android');

      (Platform as any).OS = 'ios';
      assert(AppUpdateService.isDesktop() === false, 'isDesktop() returns false on ios');

      (Platform as any).OS = 'web';
      // In setup_env, window.__TAURI_INTERNALS__ is present
      assert(AppUpdateService.isDesktop() === true, 'isDesktop() returns true on web with Tauri internals available');
    });

    // ========================================================================
    // 2. Asset Resolution for Desktop vs Mobile
    // ========================================================================
    await testSection('GitHub Release Asset Resolution (Desktop vs Mobile)', async () => {
      const origFetch = (globalThis as any).fetch;

      try {
        // 2.1 Desktop finds setup .exe with highest priority
        (Platform as any).OS = 'windows';
        (globalThis as any).fetch = async () => ({
          ok: true,
          json: async () => ({
            tag_name: 'v3.9.0',
            name: 'Lumen v3.9.0',
            body: 'Atualização de desktop.',
            html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
            assets: [
              {
                name: 'lumen-setup.exe',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen-setup.exe',
              },
              {
                name: 'lumen.exe',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.exe',
              },
              {
                name: 'lumen.msi',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.msi',
              },
              {
                name: 'lumen.apk',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.apk',
              },
            ],
          }),
        });

        const updateWithSetup = await AppUpdateService.checkForUpdates(true);
        assert(updateWithSetup !== null, 'checkForUpdates(true) finds update for desktop');
        assert(updateWithSetup?.hasUpdate === true, 'hasUpdate is true');
        assert(
          updateWithSetup?.downloadUrl === 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen-setup.exe',
          'Prioritizes *-setup.exe over generic .exe and .msi on Desktop'
        );

        // 2.2 Desktop prefers MSI over an ambiguous generic executable
        (globalThis as any).fetch = async () => ({
          ok: true,
          json: async () => ({
            tag_name: 'v3.9.0',
            name: 'Lumen v3.9.0',
            body: 'Atualização de desktop.',
            html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
            assets: [
              {
                name: 'lumen.exe',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.exe',
              },
              {
                name: 'lumen.msi',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.msi',
              },
            ],
          }),
        });

        const updateWithExe = await AppUpdateService.checkForUpdates(true);
        assert(
          updateWithExe?.downloadUrl === 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.msi',
          'Picks MSI when setup .exe is not present'
        );

        // 2.3 Desktop finds .msi if no .exe is available
        (globalThis as any).fetch = async () => ({
          ok: true,
          json: async () => ({
            tag_name: 'v3.9.0',
            name: 'Lumen v3.9.0',
            body: 'Atualização de desktop.',
            html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
            assets: [
              {
                name: 'lumen.msi',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.msi',
              },
            ],
          }),
        });

        const updateWithMsi = await AppUpdateService.checkForUpdates(true);
        assert(
          updateWithMsi?.downloadUrl === 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.msi',
          'Picks .msi when .exe is not present'
        );

        // 2.4 Desktop falls back to release html_url when no desktop asset is present
        (globalThis as any).fetch = async () => ({
          ok: true,
          json: async () => ({
            tag_name: 'v3.9.0',
            name: 'Lumen v3.9.0',
            body: 'Apenas APK nesta release.',
            html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
            assets: [
              {
                name: 'lumen.apk',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.apk',
              },
            ],
          }),
        });

        const updateFallback = await AppUpdateService.checkForUpdates(true);
        assert(
          updateFallback?.downloadUrl === 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
          'Falls back to html_url release page if no .exe or .msi is present'
        );

        // 2.5 Android platform preserves APK asset selection and ignores desktop binaries
        (Platform as any).OS = 'android';
        (globalThis as any).fetch = async () => ({
          ok: true,
          json: async () => ({
            tag_name: 'v3.9.0',
            name: 'Lumen v3.9.0',
            body: 'Release multiplataforma.',
            html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
            assets: [
              {
                name: 'lumen-setup.exe',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen-setup.exe',
              },
              {
                name: 'lumen.apk',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.apk',
              },
            ],
          }),
        });

        const updateAndroid = await AppUpdateService.checkForUpdates(true);
        assert(
          updateAndroid?.downloadUrl === 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen.apk',
          'Android platform consistently chooses .apk and ignores .exe'
        );
      } finally {
        (globalThis as any).fetch = origFetch;
      }
    });

    // ========================================================================
    // 3. downloadAndInstallDesktop via Tauri Backend
    // ========================================================================
    await testSection('downloadAndInstallDesktop() Execution and Progress Tracking', async () => {
      (Platform as any).OS = 'windows';
      resetMockTauriState();

      // 3.1 Non-installer URL triggers browser fallback
      let openedBrowser = false;
      const origOpen = AppUpdateService.openDownloadUrl;
      AppUpdateService.openDownloadUrl = async () => {
        openedBrowser = true;
      };

      try {
        const fallbackRes = await AppUpdateService.downloadAndInstallDesktop(
          'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0'
        );
        assert(fallbackRes.success === false, 'Returns success: false for non-binary web page URL');
        assert(openedBrowser === true, 'Calls openDownloadUrl for non-installer web URL');
        assert(
          fallbackRes.error?.includes('Navegador') || fallbackRes.error?.includes('navegador'),
          'Informs user about browser fallback'
        );
      } finally {
        AppUpdateService.openDownloadUrl = origOpen;
      }

      // 3.2 Valid .exe URL invokes Tauri backend and tracks progress
      resetMockTauriState();
      const progressUpdates: number[] = [];
      const testDownloadUrl = 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen-setup.exe';

      const downloadResult = await AppUpdateService.downloadAndInstallDesktop(
        testDownloadUrl,
        (progress, total, downloaded) => {
          progressUpdates.push(progress);
        }
      );

      assert(downloadResult.success === true, 'downloadAndInstallDesktop() returns success: true on completion');
      assert(
        mockTauriState.desktopInstallerDownloadedUrl === testDownloadUrl,
        'Invoked Tauri download_and_run_desktop_installer with target URL'
      );
      assert(progressUpdates.length >= 2, 'Received progress event updates from Tauri');
      assert(progressUpdates[progressUpdates.length - 1] === 1.0, 'Final progress event is 100% (1.0)');

      // 3.3 Cancellation flow
      resetMockTauriState();
      AppUpdateService.cancelDesktopDownload();
      AppUpdateService.cancelDownload();
      // Verify cancel flag resets on subsequent call
      const freshResult = await AppUpdateService.downloadAndInstallDesktop(testDownloadUrl);
      assert(freshResult.success === true, 'Subsequent download starts cleanly after previous cancellation');
    });

    // ========================================================================
    // 4. Modal Adaptivity & UI Text Verification
    // ========================================================================
    await testSection('AppUpdateModal Adaptivity and Text Checks', () => {
      const modalPath = path.resolve(__dirname, '../src/components/AppUpdateModal.tsx');
      assert(fs.existsSync(modalPath), 'AppUpdateModal.tsx exists');
      const content = fs.readFileSync(modalPath, 'utf8');

      assert(
        content.includes('Baixando instalador do Windows...'),
        'Modal includes Desktop download subtitle "Baixando instalador do Windows..."'
      );
      assert(
        content.includes('Instalar Atualização (.exe)'),
        'Modal includes Desktop action button "Instalar Atualização (.exe)"'
      );
      assert(
        content.includes('Instalar APK'),
        'Modal maintains Android action button "Instalar APK"'
      );
      assert(
        content.includes('downloadAndInstallDesktop'),
        'Modal calls downloadAndInstallDesktop on desktop environment'
      );
      assert(
        content.includes('!isDesktop') && content.includes('keystoreNoticeCard'),
        'Modal suppresses Android keystore warning card on desktop platform'
      );
    });

    // ========================================================================
    // 5. Rust Tauri Backend Structure Verification
    // ========================================================================
    await testSection('Rust Tauri Backend Implementation', () => {
      const updaterRsPath = path.resolve(__dirname, '../src-tauri/src/desktop_updater.rs');
      assert(fs.existsSync(updaterRsPath), 'src-tauri/src/desktop_updater.rs exists');
      const updaterContent = fs.readFileSync(updaterRsPath, 'utf8');

      assert(
        updaterContent.includes('download_and_run_desktop_installer'),
        'desktop_updater.rs implements download_and_run_desktop_installer command'
      );
      assert(
        updaterContent.includes('desktop-update-progress'),
        'desktop_updater.rs emits desktop-update-progress event'
      );
      assert(
        updaterContent.includes('std::env::temp_dir'),
        'desktop_updater.rs downloads to sanitized temp_dir'
      );
      assert(
        updaterContent.includes('app.exit(0)'),
        'desktop_updater.rs exits application gracefully for installer execution'
      );

      const libRsPath = path.resolve(__dirname, '../src-tauri/src/lib.rs');
      assert(fs.existsSync(libRsPath), 'src-tauri/src/lib.rs exists');
      const libContent = fs.readFileSync(libRsPath, 'utf8');

      assert(
        libContent.includes('desktop_updater::download_and_run_desktop_installer'),
        'src-tauri/src/lib.rs registers download_and_run_desktop_installer command'
      );

      const cargoTomlPath = path.resolve(__dirname, '../src-tauri/Cargo.toml');
      assert(fs.existsSync(cargoTomlPath), 'src-tauri/Cargo.toml exists');
      const cargoContent = fs.readFileSync(cargoTomlPath, 'utf8');

      assert(
        cargoContent.includes('"stream"'),
        'src-tauri/Cargo.toml enables reqwest stream feature for progress streaming'
      );
    });

    // ========================================================================
    // 6. Security & URL Sanitization Defense
    // ========================================================================
    await testSection('Security & URL Sanitization Defense (SecuritySanitizer & Schemes)', async () => {
      // 6.1 SecuritySanitizer.sanitizeUrl filters malicious schemes and characters
      assert(SecuritySanitizer.sanitizeUrl("javascript:alert('xss')") === '', 'Blocks javascript: scheme');
      assert(SecuritySanitizer.sanitizeUrl('file:///C:/Windows/System32/cmd.exe') === '', 'Blocks file:// scheme');
      assert(SecuritySanitizer.sanitizeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==') === '', 'Blocks data: scheme');
      assert(SecuritySanitizer.sanitizeUrl('vbscript:msgbox("pwned")') === '', 'Blocks vbscript: scheme');
      assert(SecuritySanitizer.sanitizeUrl('https://github.com/<script>alert(1)</script>/malicious.exe') === '', 'Blocks URLs containing script tags');
      assert(SecuritySanitizer.sanitizeUrl('https://github.com/test"onclick="evil()/app.exe') === '', 'Blocks URLs containing double quotes / attributes');
      assert(SecuritySanitizer.sanitizeUrl('https://github.com/test\x00nullbyte/app.exe') === '', 'Blocks URLs containing unprintable control characters');
      assert(SecuritySanitizer.sanitizeUrl('') === '', 'Empty string returns empty string');
      assert(SecuritySanitizer.sanitizeUrl(null) === '', 'Null returns empty string');
      assert(SecuritySanitizer.sanitizeUrl(undefined) === '', 'Undefined returns empty string');

      const validHttps = 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen-setup.exe';
      assert(SecuritySanitizer.sanitizeUrl(validHttps) === validHttps, 'Preserves valid HTTPS release asset URL');

      const validHttp = 'http://updates.lumen.app/download/v3.9.0/setup.exe';
      assert(SecuritySanitizer.sanitizeUrl(validHttp) === validHttp, 'Preserves valid HTTP download URL');

      // 6.2 AppUpdateService.openDownloadUrl blocks malicious URLs
      assert((await AppUpdateService.openDownloadUrl("javascript:alert(1)")) === false, 'openDownloadUrl rejects javascript: scheme');
      assert((await AppUpdateService.openDownloadUrl('file:///C:/autoexec.bat')) === false, 'openDownloadUrl rejects file:// scheme');
      assert((await AppUpdateService.openDownloadUrl('data:text/plain;base64,dGVzdA==')) === false, 'openDownloadUrl rejects data: scheme');
      assert((await AppUpdateService.openDownloadUrl('')) === false, 'openDownloadUrl rejects empty string');

      // 6.3 AppUpdateService.downloadAndInstallDesktop blocks malicious URLs before IPC
      resetMockTauriState();
      const maliciousDesktopRes1 = await AppUpdateService.downloadAndInstallDesktop("javascript:alert('pwn')");
      assert(maliciousDesktopRes1.success === false, 'downloadAndInstallDesktop rejects javascript: URL');
      assert(
        maliciousDesktopRes1.error === 'URL de download inválida ou não fornecida.',
        'Returns invalid URL error for javascript: URL'
      );
      assert(
        mockTauriState.desktopInstallerDownloadedUrl === null,
        'Tauri IPC was NOT invoked with malicious javascript URL'
      );

      const maliciousDesktopRes2 = await AppUpdateService.downloadAndInstallDesktop('file:///C:/malicious.exe');
      assert(maliciousDesktopRes2.success === false, 'downloadAndInstallDesktop rejects file:// URL');
      assert(
        mockTauriState.desktopInstallerDownloadedUrl === null,
        'Tauri IPC was NOT invoked with malicious file URL'
      );

      const maliciousDesktopRes3 = await AppUpdateService.downloadAndInstallDesktop('');
      assert(maliciousDesktopRes3.success === false, 'downloadAndInstallDesktop rejects empty URL');

      // 6.4 AppUpdateService.downloadUpdateApk blocks malicious URLs
      const maliciousApkRes = await AppUpdateService.downloadUpdateApk("javascript:alert('apk')", () => {});
      assert(maliciousApkRes.success === false, 'downloadUpdateApk rejects javascript: URL');
      assert(
        maliciousApkRes.error === 'URL de download inválida ou não fornecida.',
        'downloadUpdateApk returns descriptive error on unsafe URL'
      );

      // 6.5 Defensive check when GitHub release payload returns malicious asset URL
      const origFetch = (globalThis as any).fetch;
      try {
        (Platform as any).OS = 'windows';
        (globalThis as any).fetch = async () => ({
          ok: true,
          json: async () => ({
            tag_name: 'v3.9.0',
            name: 'Lumen Malicious Release',
            body: 'Release notes',
            html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
            assets: [
              {
                name: 'malicious-setup.exe',
                browser_download_url: "javascript:eval('document.location=bad')",
              },
            ],
          }),
        });

        const updateRes = await AppUpdateService.checkForUpdates(true);
        assert(updateRes !== null, 'checkForUpdates completes despite malicious asset URL');
        assert(
          updateRes?.downloadUrl === 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
          'Sanitizes away malicious asset URL and safely falls back to safe release html_url'
        );
      } finally {
        (globalThis as any).fetch = origFetch;
      }
    });

    // ========================================================================
    // 7. Defensive Fallback & Resilient Error Handling
    // ========================================================================
    await testSection('Defensive Fallback & Resilient Error Handling (Missing Assets & API Errors)', async () => {
      const origFetch = (globalThis as any).fetch;
      try {
        (Platform as any).OS = 'windows';

        // 7.1 Release with empty assets array
        (globalThis as any).fetch = async () => ({
          ok: true,
          json: async () => ({
            tag_name: 'v3.9.0',
            name: 'Lumen v3.9.0 (No Assets)',
            body: 'Sem assets compilados ainda.',
            html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
            assets: [],
          }),
        });

        const noAssetsUpdate = await AppUpdateService.checkForUpdates(true);
        assert(noAssetsUpdate !== null, 'Update check succeeds when assets array is empty');
        assert(noAssetsUpdate?.hasUpdate === true, 'hasUpdate is true');
        assert(
          noAssetsUpdate?.downloadUrl === 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
          'downloadUrl falls back to release html_url when assets is empty'
        );

        // 7.2 Calling downloadAndInstallDesktop with that fallback web page triggers browser open
        let browserOpened = false;
        const origOpen = AppUpdateService.openDownloadUrl;
        AppUpdateService.openDownloadUrl = async () => {
          browserOpened = true;
          return true;
        };

        try {
          const installRes = await AppUpdateService.downloadAndInstallDesktop(noAssetsUpdate!.downloadUrl);
          assert(installRes.success === false, 'Returns success: false for non-binary web page URL');
          assert(browserOpened === true, 'Redirects to browser via openDownloadUrl');
          assert(
            installRes.error?.includes('Navegador') || installRes.error?.includes('navegador'),
            'Reports redirection to browser in error message'
          );
        } finally {
          AppUpdateService.openDownloadUrl = origOpen;
        }

        // 7.3 Corrupted assets items (null, undefined, invalid objects, non-matching files)
        (globalThis as any).fetch = async () => ({
          ok: true,
          json: async () => ({
            tag_name: 'v3.9.0',
            name: 'Lumen v3.9.0',
            body: 'Notas de versão.',
            html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
            assets: [
              null,
              undefined,
              {},
              { name: 12345 },
              { name: 'document.pdf', browser_download_url: 'https://github.com/org/repo/doc.pdf' },
              { name: 'source.tar.gz', browser_download_url: 'https://github.com/org/repo/source.tar.gz' },
            ],
          }),
        });

        const corruptedAssetsUpdate = await AppUpdateService.checkForUpdates(true);
        assert(corruptedAssetsUpdate !== null, 'Handles malformed and null assets without throwing');
        assert(
          corruptedAssetsUpdate?.downloadUrl === 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
          'Safely falls back to release html_url when none of the assets match .exe/.msi'
        );

        // 7.4 Upstream HTTP 404 / 500 error returns null safely
        (globalThis as any).fetch = async () => ({
          ok: false,
          status: 404,
          json: async () => ({ message: 'Not Found' }),
        });
        const notFoundRes = await AppUpdateService.checkForUpdates(true);
        assert(notFoundRes === null, 'Returns null safely on HTTP 404');

        (globalThis as any).fetch = async () => ({
          ok: false,
          status: 500,
          json: async () => ({ message: 'Internal Server Error' }),
        });
        const serverErrorRes = await AppUpdateService.checkForUpdates(true);
        assert(serverErrorRes === null, 'Returns null safely on HTTP 500');

        // 7.5 Upstream Network Abort / Throw returns null silently
        (globalThis as any).fetch = async () => {
          throw new Error('Network request failed: timeout');
        };
        const networkErrorRes = await AppUpdateService.checkForUpdates(true);
        assert(networkErrorRes === null, 'Returns null safely on network connection error');

        // 7.6 Malformed release JSON (missing tag_name)
        (globalThis as any).fetch = async () => ({
          ok: true,
          json: async () => ({ invalid_schema: true }),
        });
        const invalidJsonRes = await AppUpdateService.checkForUpdates(true);
        assert(invalidJsonRes === null, 'Returns null safely when tag_name is missing');
      } finally {
        (globalThis as any).fetch = origFetch;
      }
    });

    // ========================================================================
    // 8. Update State Persistence, Cooldown & Throttling
    // ========================================================================
    await testSection('Update State Persistence, Cooldown & Throttling', async () => {
      // 8.1 Corrupted storage resilience
      memoryStore['@lumen_update_state'] = 'INVALID_JSON{{{';
      const stateBadJson = await AppUpdateService.getUpdateState();
      assert(typeof stateBadJson === 'object' && stateBadJson !== null, 'getUpdateState handles invalid JSON safely');

      memoryStore['@lumen_update_state'] = 'null';
      const stateNullStr = await AppUpdateService.getUpdateState();
      assert(typeof stateNullStr === 'object' && stateNullStr !== null, 'getUpdateState handles literal "null" string');

      memoryStore['@lumen_update_state'] = '[1, 2, 3]';
      const stateArrayStr = await AppUpdateService.getUpdateState();
      assert(typeof stateArrayStr === 'object' && !Array.isArray(stateArrayStr), 'getUpdateState handles array payload safely');

      // 8.2 24-hour prompt cooldown mechanics
      delete memoryStore['@lumen_update_state'];
      const initialPrompt = await AppUpdateService.shouldShowAutomaticPrompt();
      assert(initialPrompt === true, 'shouldShowAutomaticPrompt() returns true on fresh state');

      await AppUpdateService.recordPromptDismissed();
      const promptAfterDismiss = await AppUpdateService.shouldShowAutomaticPrompt();
      assert(promptAfterDismiss === false, 'shouldShowAutomaticPrompt() returns false right after recordPromptDismissed()');

      // Simulate 12 hours passed (< 24h)
      await AppUpdateService.saveUpdateState({
        lastPromptDismissedAt: Date.now() - 12 * 60 * 60 * 1000,
      });
      const promptAfter12h = await AppUpdateService.shouldShowAutomaticPrompt();
      assert(promptAfter12h === false, 'shouldShowAutomaticPrompt() remains false after 12 hours');

      // Simulate 25 hours passed (> 24h)
      await AppUpdateService.saveUpdateState({
        lastPromptDismissedAt: Date.now() - 25 * 60 * 60 * 1000,
      });
      const promptAfter25h = await AppUpdateService.shouldShowAutomaticPrompt();
      assert(promptAfter25h === true, 'shouldShowAutomaticPrompt() returns true after 25 hours');

      // 8.3 3-hour automatic check throttle (AUTO_CHECK_INTERVAL_MS)
      const origFetch = (globalThis as any).fetch;
      try {
        (Platform as any).OS = 'windows';
        let fetchCallsCount = 0;
        (globalThis as any).fetch = async () => {
          fetchCallsCount++;
          return {
            ok: true,
            json: async () => ({
              tag_name: 'v3.9.0',
              name: 'Lumen v3.9.0',
              body: 'Notas de versão 3.9.0',
              html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.0',
              assets: [
                {
                  name: 'lumen-setup.exe',
                  browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.0/lumen-setup.exe',
                },
              ],
            }),
          };
        };

        // Reset state
        delete memoryStore['@lumen_update_state'];
        fetchCallsCount = 0;

        // First automatic check (force = false)
        const check1 = await AppUpdateService.checkForUpdates(false);
        assert(check1 !== null && check1.hasUpdate === true, 'First automatic check executes and finds update');
        assert(fetchCallsCount === 1, 'Invoked fetch once on first check');

        // Immediate subsequent automatic check (force = false) within 3 hours
        const check2 = await AppUpdateService.checkForUpdates(false);
        assert(check2 === null, 'Immediate second automatic check is throttled and returns null');
        assert(fetchCallsCount === 1, 'Did NOT make second fetch call due to 3h throttle');

        // Forced check (force = true) bypasses throttle
        const check3 = await AppUpdateService.checkForUpdates(true);
        assert(check3 !== null && check3.hasUpdate === true, 'Forced check bypasses 3h throttle');
        assert(fetchCallsCount === 2, 'Invoked fetch on forced check');

        // Simulate 4 hours passed (> 3h)
        await AppUpdateService.saveUpdateState({
          lastCheckedAt: Date.now() - 4 * 60 * 60 * 1000,
        });
        const check4 = await AppUpdateService.checkForUpdates(false);
        assert(check4 !== null && check4.hasUpdate === true, 'Automatic check executes after 4 hours elapsed');
        assert(fetchCallsCount === 3, 'Invoked fetch after 3h throttle window expired');

        // 8.4 ignoreVersion mechanics
        // User ignores version 3.9.0
        await AppUpdateService.ignoreVersion('3.9.0');
        const stateIgnored = await AppUpdateService.getUpdateState();
        assert(stateIgnored.ignoredVersion === '3.9.0', 'ignoreVersion persists 3.9.0 in storage');

        // Reset check timestamp so throttle is not the reason
        await AppUpdateService.saveUpdateState({ lastCheckedAt: 0 });

        // Automatic check with ignored version returns null
        const checkIgnored = await AppUpdateService.checkForUpdates(false);
        assert(checkIgnored === null, 'Automatic check returns null when remote version matches ignoredVersion');

        // Manual check with force=true bypasses ignored version
        const checkIgnoredForced = await AppUpdateService.checkForUpdates(true);
        assert(checkIgnoredForced !== null && checkIgnoredForced.latestVersion === '3.9.0', 'Forced check bypasses ignoredVersion');

        // When a newer version 3.9.1 is released, automatic check works again
        (globalThis as any).fetch = async () => ({
          ok: true,
          json: async () => ({
            tag_name: 'v3.9.1',
            name: 'Lumen v3.9.1',
            body: 'Notas de versão 3.9.1',
            html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.9.1',
            assets: [
              {
                name: 'lumen-setup.exe',
                browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.9.1/lumen-setup.exe',
              },
            ],
          }),
        });

        await AppUpdateService.saveUpdateState({ lastCheckedAt: 0 });
        const checkNewer = await AppUpdateService.checkForUpdates(false);
        assert(checkNewer !== null && checkNewer.latestVersion === '3.9.1', 'Automatic check succeeds for version 3.9.1 (only 3.9.0 was ignored)');
      } finally {
        (globalThis as any).fetch = origFetch;
      }
    });

    // ========================================================================
    // 9. CI/CD Workflow Configuration & Naming Integrity Check
    // ========================================================================
    await testSection('CI/CD Workflow Configuration and Asset Naming Integrity', () => {
      const winWfPath = path.resolve(__dirname, '../.github/workflows/build-windows.yml');
      assert(fs.existsSync(winWfPath), '.github/workflows/build-windows.yml exists');
      const winWfContent = fs.readFileSync(winWfPath, 'utf8');

      // 9.1 Windows workflow collects both .exe and .msi bundles
      assert(
        winWfContent.includes('find src-tauri/target/release/bundle -type f \\( -name "*.exe" -o -name "*.msi" \\)'),
        'build-windows.yml collects both .exe and .msi bundles from target bundle'
      );
      assert(
        winWfContent.includes('lumen-v${APP_VER}-x64-setup.exe'),
        'build-windows.yml creates canonical setup name (*-setup.exe) for AppUpdateService priority'
      );
      assert(
        winWfContent.includes('lumen-v${APP_VER}-x64.msi'),
        'build-windows.yml creates canonical .msi name for AppUpdateService fallback'
      );
      assert(
        winWfContent.includes('SHA256SUMS-windows.txt'),
        'build-windows.yml generates SHA256SUMS-windows.txt checksums'
      );
      assert(
        winWfContent.includes('softprops/action-gh-release@v2'),
        'build-windows.yml uses softprops/action-gh-release@v2 to publish releases'
      );
      assert(
        winWfContent.includes('scripts/extract_release_notes.js'),
        'build-windows.yml extracts release notes via scripts/extract_release_notes.js'
      );

      // 9.2 Android workflow configuration check
      const androidWfPath = path.resolve(__dirname, '../.github/workflows/build-android.yml');
      assert(fs.existsSync(androidWfPath), '.github/workflows/build-android.yml exists');
      const androidWfContent = fs.readFileSync(androidWfPath, 'utf8');

      assert(
        androidWfContent.includes('lumen-v${APP_VER}-standalone.apk'),
        'build-android.yml generates lumen-v${APP_VER}-standalone.apk'
      );
      assert(
        androidWfContent.includes('SHA256SUMS-android.txt'),
        'build-android.yml generates SHA256SUMS-android.txt checksums'
      );
      assert(
        androidWfContent.includes('softprops/action-gh-release@v2'),
        'build-android.yml uses softprops/action-gh-release@v2 to attach standalone APK to release'
      );
      assert(
        androidWfContent.includes('scripts/extract_release_notes.js'),
        'build-android.yml extracts release notes via scripts/extract_release_notes.js'
      );
    });

  } finally {
    (Platform as any).OS = origPlatformOS;
  }

  // ========================================================================
  // FINAL SUMMARY
  // ========================================================================
  console.log('\n================================================================');
  console.log(`📊 DESKTOP UPDATER SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error(`❌ FAILED: ${failedTests} tests failed.`);
    process.exit(1);
  } else {
    console.log('🎉 ALL DESKTOP UPDATER TESTS PASSED 100% GREEN!');
    process.exit(0);
  }
}

runDesktopUpdateTests().catch((err) => {
  console.error('Fatal error running desktop update tests:', err);
  process.exit(1);
});
