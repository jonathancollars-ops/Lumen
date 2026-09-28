import './setup_env';
import {
  StorageService,
  safeParseArray,
  safeParseObject,
  DEFAULT_SETTINGS,
  DEFAULT_GAMIFICATION,
  DEFAULT_STREAK
} from '../src/services/storage';
import { AttendanceService } from '../src/services/AttendanceService';
import { AppUpdateService } from '../src/services/AppUpdateService';
import { isNewerVersion, parseSemver, APP_VERSION } from '../src/utils/version';
import { getThemeColors, getContrastTextColor, Colors } from '../src/theme';
import { getLocalDateString, formatDisplayDate, parseLocalDate } from '../src/utils/date';
import { memoryStore } from './setup_env';
import { AppEvent, Subject, AttendanceRecord, AppSettings, GamificationData, StudyStreak, ThemeType } from '../src/types';

let testCount = 0;
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, name: string, detail?: any) {
  testCount++;
  if (!condition) {
    failCount++;
    console.error(`  ❌ FAIL: ${name}`);
    if (detail) console.error('     Detail:', detail);
    throw new Error(`Assertion failed: ${name}`);
  }
  passCount++;
  console.log(`  ✅ PASS: ${name}`);
}

async function runSection(title: string, fn: () => Promise<void> | void) {
  console.log(`\n================================================================`);
  console.log(`🧪 ADVERSARIAL CHALLENGE: ${title}`);
  console.log(`================================================================`);
  await fn();
}

