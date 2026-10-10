import './setup_env';
import {
  StorageService,
  safeParseArray,
  safeParseObject,
  DEFAULT_SETTINGS,
  DEFAULT_GAMIFICATION,
  DEFAULT_STREAK,
} from '../src/services/storage';
import { AttendanceService } from '../src/services/AttendanceService';
import { memoryStore, mockSecureStore } from './setup_env';
import { AppEvent, AttendanceRecord, Subject, Semester, StudyTask } from '../src/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, description: string, details?: any) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`  ❌ FAIL: ${description}`);
    if (details !== undefined) console.error('     Details:', details);
    throw new Error(`Assertion failed: ${description}`);
  }
  passedTests++;
  console.log(`  ✅ PASS: ${description}`);
}

async function testSection(name: string, fn: () => Promise<void> | void) {
  console.log(`\n================================================================`);
  console.log(`⚡ EMPIRICAL CHALLENGER TEST: ${name}`);
  console.log(`================================================================`);
  await fn();
}

async function runAdversarialEmpiricalChallenge() {
  console.log('################################################################');
  console.log('💥 ADVERSARIAL STRESS SUITE: StorageService & AttendanceService');
  console.log('################################################################');

  // ==========================================================================
  // SECTION 1: safeParseArray Extreme Corruptions & Adversarial Inputs
  // ==========================================================================
  await testSection('safeParseArray Deep Nesting & Extreme Syntax Corruptions', () => {
    // 1. Deeply nested unclosed brackets (500 levels)
    const deepUnclosed = '['.repeat(500) + '{"id":"x"}' + ']'.repeat(250);
    assert(Array.isArray(safeParseArray(deepUnclosed)), 'Deeply unclosed JSON brackets returns fallback array');
    assert(safeParseArray(deepUnclosed).length === 0, 'Deeply unclosed JSON brackets returns empty array');

    // 2. Corrupt inner syntax with partial tokens
    const corruptTokens = '[{"id": 1, "name": undefined, "missing": ,,, }]]';
    assert(Array.isArray(safeParseArray(corruptTokens)), 'Corrupt JSON tokens return fallback array');

    // 3. Truncated mid-string and mid-escape sequences
    const truncatedEscape = '[{"text": "hello \\u00';
    assert(Array.isArray(safeParseArray(truncatedEscape)), 'Truncated unicode escape returns fallback array');

    // 4. Raw unescaped null bytes and control chars (triggers JSON.parse SyntaxError safely)
    const rawNullByteString = '[\x00{"id":\x00"event_1\x00"}\x00,\x01\x1f{"id":"event_2"}]';
    const parsedRawNullBytes = safeParseArray<any>(rawNullByteString);
    assert(Array.isArray(parsedRawNullBytes), 'Raw null bytes in JSON syntax returns fallback array safely without uncaught exception');
    assert(parsedRawNullBytes.length === 0, 'Raw null byte syntax error returns empty fallback');

    // 5. Escaped null bytes (\u0000) inside valid JSON strings
    const escapedNullByteString = '[{"id":"event_1\\u0000with_null_byte"},{"id":"event_2"}]';
    const parsedEscapedNullBytes = safeParseArray<any>(escapedNullByteString);
    assert(Array.isArray(parsedEscapedNullBytes), 'Escaped null byte strings parsed into valid array');
    assert(parsedEscapedNullBytes.length === 2, 'Parsed 2 elements with escaped null bytes');
    assert(parsedEscapedNullBytes[0].id === 'event_1\u0000with_null_byte', 'Null byte preserved in string value');

    // 6. Binary control characters and high Unicode surrogates
    const unicodeSurrogate = '[{"name": "Valid \uD83D\uDE00 Emoji"}, {"surrogate": "\uD800"}]';
    const parsedSurrogates = safeParseArray<any>(unicodeSurrogate);
    assert(Array.isArray(parsedSurrogates), 'Unicode surrogates handled without uncaught errors');

    // 7. Giant malformed payload (100,000 corrupt chars)
    const giantMalformed = '['.repeat(10000) + '{"bad":' + 'x'.repeat(80000) + '}]';
    const startT = Date.now();
    const giantResult = safeParseArray(giantMalformed);
    const duration = Date.now() - startT;
    assert(Array.isArray(giantResult) && giantResult.length === 0, 'Giant malformed payload handled safely');
    assert(duration < 500, `Giant malformed payload processed quickly (< 500ms, actual: ${duration}ms)`);

    // 8. Giant valid payload (10,000 array elements)
    const giantValidArray = JSON.stringify(Array.from({ length: 10000 }, (_, i) => ({ id: `id_${i}`, val: i })));
    const giantValidResult = safeParseArray<any>(giantValidArray);
    assert(giantValidResult.length === 10000, 'Giant valid 10,000 item array parsed accurately');
    assert(giantValidResult[9999].id === 'id_9999', 'Last element matches');

    // 9. Array filtering: null elements removed in valid JSON
    const mixedArray = '[null, 123, "string", true, false, {"id":"obj1"}, null, {"id":"obj2"}]';
    const parsedMixed = safeParseArray<any>(mixedArray);
    assert(parsedMixed.length === 6, 'safeParseArray filters out null elements');
    assert(parsedMixed.some(i => i && i.id === 'obj1') && parsedMixed.some(i => i && i.id === 'obj2'), 'Objects preserved');

    // 10. Non-JSON literal undefined inside array
    const unquotedUndefined = '[undefined, 1, 2]';
    assert(safeParseArray(unquotedUndefined).length === 0, 'Unquoted undefined syntax error safely returns fallback');
  });

  // ==========================================================================
  // SECTION 2: safeParseObject Extreme Corruptions & Prototype Defense
  // ==========================================================================
  await testSection('safeParseObject Extreme Edge Cases & Prototype Defense', () => {
    const fallback = { id: 'default', count: 42, active: true };

    // 1. Primitive types in place of object
    assert(safeParseObject('12345', fallback).count === 42, 'Number string returns fallback copy');
    assert(safeParseObject('true', fallback).active === true, 'Boolean string returns fallback copy');
    assert(safeParseObject('"a plain string"', fallback).id === 'default', 'Plain string returns fallback copy');
    assert(safeParseObject('[1, 2, 3]', fallback).id === 'default', 'Array string returns fallback copy');
    assert(safeParseObject('null', fallback).id === 'default', '"null" string returns fallback copy');
    assert(safeParseObject('undefined', fallback).id === 'default', '"undefined" string returns fallback copy');

    // 2. Prototype pollution injection attempts
    const protoPollutionPayload = '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"admin": true}}, "count": 999}';
    const parsedProto = safeParseObject(protoPollutionPayload, fallback);
    assert(parsedProto.count === 999, 'Valid properties are merged');
    assert((Object.prototype as any).polluted === undefined, 'Prototype is not polluted via __proto__');
    assert((Object.prototype as any).admin === undefined, 'Prototype is not polluted via constructor.prototype');

    // 3. Null bytes in object properties
    const escapedNullByteObj = '{"id": "custom_id\\u0000", "count": 100}';
    const parsedNullObj = safeParseObject(escapedNullByteObj, fallback);
    assert(parsedNullObj.count === 100, 'Parsed object with null bytes in property value');
    assert(parsedNullObj.id === 'custom_id\u0000', 'Escaped null byte preserved');

    // 4. Immutability of fallback: Modifying result does not mutate original fallback
    const freshFallback = { val: 10 };
    const res1 = safeParseObject('{"val": 20}', freshFallback);
    res1.val = 999;
    assert(freshFallback.val === 10, 'Fallback object is not mutated by downstream modifications');
  });

  // ==========================================================================
  // SECTION 3: StorageService Adversarial State & Method Robustness
  // ==========================================================================
  await testSection('StorageService Under Corrupted Storage & Serialization Traps', async () => {
    // 1. Circular structure trap in StorageService.save*
    const circularObj: any = { id: 'circ1', title: 'Circular Event' };
    circularObj.self = circularObj;

    // Must not crash the process with unhandled exception
    await StorageService.saveEvents([circularObj as any]);
    await StorageService.saveSubjects([circularObj as any]);
    await StorageService.saveAttendances([circularObj as any]);
    await StorageService.saveTasks([circularObj as any]);
    await StorageService.saveStudySessions([circularObj as any]);
    await StorageService.saveSemesters([circularObj as any]);
    await StorageService.saveAACCActivities([circularObj as any]);
    await StorageService.saveGroupProjects([circularObj as any]);
    console.log('  ✅ PASS: StorageService.save* safely caught circular serialization traps');

    // 2. Corrupting ALL Storage Keys with malformed, null, or garbage payloads
    const allKeys = [
      '@organiza_events',
      '@organiza_theme',
      '@organiza_subjects',
      '@organiza_attendances',
      '@organiza_tasks',
      '@organiza_studysessions',
      '@organiza_semesters',
      '@organiza_settings',
      '@organiza_streak',
      '@organiza_teams_config',
      '@organiza_ai_config',
      '@organiza_aacc',
      '@organiza_group_projects',
      '@organiza_gamification'
    ];

    // Corrupt with literal "null"
    for (const key of allKeys) memoryStore[key] = 'null';

    const events1 = await StorageService.getEvents();
    const subjects1 = await StorageService.getSubjects();
    const attendances1 = await StorageService.getAttendances();
    const tasks1 = await StorageService.getTasks();
    const sessions1 = await StorageService.getStudySessions();
    const semesters1 = await StorageService.getSemesters();
    const settings1 = await StorageService.getSettings();
    const streak1 = await StorageService.getStreak();
    const aacc1 = await StorageService.getAACCActivities();
    const projects1 = await StorageService.getGroupProjects();
    const gamification1 = await StorageService.getGamificationData();
    const theme1 = await StorageService.getTheme();
    const aiConfig1 = await StorageService.getAIConfig();

    assert(Array.isArray(events1) && events1.length === 0, 'getEvents() on "null" returns []');
    assert(Array.isArray(subjects1) && subjects1.length === 0, 'getSubjects() on "null" returns []');
    assert(Array.isArray(attendances1) && attendances1.length === 0, 'getAttendances() on "null" returns []');
    assert(Array.isArray(tasks1) && tasks1.length === 0, 'getTasks() on "null" returns []');
    assert(Array.isArray(sessions1) && sessions1.length === 0, 'getStudySessions() on "null" returns []');
    assert(Array.isArray(semesters1) && semesters1.length > 0, 'getSemesters() on "null" creates default semester');
    assert(settings1.theme === 'dark' && typeof settings1.pomodoroFocusMin === 'number', 'getSettings() on "null" returns DEFAULT_SETTINGS');
    assert(streak1.currentStreak === 0 && streak1.longestStreak === 0, 'getStreak() on "null" returns DEFAULT_STREAK');
    assert(Array.isArray(aacc1) && aacc1.length === 0, 'getAACCActivities() on "null" returns []');
    assert(Array.isArray(projects1) && projects1.length === 0, 'getGroupProjects() on "null" returns []');
    assert(gamification1.level === 1 && gamification1.xp === 0, 'getGamificationData() on "null" returns DEFAULT_GAMIFICATION');
    assert(theme1 === 'dark', 'getTheme() on "null" returns "dark"');
    assert(aiConfig1.provider === 'gemini', 'getAIConfig() on "null" returns default config');

    // Corrupt with invalid syntax "BAD{JSON["
    for (const key of allKeys) memoryStore[key] = 'BAD{JSON[';

    const events2 = await StorageService.getEvents();
    const settings2 = await StorageService.getSettings();
    const streak2 = await StorageService.getStreak();
    const gamification2 = await StorageService.getGamificationData();

    assert(Array.isArray(events2) && events2.length === 0, 'getEvents() on syntax error returns []');
    assert(settings2.theme === 'dark' && settings2.pomodoroFocusMin === 25, 'getSettings() on syntax error returns DEFAULT_SETTINGS');
    assert(streak2.currentStreak === 0, 'getStreak() on syntax error returns DEFAULT_STREAK');
    assert(gamification2.level === 1, 'getGamificationData() on syntax error returns DEFAULT_GAMIFICATION');

    // 3. Corrupt numbers in Gamification, Streak, and Settings (NaN, Infinity, negative values, string numbers)
    memoryStore['@organiza_gamification'] = JSON.stringify({
      xp: 'not-a-number',
      level: -50,
      unlockedAchievements: [null, 'ach1', undefined, 'ach2'],
      totalFocusMinutes: NaN
    });
    const gamificationSanitized = await StorageService.getGamificationData();
    assert(gamificationSanitized.xp === 0, 'Gamification xp with NaN/string falls back to 0');
    assert(gamificationSanitized.level === 1, 'Gamification negative level normalized to >= 1');
    assert(gamificationSanitized.unlockedAchievements.length === 2, 'Unlocked achievements filtered from nulls');
    assert(gamificationSanitized.totalFocusMinutes === 0, 'totalFocusMinutes NaN normalized to 0');

    // 4. Secure AI Key migration & In-Memory Vault fallback
    mockSecureStore['lumen_secure_ai_api_key'] = 'SECURE_TEST_KEY_123';
    const secureConfig = await StorageService.getAIConfig();
    assert(secureConfig.apiKey === 'SECURE_TEST_KEY_123', 'AI Config retrieves secret from SecureStore');

    // Save secret with empty value deletes it
    await StorageService.saveSecureSecret('lumen_secure_ai_api_key', '');
    const emptyKey = await StorageService.getSecureSecret('lumen_secure_ai_api_key');
    assert(emptyKey === null, 'Empty secure secret string triggers deletion');

    // Backup export & restore with extreme inputs
    const backup = await StorageService.exportBackup();
    assert(backup.version === 2, 'Exported backup has version 2');
    assert(Array.isArray(backup.events), 'Exported backup contains events array');

    // Restoring corrupt backup object
    let importErrorCaught = false;
    try {
      await StorageService.importBackup(null as any);
    } catch {
      importErrorCaught = true;
    }
    assert(importErrorCaught, 'importBackup(null) throws invalid backup error');
  });

  // ==========================================================================
  // SECTION 4: AttendanceService Adversarial & Extreme Stress Testing
  // ==========================================================================
  await testSection('AttendanceService Extreme Inputs, Date Boundaries & Collision Defense', async () => {
    // 1. Non-array and nullish parameters
    const resNull = await AttendanceService.generatePendingAttendances(null, null);
    assert(Array.isArray(resNull) && resNull.length === 0, 'generatePendingAttendances(null, null) returns []');

    const resUndef = await AttendanceService.generatePendingAttendances(undefined, undefined);
    assert(Array.isArray(resUndef) && resUndef.length === 0, 'generatePendingAttendances(undefined, undefined) returns []');

    const resTypes = await AttendanceService.generatePendingAttendances('string' as any, 12345 as any);
    assert(Array.isArray(resTypes) && resTypes.length === 0, 'generatePendingAttendances(invalid types) returns []');

    const resCorruptArrays = await AttendanceService.generatePendingAttendances(
      [null, undefined, {}, { category: 'Faculdade/Aulas' }] as any,
      [null, undefined, { eventId: null, date: undefined }] as any
    );
    assert(Array.isArray(resCorruptArrays), 'generatePendingAttendances([null, ...], [null, ...]) returns valid array');

    // 2. Events with invalid, extreme, and malformed dates
    const invalidDateEvents: AppEvent[] = [
      {
        id: 'e_invalid_1',
        title: 'Bad Date Class',
        category: 'Faculdade/Aulas',
        recurrence: 'weekly',
        subjectId: 'sub_1',
        date: 'invalid-date-format',
      } as any,
      {
        id: 'e_invalid_2',
        title: 'Empty Date Class',
        category: 'Faculdade/Aulas',
        recurrence: 'weekly',
        subjectId: 'sub_1',
        date: '',
      } as any,
      {
        id: 'e_invalid_3',
        title: 'Far Future Class',
        category: 'Faculdade/Aulas',
        recurrence: 'weekly',
        subjectId: 'sub_1',
        date: '2099-01-01',
      } as any,
      {
        id: 'e_invalid_4',
        title: 'Missing Subject Class',
        category: 'Faculdade/Aulas',
        recurrence: 'weekly',
        subjectId: '' as any,
        date: '2026-01-01',
      } as any,
      {
        id: 'e_invalid_5',
        title: 'Malformed End Time Class',
        category: 'Faculdade/Aulas',
        recurrence: 'weekly',
        subjectId: 'sub_1',
        date: '2026-01-01',
        endTime: 'abc:xyz' as any,
      } as any,
      {
        id: 'e_invalid_6',
        title: 'Empty Colon End Time Class',
        category: 'Faculdade/Aulas',
        recurrence: 'weekly',
        subjectId: 'sub_1',
        date: '2026-01-01',
        endTime: ':::' as any,
      } as any
    ];

    await StorageService.saveSubjects([...new Set(invalidDateEvents.map(event => event.subjectId))].filter(Boolean).map(id => ({ id, name: 'Fixture' })) as any);
    await StorageService.saveEvents(invalidDateEvents);
    await StorageService.saveAttendances([]);
    const resInvalidDates = await AttendanceService.generatePendingAttendances(invalidDateEvents, []);
    assert(Array.isArray(resInvalidDates), 'Invalid date events handled gracefully without crashing');
    // e_invalid_5 and e_invalid_6 with valid date (2026-01-01) should generate attendances safely with fallback endTime (23:59)
    assert(resInvalidDates.length > 0, 'Events with malformed endTime gracefully fall back to 23:59');

    // 3. Ancient Date / Infinite Loop Protection Test (e.g. 50 years ago: 1970-01-01)
    const ancientEvent: AppEvent[] = [
      {
        id: 'ancient_class_1',
        title: 'Ancient 1970 Class',
        category: 'Faculdade/Aulas',
        recurrence: 'weekly',
        subjectId: 'sub_ancient',
        date: '1970-01-01T08:00:00',
        endTime: '10:00'
      }
    ];

    const loopStart = Date.now();
    await StorageService.saveSubjects([{ id: 'sub_ancient', name: 'Fixture' }] as any);
    await StorageService.saveEvents(ancientEvent);
    await StorageService.saveAttendances([]);
    const ancientRes = await AttendanceService.generatePendingAttendances(ancientEvent, []);
    const loopDuration = Date.now() - loopStart;

    assert(ancientRes.length <= 520, `Loop safety counter bounded ancient records to <= 520 (actual: ${ancientRes.length})`);
    assert(loopDuration < 200, `Ancient date loop terminated safely in < 200ms (actual: ${loopDuration}ms)`);

    // 4. Duplicate / Existing Records Set Collision
    const recurringEvent: AppEvent = {
      id: 'weekly_class_calc',
      title: 'Cálculo 1',
      category: 'Faculdade/Aulas',
      recurrence: 'weekly',
      subjectId: 'sub_calc',
      date: '2026-08-01',
      endTime: '12:00'
    };

    await StorageService.saveSubjects([{ id: 'sub_calc', name: 'Fixture' }] as any);
    await StorageService.saveEvents([recurringEvent]);
    await StorageService.saveAttendances([]);
    const firstPass = await AttendanceService.generatePendingAttendances([recurringEvent], []);
    assert(firstPass.length > 0, 'First pass generated attendances');

    // Second pass with first pass results as existingRecords
    const secondPass = await AttendanceService.generatePendingAttendances([recurringEvent], firstPass);
    assert(secondPass.length === firstPass.length, 'Second pass generates 0 duplicates when existingRecords are supplied');

    // 5. Heavy concurrency / high volume stress test (100 distinct weekly subjects)
    const heavyEvents: AppEvent[] = Array.from({ length: 100 }, (_, i) => ({
      id: `heavy_event_${i}`,
      title: `Subject Class ${i}`,
      category: 'Faculdade/Aulas',
      recurrence: 'weekly',
      subjectId: `heavy_sub_${i}`,
      date: '2026-07-01',
      endTime: '18:00'
    }));

    const heavyStart = Date.now();
    await StorageService.saveSubjects(heavyEvents.map(event => ({ id: event.subjectId, name: 'Fixture' })) as any);
    await StorageService.saveEvents(heavyEvents);
    await StorageService.saveAttendances([]);
    const heavyResult = await AttendanceService.generatePendingAttendances(heavyEvents, []);
    const heavyDuration = Date.now() - heavyStart;

    assert(heavyResult.length > 0, 'High volume attendance generation succeeded');
    assert(heavyDuration < 1000, `100 weekly events generated in < 1000ms (actual: ${heavyDuration}ms)`);
  });

  // ==========================================================================
  // SECTION 5: End-to-End Cold Start Hydration Simulation
  // ==========================================================================
  await testSection('End-to-End Cold Start Hydration Resiliency Simulation', async () => {
    // Simulate App.tsx cold start Promise.all hydration under corrupted storage
    for (const key of Object.keys(memoryStore)) {
      memoryStore[key] = 'null';
    }

    const [
      events,
      subjects,
      attendances,
      tasks,
      studySessions,
      semesters,
      settings,
      streak,
      aaccActivities,
      groupProjects,
      gamification,
      theme
    ] = await Promise.all([
      StorageService.getEvents(),
      StorageService.getSubjects(),
      StorageService.getAttendances(),
      StorageService.getTasks(),
      StorageService.getStudySessions(),
      StorageService.getSemesters(),
      StorageService.getSettings(),
      StorageService.getStreak(),
      StorageService.getAACCActivities(),
      StorageService.getGroupProjects(),
      StorageService.getGamificationData(),
      StorageService.getTheme(),
    ]);

    assert(Array.isArray(events), 'Hydrated events is array');
    assert(Array.isArray(subjects), 'Hydrated subjects is array');
    assert(Array.isArray(attendances), 'Hydrated attendances is array');
    assert(Array.isArray(tasks), 'Hydrated tasks is array');
    assert(Array.isArray(studySessions), 'Hydrated studySessions is array');
    assert(Array.isArray(semesters) && semesters.length > 0, 'Hydrated semesters has default');
    assert(typeof settings === 'object' && settings !== null, 'Hydrated settings is object');
    assert(typeof streak === 'object' && streak !== null, 'Hydrated streak is object');
    assert(Array.isArray(aaccActivities), 'Hydrated aaccActivities is array');
    assert(Array.isArray(groupProjects), 'Hydrated groupProjects is array');
    assert(typeof gamification === 'object' && gamification !== null, 'Hydrated gamification is object');
    assert(typeof theme === 'string', 'Hydrated theme is string');

    // Run AttendanceService with hydrated data
    const updatedAttendances = await AttendanceService.generatePendingAttendances(events, attendances);
    assert(Array.isArray(updatedAttendances), 'AttendanceService ran successfully after cold start hydration');
  });

  console.log('\n================================================================');
  console.log(`📊 ADVERSARIAL CHALLENGE SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error(`💥 ${failedTests} tests failed!`);
    process.exit(1);
  } else {
    console.log('🏆 ALL ADVERSARIAL CHALLENGE TESTS PASSED (100% GREEN)!');
    process.exit(0);
  }
}

runAdversarialEmpiricalChallenge().catch(err => {
  console.error('Fatal unhandled error in adversarial test runner:', err);
  process.exit(1);
});
