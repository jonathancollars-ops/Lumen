import './setup_env';
import assert from 'node:assert/strict';
import type { NotificationRequestInput } from 'expo-notifications';
import { mockAsyncStorage, mockNotifications } from './setup_env';
import { AttendanceService } from '../src/services/AttendanceService';
import { NotificationService } from '../src/services/notifications';
import { CourseCRService } from '../src/services/CourseCRService';
import { calculateFinalGrade } from '../src/components/GradeEngine';
import { AppEvent, CourseProgressData, GradeGroup, Subject } from '../src/types';

const RealDate = Date;
let clock = new RealDate('2026-10-07T14:00:00').getTime();
const originalSchedule = mockNotifications.scheduleNotificationAsync;
const scheduled: NotificationRequestInput[] = [];

function course(): CourseProgressData {
  return {
    courseName: 'Teste', baselineCR: 8, completedCredits: 4, totalRequiredCredits: 8,
    semesters: [{ semesterNumber: 1, title: 'Histórico', subjects: [
      { id: 'history', name: 'Histórico', credits: 4, grade: 8, isCompleted: true },
    ] }],
  };
}

const event: AppEvent = {
  id: 'class', title: 'Aula', category: 'Faculdade/Aulas', subjectId: 'subject',
  date: '2026-10-05', startTime: '08:00', endTime: '09:00', recurrence: 'weekly',
  recurrenceDays: [1, 3], alerts: [30], isCompleted: false,
};
const subject: Subject = { id: 'subject', name: 'Disciplina', passGrade: 7, workloadHours: 60 };
const groups: GradeGroup[] = [{ id: 'g', name: 'Provas', weight: 1, items: [
  { id: 'p1', name: 'P1', weight: 1, maxGrade: 10, grade: 8 },
  { id: 'p2', name: 'P2', weight: 1, maxGrade: 10 },
] }];

function scenario(data: CourseProgressData, gradeGroups: GradeGroup[], type: string): number | undefined {
  return CourseCRService.simulateCRScenarios(data, [{ ...subject, gradeGroups }])
    .scenarios.find(scenario => scenario.type === type)?.projectedCR;
}