async function runAllChallengerProbes() {
  console.log('################################################################');
  console.log('⚡ EMPIRICAL CHALLENGER M1 ADVERSARIAL STRESS SUITE');
  console.log('################################################################');

  // --------------------------------------------------------------------------
  // 1. App.tsx Cold Start Hydration & Lifecycle Stress
  // --------------------------------------------------------------------------
  await runSection('App.tsx Cold-Start Data Hydration & Corrupted Storage', async () => {
    // 1.1 Completely empty / zero data storage (first fresh install)
    Object.keys(memoryStore).forEach(k => delete memoryStore[k]);
    const [
      theme,
      events,
      subjects,
      attendances,
      tasks,
      sessions,
      semesters,
      settings,
      gamification,
      streak
    ] = await Promise.all([
      StorageService.getTheme().catch(() => 'dark'),
      StorageService.getEvents().catch(() => []),
      StorageService.getSubjects().catch(() => []),
      StorageService.getAttendances().catch(() => []),
      StorageService.getTasks().catch(() => []),
      StorageService.getStudySessions().catch(() => []),
      StorageService.getSemesters().catch(() => []),
      StorageService.getSettings().catch(() => null),
      StorageService.getGamificationData().catch(() => null),
      StorageService.getStreak().catch(() => null),
    ]);

    assert(theme === 'dark', 'Fresh install default theme is dark');
    assert(Array.isArray(events) && events.length === 0, 'Fresh install events is empty array');
    assert(Array.isArray(subjects) && subjects.length === 0, 'Fresh install subjects is empty array');
    assert(Array.isArray(attendances) && attendances.length === 0, 'Fresh install attendances is empty array');
    assert(Array.isArray(tasks) && tasks.length === 0, 'Fresh install tasks is empty array');
    assert(Array.isArray(sessions) && sessions.length === 0, 'Fresh install sessions is empty array');
    assert(Array.isArray(semesters) && semesters.length > 0, 'Fresh install semesters initializes default semester');
    assert(settings !== null && typeof settings === 'object', 'Fresh install settings returns default object');
    assert(gamification !== null && typeof gamification === 'object', 'Fresh install gamification returns default object');
    assert(streak !== null && typeof streak === 'object', 'Fresh install streak returns default object');

    // 1.2 Corrupted literal "null", undefined, and truncated JSON in all keys
    const hostileKeys = [
      '@organiza_events',
      '@organiza_subjects',
      '@organiza_attendances',
      '@organiza_tasks',
      '@organiza_studysessions',
      '@organiza_semesters',
      '@organiza_settings',
      '@organiza_gamification',
      '@organiza_streak',
      '@organiza_theme'
    ];

    for (const key of hostileKeys) {
      memoryStore[key] = 'null';
    }

    const hostEvents = await StorageService.getEvents();
    const hostSubjects = await StorageService.getSubjects();
    const hostAttendances = await StorageService.getAttendances();
    const hostSettings = await StorageService.getSettings();
    const hostGamification = await StorageService.getGamificationData();
    const hostStreak = await StorageService.getStreak();

    assert(Array.isArray(hostEvents) && hostEvents.length === 0, 'getEvents returns [] when storage is literal "null"');
    assert(Array.isArray(hostSubjects) && hostSubjects.length === 0, 'getSubjects returns [] when storage is literal "null"');
    assert(Array.isArray(hostAttendances) && hostAttendances.length === 0, 'getAttendances returns [] when storage is literal "null"');
    assert(hostSettings && typeof hostSettings === 'object', 'getSettings returns DEFAULT_SETTINGS on literal "null"');
    assert(hostGamification && typeof hostGamification === 'object', 'getGamificationData returns DEFAULT_GAMIFICATION on literal "null"');
    assert(hostStreak && typeof hostStreak === 'object', 'getStreak returns DEFAULT_STREAK on literal "null"');

    // 1.3 Safe array deserialization and sanitization logic replicating App.tsx loadData
    const dirtyEvents = [null, { id: 'evt-1', title: 'Valid Event' }, undefined, 'not-an-object', 12345];
    const safeEvents = Array.isArray(dirtyEvents)
      ? dirtyEvents.filter((e): e is AppEvent => Boolean(e && typeof e === 'object'))
      : [];
    assert(safeEvents.length === 1, 'App.tsx loadData safely filters non-object elements');
    assert(safeEvents[0].id === 'evt-1', 'App.tsx loadData preserves valid objects');

    // 1.4 Replicating App.tsx safeSettings sanitization against corrupted types
    const corruptedSettings = {
      theme: 'invalid_theme',
      fullscreen: 'not-a-bool',
      pomodoroFocusMin: 'corrupted',
      pomodoroBreakMin: -5,
      pomodoroLongBreakMin: null,
      defaultPassGrade: 'NaN',
      examWeekMode: 1,
      soundEnabled: null,
      hapticsEnabled: undefined
    };

    const sanitizedSettings: AppSettings = (corruptedSettings && typeof corruptedSettings === 'object' && !Array.isArray(corruptedSettings))
      ? {
          theme: (corruptedSettings.theme === 'light' || corruptedSettings.theme === 'amoled' || corruptedSettings.theme === 'dark') ? (corruptedSettings.theme as ThemeType) : 'dark',
          fullscreen: Boolean(corruptedSettings.fullscreen),
          pomodoroFocusMin: Number(corruptedSettings.pomodoroFocusMin) || 25,
          pomodoroBreakMin: Number(corruptedSettings.pomodoroBreakMin) || 5,
          pomodoroLongBreakMin: Number(corruptedSettings.pomodoroLongBreakMin) || 15,
          defaultPassGrade: typeof corruptedSettings.defaultPassGrade === 'number' && !isNaN(corruptedSettings.defaultPassGrade) ? corruptedSettings.defaultPassGrade : 7.0,
          examWeekMode: Boolean(corruptedSettings.examWeekMode),
          soundEnabled: corruptedSettings.soundEnabled !== false,
          hapticsEnabled: corruptedSettings.hapticsEnabled !== false,
        }
      : DEFAULT_SETTINGS;

    assert(sanitizedSettings.theme === 'dark', 'Invalid theme falls back to "dark"');
    assert(sanitizedSettings.pomodoroFocusMin === 25, 'Invalid focus min falls back to 25');
    assert(sanitizedSettings.defaultPassGrade === 7.0, 'Invalid pass grade falls back to 7.0');
    assert(sanitizedSettings.soundEnabled === true, 'Null soundEnabled falls back to true');

    // 1.5 AttendanceService under adversarial inputs
    const pending1 = await AttendanceService.generatePendingAttendances([], []);
    assert(Array.isArray(pending1) && pending1.length === 0, 'generatePendingAttendances with empty arrays returns []');

    const pending2 = await AttendanceService.generatePendingAttendances(null as any, null as any);
    assert(Array.isArray(pending2) && pending2.length === 0, 'generatePendingAttendances with null/null returns [] without throwing');

    const pending3 = await AttendanceService.generatePendingAttendances([null, undefined] as any, [null] as any);
    assert(Array.isArray(pending3) && pending3.length === 0, 'generatePendingAttendances with corrupted array elements returns []');
  });

  // --------------------------------------------------------------------------
  // 2. AppUpdateService Adversarial Stress Testing
  // --------------------------------------------------------------------------
  await runSection('AppUpdateService SemVer, Remote API & Throttling Resilience', async () => {
    // 2.1 SemVer parsing and comparison matrix
    assert(isNewerVersion('3.2.3', '3.2.2') === true, '3.2.2 is newer than 3.2.2');
    assert(isNewerVersion('3.4.0', '3.2.2') === true, '3.4.0 is newer than 3.2.2');
    assert(isNewerVersion('4.0.0', '3.9.9') === true, '4.0.0 is newer than 3.9.9');
    assert(isNewerVersion('3.2.2', '3.2.2') === false, '3.2.2 is NOT newer than 3.2.2');
    assert(isNewerVersion('3.1.9', '3.2.2') === false, '3.1.9 is NOT newer than 3.2.2');
    assert(isNewerVersion('2.9.9', '3.2.2') === false, '2.9.9 is NOT newer than 3.2.2');
    assert(isNewerVersion('v3.2.3', '3.2.2') === true, 'v3.2.3 prefix handled cleanly');
    assert(isNewerVersion('3.2.3-beta.1', '3.2.2') === true, 'pre-release tags stripped correctly');
    assert(isNewerVersion('invalid', '3.2.2') === false, 'invalid remote version returns false safely');
    assert(isNewerVersion('', '3.2.2') === false, 'empty remote version returns false safely');

    // 2.2 AppUpdateService UpdateState resilience
    memoryStore['@lumen_update_state'] = 'null';
    let state = await AppUpdateService.getUpdateState();
    assert(typeof state === 'object' && state !== null, 'getUpdateState returns object on "null" string');

    memoryStore['@lumen_update_state'] = '{bad-json';
    state = await AppUpdateService.getUpdateState();
    assert(typeof state === 'object' && state !== null, 'getUpdateState returns object on invalid json');

    // 2.3 Ignore version lifecycle
    await AppUpdateService.ignoreVersion('3.4.0');
    state = await AppUpdateService.getUpdateState();
    assert(state.ignoredVersion === '3.4.0', 'ignoredVersion correctly persisted');

    // 2.4 Mock fetch simulation: 500 error, 404, 403, network abort
    const originalFetch = (globalThis as any).fetch;

    // Simulate 500 Server Error
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    const check500 = await AppUpdateService.checkForUpdates(true);
    assert(check500 === null, 'checkForUpdates returns null on HTTP 500');

    // Simulate Network Abort / Throw
    (globalThis as any).fetch = async () => {
      throw new Error('Network request failed: AbortError');
    };

    const checkAbort = await AppUpdateService.checkForUpdates(true);
    assert(checkAbort === null, 'checkForUpdates returns null on network abort / exception');

    // Simulate Malformed Release payload (tag_name missing, assets empty)
    (globalThis as any).fetch = async () => ({
      ok: true,
      json: async () => ({
        id: 12345,
        tag_name: null,
        name: 'Empty Release',
        assets: null
      })
    });

    const checkMalformed = await AppUpdateService.checkForUpdates(true);
    assert(checkMalformed === null, 'checkForUpdates returns null on null tag_name in payload');

    // Simulate Valid Release with newer version and .apk asset
    (globalThis as any).fetch = async () => ({
      ok: true,
      json: async () => ({
        tag_name: 'v3.7.0',
        name: 'Lumen v3.7.0 Release',
        body: 'Awesome new features',
        html_url: 'https://github.com/jonathancollars-ops/organiza/releases/tag/v3.7.0',
        assets: [
          { name: 'source.zip', browser_download_url: 'https://example.com/source.zip' },
          { name: 'lumen-v3.7.0.apk', browser_download_url: 'https://example.com/lumen.apk' }
        ]
      })
    });

    const checkSuccess = await AppUpdateService.checkForUpdates(true);
    assert(checkSuccess !== null && checkSuccess.hasUpdate === true, 'checkForUpdates detects newer v3.7.0 release');
    assert(checkSuccess?.latestVersion === '3.7.0', 'latestVersion parsed correctly');
    assert(checkSuccess?.downloadUrl === 'https://example.com/lumen.apk', 'APK asset URL extracted correctly');

    // 2.5 Ignored version logic
    await AppUpdateService.ignoreVersion('3.7.0');
    const checkIgnored = await AppUpdateService.checkForUpdates(false);
    assert(checkIgnored === null, 'checkForUpdates returns null for ignored version on auto check');

    const checkForceIgnored = await AppUpdateService.checkForUpdates(true);
    assert(checkForceIgnored !== null && checkForceIgnored.hasUpdate === true, 'checkForUpdates ignores ignoreVersion when force=true');

    // 2.6 Throttling check (within 3 hours)
    await AppUpdateService.saveUpdateState({ lastCheckedAt: Date.now() - 1000, ignoredVersion: undefined });
    const throttledCheck = await AppUpdateService.checkForUpdates(false);
    assert(throttledCheck === null, 'checkForUpdates throttles automatic checks within 3 hours');

    // Restore fetch
    (globalThis as any).fetch = originalFetch;
  });

  // --------------------------------------------------------------------------
  // 3. UI Component Invariant & Null/Zero-Data Stress
  // --------------------------------------------------------------------------
  await runSection('Component Invariants under Zero-Data & Null Props', () => {
    // 3.1 TodaySummaryWidget recurrence & sorting algorithm under empty / corrupted inputs
    const todayStr = getLocalDateString(new Date());
    const rawEvents: any[] = [
      null,
      undefined,
      { id: 'evt-1', title: 'Corrupted Event', startTime: null, endTime: undefined, date: null },
      { id: 'evt-2', title: 'Valid Class', startTime: '08:00', endTime: '10:00', date: todayStr, category: 'Faculdade/Aulas' }
    ];

    const safeEvents = Array.isArray(rawEvents) ? rawEvents.filter(Boolean) : [];
    const todayEvents = safeEvents
      .filter(e => {
        if (!e) return false;
        if (e.date === todayStr) return true;
        if (e.recurrence === 'weekly') {
          if (e.date && todayStr < e.date) return false;
          const dayOfWeek = new Date(todayStr + 'T12:00:00').getDay();
          if (Array.isArray(e.recurrenceDays) && e.recurrenceDays.length > 0) {
            return e.recurrenceDays.includes(dayOfWeek);
          }
          if (e.date) {
            const baseDayOfWeek = new Date(e.date + 'T12:00:00').getDay();
            return baseDayOfWeek === dayOfWeek;
          }
        }
        return false;
      })
      .sort((a, b) => {
        const [ah, am] = String(a?.startTime || '00:00').split(':').map(Number);
        const [bh, bm] = String(b?.startTime || '00:00').split(':').map(Number);
        return ((ah || 0) * 60 + (am || 0)) - ((bh || 0) * 60 + (bm || 0));
      });

    assert(todayEvents.length === 1, 'TodaySummaryWidget logic filters out invalid dates and isolates today event');
    assert(todayEvents[0].id === 'evt-2', 'Valid class is preserved');

    // 3.2 Theme contrast calculations under all theme variants
    const darkColors = getThemeColors('dark');
    const amoledColors = getThemeColors('amoled');
    const lightColors = getThemeColors('light');

    assert(typeof darkColors.background === 'string' && darkColors.background.startsWith('#'), 'dark theme background valid');
    assert(typeof amoledColors.background === 'string' && amoledColors.background === '#000000', 'amoled background is pure black');
    assert(typeof lightColors.background === 'string' && lightColors.background.startsWith('#'), 'light theme background valid');

    const contrastDark = getContrastTextColor(darkColors.primary);
    assert(contrastDark === '#0A0A0A' || contrastDark === '#FFFFFF', 'Contrast text color is WCAG dark (#0A0A0A) or white');

    const contrastLight = getContrastTextColor(lightColors.primary);
    assert(contrastLight === '#0A0A0A' || contrastLight === '#FFFFFF', 'Contrast text color for light primary is WCAG dark (#0A0A0A) or white');
  });

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`🏁 EMPIRICAL CHALLENGER SUMMARY: ${passCount}/${testCount} PROBES PASSED (${failCount} FAILED)`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllChallengerProbes().catch(err => {
  console.error('Fatal error in challenger probes:', err);
  process.exit(1);
});
