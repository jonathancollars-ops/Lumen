import './setup_env';
import { NotificationService } from '../src/services/notifications';
import {
  StorageService,
  DEFAULT_SETTINGS,
  DEFAULT_GAMIFICATION,
  DEFAULT_STREAK,
} from '../src/services/storage';
import { CourseCRService, DEFAULT_CURRICULUM_TEMPLATE } from '../src/services/CourseCRService';
import { AttendanceService } from '../src/services/AttendanceService';
import { AppUpdateService } from '../src/services/AppUpdateService';
import { memoryStore, mockSecureStore, mockSecureStoreImpl, mockNotifications } from './setup_env';
import { AppEvent, Subject, BackupData } from '../src/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, description: string, details?: any) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`  ❌ FAIL: ${description}`);
    if (details) console.error('     Details:', details);
    throw new Error(`Assertion failed: ${description}`);
  }
  passedTests++;
  console.log(`  ✅ PASS: ${description}`);
}

async function testSection(name: string, fn: () => Promise<void> | void) {
  console.log(`\n================================================================`);
  console.log(`🛡️  LIFECYCLE & PERMISSIONS SUITE: ${name}`);
  console.log(`================================================================`);
  await fn();
}

async function runLifecycleAndPermissionsTests() {
  console.log('################################################################');
  console.log('🔒 MILESTONES 2 & 3: LIFECYCLE, PERMISSIONS & ADVERSARIAL COVERAGE');
  console.log('################################################################');

  // ==========================================================================
  // SECTION 1: Notification & OS Permission Rejections
  // ==========================================================================
  await testSection('OS & Hardware Notification Permission Denials', async () => {
    const origGetPerms = mockNotifications.getPermissionsAsync;
    const origReqPerms = mockNotifications.requestPermissionsAsync;
    const origSchedule = mockNotifications.scheduleNotificationAsync;
    const origChannel = mockNotifications.setNotificationChannelAsync;

    try {
      // 1.1 Permission Denied by User or Policy
      mockNotifications.getPermissionsAsync = async () => ({ status: 'denied' });
      mockNotifications.requestPermissionsAsync = async () => ({ status: 'denied' });

      const grantedDenied = await NotificationService.requestPermissions();
      assert(grantedDenied === false, 'requestPermissions() returns false when OS permission is denied');

      // 1.2 OS Throws SecurityException on requestPermissionsAsync
      mockNotifications.getPermissionsAsync = async () => {
        throw new Error('OS SecurityException: POST_NOTIFICATIONS permission blocked by administrator');
      };
      mockNotifications.requestPermissionsAsync = async () => {
        throw new Error('OS SecurityException: Permission request failed');
      };

      const grantedException = await NotificationService.requestPermissions();
      assert(grantedException === false, 'requestPermissions() catches SecurityException and returns false safely');

      // 1.3 Channel registration throws exception
      mockNotifications.setNotificationChannelAsync = async () => {
        throw new Error('Channel creation unsupported on this hardware ROM');
      };
      mockNotifications.getPermissionsAsync = async () => ({ status: 'granted' });
      mockNotifications.requestPermissionsAsync = async () => ({ status: 'granted' });

      const grantedChannelFail = await NotificationService.requestPermissions();
      assert(grantedChannelFail === true, 'requestPermissions() succeeds even if notification channel registration fails');

      // 1.4 Exact Alarms Revocation (Android 13+ SCHEDULE_EXACT_ALARM denial)
      mockNotifications.scheduleNotificationAsync = async () => {
        throw new Error('SecurityException: Caller not allowed to schedule exact alarms');
      };

      const testEvent: AppEvent = {
        id: 'evt_exact_alarm_test',
        title: 'Cálculo I - Prova P1',
        category: 'Provas/Trabalhos',
        date: '2026-09-15',
        startTime: '14:00',
        endTime: '16:00',
        isNotified: true,
        alerts: [15, 60, 1440],
      };

      let threwSchedule = false;
      try {
        await NotificationService.scheduleEventNotifications(testEvent);
      } catch {
        threwSchedule = true;
      }
      assert(threwSchedule === false, 'scheduleEventNotifications() suppresses exact alarm SecurityException without crashing');

      // 1.5 Adversarial inputs to scheduleEventNotifications
      let threwMalformed = false;
      try {
        await NotificationService.scheduleEventNotifications(null as any);
        await NotificationService.scheduleEventNotifications(undefined as any);
        await NotificationService.scheduleEventNotifications({} as any);
        await NotificationService.scheduleEventNotifications({ id: 'evt_no_alerts', isNotified: true, alerts: [] } as any);
        await NotificationService.scheduleEventNotifications({ id: 'evt_bad_date', isNotified: true, alerts: [15], date: 'not-a-date', startTime: 'invalid' } as any);
      } catch {
        threwMalformed = true;
      }
      assert(threwMalformed === false, 'scheduleEventNotifications() survives null, undefined, empty alerts, and malformed dates');

      // 1.6 Adversarial inputs to cancelEventNotifications
      let threwCancel = false;
      try {
        await NotificationService.cancelEventNotifications('');
        await NotificationService.cancelEventNotifications(null as any);
        await NotificationService.cancelEventNotifications(undefined as any);
        await NotificationService.cancelEventNotifications('non_existent_id_123');
      } catch {
        threwCancel = true;
      }
      assert(threwCancel === false, 'cancelEventNotifications() survives empty and invalid event IDs safely');
    } finally {
      mockNotifications.getPermissionsAsync = origGetPerms;
      mockNotifications.requestPermissionsAsync = origReqPerms;
      mockNotifications.scheduleNotificationAsync = origSchedule;
      mockNotifications.setNotificationChannelAsync = origChannel;
    }
  });

  // ==========================================================================
  // SECTION 2: SecureStore Hardware Keystore Failure & In-Memory Vault Fallback
  // ==========================================================================
  await testSection('SecureStore Hardware Keystore Failure & In-Memory Vault Fallback', async () => {
    // 2.1 Standard storage and retrieval
    await StorageService.saveSecureSecret('test_keystore_key', 'top_secret_token_123');
    const readSecret = await StorageService.getSecureSecret('test_keystore_key');
    assert(readSecret === 'top_secret_token_123', 'saveSecureSecret and getSecureSecret store and retrieve secret');

    // 2.2 Hardware Keystore Failure simulation (setItemAsync / getItemAsync throwing native error)
    const origSetItem = mockSecureStoreImpl.setItemAsync;
    const origGetItem = mockSecureStoreImpl.getItemAsync;

    try {
      mockSecureStoreImpl.setItemAsync = async () => {
        throw new Error('Android Keystore hardware failure: KeyPermanentlyInvalidatedException');
      };
      mockSecureStoreImpl.getItemAsync = async () => {
        throw new Error('Android Keystore hardware failure: KeyPermanentlyInvalidatedException');
      };

      // Save secret during hardware failure -> should fallback to inMemorySecureVault
      await StorageService.saveSecureSecret('hw_fail_secret_key', 'vault_fallback_token_999');
      const recoveredSecret = await StorageService.getSecureSecret('hw_fail_secret_key');
      assert(recoveredSecret === 'vault_fallback_token_999', 'SecureStore hardware failure falls back cleanly to in-memory vault');
    } finally {
      mockSecureStoreImpl.setItemAsync = origSetItem;
      mockSecureStoreImpl.getItemAsync = origGetItem;
    }

    // 2.3 Overwrite with empty string should delete
    await StorageService.saveSecureSecret('test_keystore_key', '');
    const emptySecret = await StorageService.getSecureSecret('test_keystore_key');
    assert(emptySecret === null, 'saveSecureSecret with empty string deletes the secret');

    // 2.4 Save another secret and delete explicitly
    await StorageService.saveSecureSecret('temp_key', 'temp_val');
    await StorageService.deleteSecureSecret('temp_key');
    const deletedSecret = await StorageService.getSecureSecret('temp_key');
    assert(deletedSecret === null, 'deleteSecureSecret removes secret cleanly');

    // 2.5 Adversarial: null / empty keys
    await StorageService.saveSecureSecret('', 'val');
    await StorageService.deleteSecureSecret('');
    const nullKeyRes = await StorageService.getSecureSecret('');
    assert(nullKeyRes === null, 'getSecureSecret with empty string returns null safely');
  });

  // ==========================================================================
  // SECTION 3: Clean Install Zero-Data Boot Simulation
  // ==========================================================================
  await testSection('Clean Install Zero-Data Boot Simulation', async () => {
    // Clear all storage to simulate 1st launch on fresh install
    await StorageService.clearAllData();

    // 3.1 Theme defaults to 'dark'
    const theme = await StorageService.getTheme();
    assert(theme === 'dark', 'Clean install: getTheme() returns default "dark"');

    // 3.2 Settings defaults to DEFAULT_SETTINGS
    const settings = await StorageService.getSettings();
    assert(settings.theme === 'dark', 'Clean install: settings.theme is "dark"');
    assert(settings.pomodoroFocusMin === 25, 'Clean install: settings.pomodoroFocusMin is 25');
    assert(settings.pomodoroBreakMin === 5, 'Clean install: settings.pomodoroBreakMin is 5');
    assert(settings.pomodoroLongBreakMin === 15, 'Clean install: settings.pomodoroLongBreakMin is 15');
    assert(settings.defaultPassGrade === 7.0, 'Clean install: settings.defaultPassGrade is 7.0');
    assert(settings.fullscreen === false, 'Clean install: settings.fullscreen is false');
    assert(settings.soundEnabled === true, 'Clean install: settings.soundEnabled is true');
    assert(settings.hapticsEnabled === true, 'Clean install: settings.hapticsEnabled is true');
    assert(settings.examWeekMode === false, 'Clean install: settings.examWeekMode is false');

    // 3.3 Semesters auto-initializes current semester
    const semesters = await StorageService.getSemesters();
    assert(Array.isArray(semesters) && semesters.length === 1, 'Clean install: getSemesters() auto-creates 1 default semester');
    assert(semesters[0].isCurrent === true, 'Clean install: default semester is marked isCurrent: true');
    assert(typeof semesters[0].id === 'string' && semesters[0].id.length > 0, 'Clean install: default semester has non-empty ID');
    assert(typeof semesters[0].name === 'string' && semesters[0].name.length > 0, 'Clean install: default semester has non-empty Name');

    // 3.4 Gamification defaults to Level 1
    const gamification = await StorageService.getGamificationData();
    assert(gamification.xp === 0, 'Clean install: gamification.xp is 0');
    assert(gamification.level === 1, 'Clean install: gamification.level is 1');
    assert(Array.isArray(gamification.unlockedAchievements) && gamification.unlockedAchievements.length === 0, 'Clean install: unlockedAchievements is empty array');
    assert(gamification.totalFocusMinutes === 0, 'Clean install: totalFocusMinutes is 0');

    // 3.5 Streak defaults to 0
    const streak = await StorageService.getStreak();
    assert(streak.currentStreak === 0, 'Clean install: streak.currentStreak is 0');
    assert(streak.longestStreak === 0, 'Clean install: streak.longestStreak is 0');
    assert(streak.totalStudyDays === 0, 'Clean install: streak.totalStudyDays is 0');

    // 3.6 Course Progress defaults to DEFAULT_CURRICULUM_TEMPLATE
    const courseProgress = await CourseCRService.loadCourseProgress();
    assert(courseProgress.courseName === 'Graduação', 'Clean install: loadCourseProgress() returns default courseName');
    assert(courseProgress.totalRequiredCredits === 200, 'Clean install: default totalRequiredCredits is 200');
    assert(Array.isArray(courseProgress.semesters) && courseProgress.semesters.length === 8, 'Clean install: default curriculum template has 8 semesters');

    // 3.7 Entity arrays return empty arrays
    const [events, subjects, attendances, tasks, sessions, aacc, projects] = await Promise.all([
      StorageService.getEvents(),
      StorageService.getSubjects(),
      StorageService.getAttendances(),
      StorageService.getTasks(),
      StorageService.getStudySessions(),
      StorageService.getAACCActivities(),
      StorageService.getGroupProjects(),
    ]);

    assert(Array.isArray(events) && events.length === 0, 'Clean install: getEvents() is []');
    assert(Array.isArray(subjects) && subjects.length === 0, 'Clean install: getSubjects() is []');
    assert(Array.isArray(attendances) && attendances.length === 0, 'Clean install: getAttendances() is []');
    assert(Array.isArray(tasks) && tasks.length === 0, 'Clean install: getTasks() is []');
    assert(Array.isArray(sessions) && sessions.length === 0, 'Clean install: getStudySessions() is []');
    assert(Array.isArray(aacc) && aacc.length === 0, 'Clean install: getAACCActivities() is []');
    assert(Array.isArray(projects) && projects.length === 0, 'Clean install: getGroupProjects() is []');

    // 3.8 AttendanceService clean boot check
    const pending = await AttendanceService.generatePendingAttendances(events, attendances);
    assert(Array.isArray(pending) && pending.length === 0, 'Clean install: generatePendingAttendances([], []) returns []');
  });

  // ==========================================================================
  // SECTION 4: Legacy Data Migration Simulation
  // ==========================================================================
  await testSection('Legacy Data Migration Simulation', async () => {
    // 4.1 Plaintext API key migration from legacy @organiza_ai_config to SecureStore
    delete mockSecureStore['lumen_secure_ai_api_key'];
    memoryStore['@organiza_ai_config'] = JSON.stringify({
      provider: 'gemini',
      apiKey: 'AIzaSy_LEGACY_MIGRATION_KEY_999',
      mode: 'local_edge',
      model: 'gemini-1.5-flash',
    });

    const aiConfig = await StorageService.getAIConfig();
    assert(aiConfig.apiKey === 'AIzaSy_LEGACY_MIGRATION_KEY_999', 'getAIConfig() reads legacy plaintext API key successfully');
    
    const secureKeyInVault = await StorageService.getSecureSecret('lumen_secure_ai_api_key');
    assert(secureKeyInVault === 'AIzaSy_LEGACY_MIGRATION_KEY_999', 'Plaintext key was migrated to SecureStore');

    const sanitizedRaw = memoryStore['@organiza_ai_config'];
    const parsedSanitized = JSON.parse(sanitizedRaw);
    assert(parsedSanitized.apiKey === '', 'Plaintext API key was stripped from unencrypted AsyncStorage');

    // 4.2 Legacy Subject Schema Evolution (missing gradeGroups, passGrade, maxAbsences)
    const legacySubject: Subject = {
      id: 'sub_legacy_1',
      name: 'Física Clássica',
      color: '#3B82F6',
      semesterId: '2026.1',
    } as any;

    await StorageService.saveSubjects([legacySubject]);
    const loadedSubjects = await StorageService.getSubjects();
    assert(loadedSubjects.length === 1, 'getSubjects() loads legacy subject');
    assert(loadedSubjects[0].name === 'Física Clássica', 'Subject name preserved');

    const sim = CourseCRService.simulateCRScenarios(DEFAULT_CURRICULUM_TEMPLATE, loadedSubjects);
    assert(!isNaN(sim.currentCR), 'CR simulation executes cleanly without NaN on legacy subjects');
    assert(sim.scenarios.length === 4, '4 simulation scenarios generated for legacy subjects');

    // 4.3 Legacy Backup Format Import with Partial Entities
    const partialBackup: BackupData = {
      version: 2,
      timestamp: new Date().toISOString(),
      events: [
        {
          id: 'evt_migrated_1',
          title: 'Prova de Cálculo',
          category: 'Provas/Trabalhos',
          date: '2026-09-20',
          startTime: '09:00',
          endTime: '11:00',
          isNotified: true,
          alerts: [60],
        }
      ],
      subjects: [
        {
          id: 'sub_migrated_1',
          name: 'Cálculo II',
          color: '#F43F5E',
          semesterId: '2026.1',
          passGrade: 7.0,
          maxAbsences: 15,
        }
      ],
      settings: {
        theme: 'amoled',
        pomodoroFocusMin: 30,
        pomodoroBreakMin: 6,
        pomodoroLongBreakMin: 20,
        defaultPassGrade: 7.5,
        fullscreen: true,
        soundEnabled: true,
        hapticsEnabled: false,
        examWeekMode: true,
      },
    } as any;

    const importRes = await StorageService.importBackup(partialBackup);
    assert(importRes === true, 'importBackup() succeeds with partial legacy backup payload');

    const importedEvents = await StorageService.getEvents();
    assert(importedEvents.length === 1 && importedEvents[0].id === 'evt_migrated_1', 'Imported event hydrated correctly');

    const importedTheme = await StorageService.getTheme();
    assert(importedTheme === 'amoled', 'Imported theme applied correctly');

    const importedSettings = await StorageService.getSettings();
    assert(importedSettings.pomodoroFocusMin === 30, 'Imported pomodoroFocusMin applied');
    assert(importedSettings.hapticsEnabled === false, 'Imported hapticsEnabled applied');
  });

  // ==========================================================================
  // SECTION 5: Network Timeout & Resilience in AppUpdateService
  // ==========================================================================
  await testSection('Network Timeout & Resilience in AppUpdateService', async () => {
    const origFetch = (globalThis as any).fetch;

    try {
      // 5.1 AbortController Timeout Simulation (8s timeout abort)
      (globalThis as any).fetch = async () => {
        const error = new Error('The operation was aborted');
        (error as any).name = 'AbortError';
        throw error;
      };

      const timeoutResult = await AppUpdateService.checkForUpdates(true);
      assert(timeoutResult === null, 'checkForUpdates() handles AbortController timeout and returns null safely');

      // 5.2 Offline Network Error (DNS failure / ENOTFOUND)
      (globalThis as any).fetch = async () => {
        throw new TypeError('fetch failed: getaddrinfo ENOTFOUND api.github.com');
      };

      const offlineResult = await AppUpdateService.checkForUpdates(true);
      assert(offlineResult === null, 'checkForUpdates() handles offline DNS failure and returns null safely');

      // 5.3 HTTP 403 Rate Limit / HTTP 500 Server Error
      (globalThis as any).fetch = async () => ({
        ok: false,
        status: 403,
        statusText: 'Forbidden - API Rate Limit Exceeded',
      });

      const rateLimitResult = await AppUpdateService.checkForUpdates(true);
      assert(rateLimitResult === null, 'checkForUpdates() handles HTTP 403 rate limit and returns null safely');

      // 5.4 Malformed / Null Remote JSON
      (globalThis as any).fetch = async () => ({
        ok: true,
        json: async () => null,
      });

      const malformedResult = await AppUpdateService.checkForUpdates(true);
      assert(malformedResult === null, 'checkForUpdates() handles null JSON response safely');

      // 5.5 Valid Remote Update Detection
      (globalThis as any).fetch = async () => ({
        ok: true,
        json: async () => ({
          tag_name: 'v3.7.0',
          name: 'Lumen v3.7.0 - Super Atualização',
          body: 'Novas funcionalidades e estabilidade.',
          assets: [
            {
              name: 'lumen-v3.7.0-standalone.apk',
              browser_download_url: 'https://github.com/jonathancollars-ops/organiza/releases/download/v3.7.0/lumen.apk',
            }
          ],
          published_at: '2026-08-26T12:00:00Z',
        }),
      });

      const updateInfo = await AppUpdateService.checkForUpdates(true);
      assert(updateInfo !== null, 'checkForUpdates() detects valid remote update');
      assert(updateInfo?.hasUpdate === true, 'updateInfo.hasUpdate is true');
      assert(updateInfo?.latestVersion === '3.7.0', 'updateInfo.latestVersion is 3.5.0');
      assert(updateInfo?.downloadUrl.endsWith('.apk') === true, 'updateInfo.downloadUrl resolved to APK asset');

      // 5.6 Ignored Version State Check
      await AppUpdateService.ignoreVersion('3.7.0');
      const ignoredCheck = await AppUpdateService.checkForUpdates(false);
      assert(ignoredCheck === null, 'checkForUpdates(false) skips check when version is in ignoredVersion state');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  // ==========================================================================
  // FINAL SUMMARY
  // ==========================================================================
  console.log('\n================================================================');
  console.log(`📊 LIFECYCLE & PERMISSIONS SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error(`❌ FAILED: ${failedTests} tests failed.`);
    process.exit(1);
  } else {
    console.log('🎉 ALL LIFECYCLE, PERMISSIONS & ADVERSARIAL TESTS PASSED 100% GREEN!');
    process.exit(0);
  }
}

runLifecycleAndPermissionsTests().catch(err => {
  console.error('Fatal error running lifecycle & permissions tests:', err);
  process.exit(1);
});