async function run(): Promise<void> {
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) { return args.length ? Reflect.construct(target, args) : new RealDate(clock); },
    get(target, key, receiver) { return key === 'now' ? () => clock : Reflect.get(target, key, receiver); },
  });
  mockNotifications.scheduleNotificationAsync = async (request?: NotificationRequestInput) => {
    if (request) scheduled.push(request);
    return 'test-notification';
  };
  await mockAsyncStorage.clear();

  const records = await AttendanceService.generatePendingAttendances([event], []);
  assert.deepEqual(records.map(record => record.date).sort(), ['2026-10-05', '2026-10-07']);
  assert.equal((await AttendanceService.generatePendingAttendances([event], records)).length, 2);
  const cancelled = records.map(record => ({ ...record, status: 'cancelled' as const }));
  assert.deepEqual(await AttendanceService.generatePendingAttendances([event], cancelled), cancelled);
  const explicitDays = await AttendanceService.generatePendingAttendances([
    { ...event, recurrenceDays: [3, 3, -1, 9] },
  ], []);
  assert.deepEqual(explicitDays.map(record => record.date), ['2026-10-07']);

  clock = new RealDate('2026-10-06T10:00:00').getTime();
  const morning = { ...event, date: '2026-10-06', recurrenceDays: undefined };
  assert.deepEqual((await AttendanceService.generatePendingAttendances([morning], [])).map(r => r.date), ['2026-10-06']);
  assert.equal((await AttendanceService.generatePendingAttendances([{ ...morning, endTime: '11:00' }], [])).length, 0);
  assert.equal((await AttendanceService.generatePendingAttendances([{ ...morning, date: '2026-10-13' }], [])).length, 0);
  console.log('PASS: multiple weekdays, deduplication, cancellations and morning attendance');

  const finalGroups: GradeGroup[] = [{ id: 'g', name: 'Provas', weight: 1, items: [
    { id: 'p1', name: 'P1', weight: 1, maxGrade: 10, grade: 6 },
    { id: 'final', name: 'Final', weight: 1, maxGrade: 10, grade: 6, isFinalExam: true },
  ] }];
  const closure = (gradeGroups: GradeGroup[]) => CourseCRService.closeActiveSemester(
    course(), [{ ...subject, gradeGroups }], '2026.2',
  ).semesters.at(-1)!.subjects[0];
  assert.equal(calculateFinalGrade(finalGroups, 7).usedFinal, true);
  assert.equal(closure(finalGroups).isCompleted, true);
  assert.equal(closure([{ ...finalGroups[0], items: [finalGroups[0].items[0]] }]).isCompleted, false);
  assert.equal(closure([{ ...finalGroups[0], items: [
    finalGroups[0].items[0], { ...finalGroups[0].items[1], grade: 4 },
  ] }]).isCompleted, true); // (6 + 4) / 2 = 5, exactly the final approval cutoff.
  assert.equal(closure([{ ...finalGroups[0], items: [
    finalGroups[0].items[0], { ...finalGroups[0].items[1], grade: 2 },
  ] }]).isCompleted, false);
  assert.equal(closure([{ ...finalGroups[0], items: [
    finalGroups[0].items[0], { ...finalGroups[0].items[1], grade: 3.92 },
  ] }]).isCompleted, false); // 4.96 must not pass merely because the display rounds to 5.0.
  console.log('PASS: semester closure agrees with final-exam approval');

  const originalGroups = JSON.stringify(groups);
  assert.equal(scenario(course(), groups, 'worst_case'), 6);
  assert.equal(scenario(course(), groups, 'best_case'), 8.5);
  const finished = [{ ...groups[0], items: [groups[0].items[0]] }];
  assert.equal(scenario(course(), finished, 'worst_case'), 8);
  assert.equal(scenario(course(), finished, 'best_case'), 8);
  const weighted = [{ ...groups[0], items: [groups[0].items[0], { ...groups[0].items[1], weight: 3, maxGrade: 20 }] }];
  assert.equal(scenario(course(), weighted, 'worst_case'), 5);
  assert.equal(scenario(course(), weighted, 'best_case'), 8.75);
  assert.equal(scenario({ ...course(), semesters: [], completedCredits: 0, baselineCR: 0 }, finished, 'best_case'), 8);
  assert.equal(JSON.stringify(groups), originalGroups);
  console.log('PASS: CR projections preserve grades, weights, maxima and credits');

  const matrix = CourseCRService.parseCurriculumMatrixText(
    '1 Semestre\nMAT101 Cálculo 1 - 60h - 8,0 - Aprovado\nMAT102 Cálculo 2 - 60h', course(),
  );
  assert.deepEqual(matrix.semesters[0].subjects.map(s => s.name), ['Cálculo 1', 'Cálculo 2']);
  assert.equal(matrix.semesters[0].subjects[0].grade, 8);
  assert.equal(matrix.semesters[0].subjects[0].credits, 4);
  assert.equal(matrix.semesters[0].subjects[1].isCompleted, false);
  const frozen = course();
  Object.freeze(frozen.semesters[0].subjects[0]);
  const snapshot = JSON.stringify(frozen);
  const imported = CourseCRService.applyAIParsedTranscript({ subjects: [
    { name: 'Histórico', grade: 4, status: 'reproved' },
  ] }, frozen);
  assert.equal(imported.semesters[0].subjects[0].grade, 4);
  assert.equal(imported.semesters[0].subjects[0].isCompleted, false);
  assert.equal(JSON.stringify(frozen), snapshot);
  const textImport = CourseCRService.parseHistoryText('Histórico - 9,0 - Aprovado', frozen);
  assert.equal(textImport.semesters[0].subjects[0].grade, 9);
  assert.equal(JSON.stringify(frozen), snapshot);
  console.log('PASS: curriculum numbering and immutable text/AI imports');

  clock = new RealDate('2026-10-07T14:00:00').getTime();
  const monthly = { ...event, subjectId: undefined, date: '2026-09-15', recurrence: 'monthly' as const, recurrenceMonthDay: 15 };
  await NotificationService.scheduleEventNotifications(monthly);
  assert.deepEqual(scheduled[0].trigger, { type: 'monthly', day: 15, hour: 7, minute: 30, channelId: 'default' });
  const datedAlerts = () => scheduled.map(request => {
    const trigger = request.trigger;
    assert.ok(trigger && typeof trigger === 'object' && 'date' in trigger);
    return new RealDate(trigger.date);
  });
  scheduled.length = 0;
  await NotificationService.scheduleEventNotifications({ ...monthly, date: '2026-11-15' });
  assert.equal(scheduled.length, 12);
  assert.equal(datedAlerts()[0].getMonth(), 10);
  assert.ok(datedAlerts().every(date => date.getTime() > clock));
  scheduled.length = 0;
  await NotificationService.scheduleEventNotifications({ ...monthly, date: '2026-08-31', recurrenceMonthDay: 31 });
  assert.deepEqual(datedAlerts().slice(0, 3).map(date => [date.getMonth() + 1, date.getDate()]), [[10, 31], [11, 30], [12, 31]]);
  scheduled.length = 0;
  await NotificationService.scheduleEventNotifications({ ...monthly, date: '2026-01-15', recurrenceInterval: 3 });
  assert.deepEqual(datedAlerts().slice(0, 3).map(date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]), [[2026, 10, 15], [2027, 1, 15], [2027, 4, 15]]);
  scheduled.length = 0;
  await NotificationService.scheduleEventNotifications({ ...monthly, date: '2026-01-01', recurrenceMonthDay: 1, alerts: [1440] });
  assert.equal(datedAlerts()[0].getMonth(), 9);
  assert.equal(datedAlerts()[0].getDate(), 31);
  scheduled.length = 0;
  await NotificationService.refreshMonthlyNotifications([monthly], []);
  assert.equal(scheduled.length, 1);
  scheduled.length = 0;
  await NotificationService.refreshMonthlyNotifications([{ ...monthly, subjectId: subject.id }], [{ ...subject, isArchived: true }]);
  assert.equal(scheduled.length, 0);

  let concurrent = 0;
  let maxConcurrent = 0;
  let notificationsCount = 0;
  mockNotifications.scheduleNotificationAsync = async () => {
    concurrent++;
    notificationsCount++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await Promise.resolve();
    concurrent--;
    return 'concurrent-notification';
  };
  await Promise.all([
    NotificationService.scheduleEventNotifications(monthly),
    NotificationService.scheduleEventNotifications(monthly),
  ]);
  assert.equal(notificationsCount, 2);
  assert.equal(maxConcurrent, 1, 'A refresh must not overlap an edit of the same event');
  console.log('PASS: monthly alerts, future starts, short months, intervals, offsets and refresh');
}

run().then(() => console.log('All seven audited bugs have regression coverage.'))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { globalThis.Date = RealDate; mockNotifications.scheduleNotificationAsync = originalSchedule; });
