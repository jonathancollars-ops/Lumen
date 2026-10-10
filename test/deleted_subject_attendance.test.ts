import './setup_env';
import assert from 'node:assert/strict';
import { mockAsyncStorage, mockNotifications } from './setup_env';
import { StorageService } from '../src/services/storage';
import { AttendanceService } from '../src/services/AttendanceService';
import { NotificationService } from '../src/services/notifications';
import { filterValidAttendances } from '../src/utils/attendanceValidity';
import { Subject, AppEvent, AttendanceRecord } from '../src/types';

const subjects: Subject[] = Array.from({ length: 7 }, (_, i) => ({ id: `subject-${i}`, name: `Disciplina ${i}` }));
const events: AppEvent[] = subjects.map(subject => ({
  id: `class-${subject.id}`, subjectId: subject.id, title: subject.name,
  category: 'Faculdade/Aulas', recurrence: 'weekly', date: '2026-10-01', endTime: '08:00',
}));
const records: AttendanceRecord[] = subjects.map(subject => ({
  id: `attendance-${subject.id}`, subjectId: subject.id, eventId: `class-${subject.id}`,
  date: '2026-10-01', status: 'pending',
}));

async function seed() {
  await mockAsyncStorage.clear();
  await StorageService.saveSubjects(subjects);
  await StorageService.saveEvents(events);
  await StorageService.saveAttendances(records);
  await StorageService.saveTasks([{ id: 'removed-task', title: 'Trabalho', subjectId: subjects[0].id, isCompleted: false },
    { id: 'personal', title: 'Pessoal', isCompleted: false }]);
  await StorageService.saveStudySessions([{ id: 'study', subjectId: subjects[0].id, durationMs: 1000, date: '2026-10-01' }]);
  await StorageService.saveGroupProjects([{ id: 'group', subjectId: subjects[0].id, title: 'Trabalho', deadline: '2026-10-15', members: [], tasks: [] }]);
  await mockAsyncStorage.setItem('@organiza_active_timer', JSON.stringify({ subjectId: subjects[0].id }));
  await mockAsyncStorage.setItem('@organiza_timer_state', JSON.stringify({ subjectId: subjects[0].id }));
}

async function run() {
  await seed();
  assert.equal(await StorageService.deleteSubject(subjects[0].id), true);
  assert.equal((await StorageService.getSubjects()).length, 6);
  assert.equal((await StorageService.getEvents()).length, 6);
  assert.equal((await StorageService.getAttendances()).length, 6);
  assert.deepEqual((await StorageService.getTasks()).map(task => task.id), ['personal']);
  assert.deepEqual(await StorageService.getStudySessions(), []);
  assert.deepEqual(await StorageService.getGroupProjects(), []);
  assert.equal(await mockAsyncStorage.getItem('@organiza_active_timer'), 'null');
  assert.equal(await mockAsyncStorage.getItem('@organiza_timer_state'), 'null');
  // A delayed snapshot must not reintroduce the deleted subject's attendance.
  const generated = await AttendanceService.generatePendingAttendances(events, records, subjects);
  assert.ok(generated.every(record => record.subjectId !== subjects[0].id));
  assert.equal(await StorageService.saveAttendanceRecord({ ...records[0], status: 'present' }), false);
  assert.ok((await StorageService.getAttendances()).every(record => record.subjectId !== subjects[0].id));
  assert.equal(await StorageService.deleteSubject(subjects[0].id), true);
  console.log('PASS: seven subjects become six, related records are removed, stale generation/clicks cannot recreate attendance');

  await seed();
  // Repair legacy orphan events and records after restart, without a fresh deletion.
  await StorageService.saveSubjects(subjects.slice(1));
  const repaired = await AttendanceService.generatePendingAttendances(events, records);
  assert.ok(repaired.every(record => record.subjectId !== subjects[0].id));
  assert.ok((await StorageService.getAttendances()).every(record => record.subjectId !== subjects[0].id));
  await StorageService.repairSubjectRelations();
  assert.equal((await StorageService.getEvents()).length, 6);
  assert.deepEqual((await StorageService.getTasks()).map(task => task.id), ['personal']);
  assert.deepEqual(await StorageService.getStudySessions(), []);
  assert.deepEqual(await StorageService.getGroupProjects(), []);
  assert.equal(filterValidAttendances(records, subjects.slice(1), events).length, 6);
  assert.equal(filterValidAttendances(records, subjects, events.slice(1)).length, 6);
  assert.equal(filterValidAttendances(records, subjects.map((subject, i) => i === 0 ? { ...subject, isArchived: true } : subject), events).length, 6);
  const manual = { ...records[1], id: 'manual', eventId: 'manual', status: 'present' as const };
  assert.deepEqual(filterValidAttendances([manual], subjects, []), [manual]);
  console.log('PASS: legacy orphan and archived-subject requests are removed; valid manual attendance is preserved');

  await seed();
  await Promise.all([
    StorageService.deleteSubject(subjects[0].id),
    StorageService.reconcileAttendances(records),
    StorageService.saveAttendanceRecord({ ...records[0], status: 'present' }),
  ]);
  assert.ok((await StorageService.getAttendances()).every(record => record.subjectId !== subjects[0].id));
  await StorageService.saveAttendanceRecord({ ...records[1], status: 'present' });
  const preserved = await StorageService.reconcileAttendances(records);
  assert.equal(preserved.find(record => record.id === records[1].id)?.status, 'present');
  console.log('PASS: concurrent deletion/generation is serialized and stale snapshots preserve confirmed attendance');

  await seed();
  const originalWrite = mockAsyncStorage.multiSet;
  mockAsyncStorage.multiSet = async () => { throw new Error('Disk failure fixture'); };
  try {
    assert.equal(await StorageService.deleteSubject(subjects[0].id), false);
    assert.equal((await StorageService.getSubjects()).length, 7);
    assert.equal((await StorageService.getEvents()).length, 7);
  } finally { mockAsyncStorage.multiSet = originalWrite; }
  console.log('PASS: storage deletion failure is reported rather than silently claiming success');

  const dismissed: string[] = [];
  const presented = [
    { request: { identifier: 'removed-subject', content: { data: { subjectId: subjects[0].id } } } },
    { request: { identifier: 'removed-event', content: { data: { eventId: events[0].id } } } },
    { request: { identifier: 'other-subject', content: { data: { subjectId: subjects[1].id, eventId: events[1].id } } } },
    { request: { identifier: 'timer', content: { data: { type: 'pomodoro_complete' } } } },
  ];
  mockNotifications.getAllScheduledNotificationsAsync = async () => [];
  mockNotifications.getPresentedNotificationsAsync = async () => presented;
  mockNotifications.dismissNotificationAsync = async id => { dismissed.push(id); };
  await NotificationService.cancelSubjectNotifications(subjects[0].id, [events[0].id]);
  assert.deepEqual(dismissed.sort(), ['removed-event', 'removed-subject']);
  dismissed.length = 0;
  mockNotifications.getPermissionsAsync = async () => ({ status: 'denied' });
  mockNotifications.requestPermissionsAsync = async () => ({ status: 'denied' });
  await NotificationService.syncEventNotifications(events.slice(1), subjects.slice(1));
  assert.deepEqual(dismissed.sort(), ['removed-event', 'removed-subject']);
  console.log('PASS: deletion and startup repair dismiss only orphan tray notifications, even when there are no scheduled alarms');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
