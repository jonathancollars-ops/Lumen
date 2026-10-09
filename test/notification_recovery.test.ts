import './setup_env';
import assert from 'node:assert/strict';
import React from 'react';
import type { NotificationRequestInput } from 'expo-notifications';
import { mockNotifications, mockReactNative } from './setup_env';
import { NotificationService } from '../src/services/notifications';
import { useNotificationRecovery } from '../src/hooks/useNotificationRecovery';
import type { AppEvent, AttendanceRecord, Subject } from '../src/types';

const RealDate = Date;
let now = new RealDate('2026-10-05T07:00:00').getTime();
const scheduled = new Map<string, NotificationRequestInput>();
const calls: string[] = [];
let writes = 0;
const exam: AppEvent = {
  id: 'exam', title: 'Prova de Cálculo', category: 'Provas/Trabalhos',
  date: '2026-10-06', startTime: '09:00', endTime: '11:00',
  recurrence: 'none', alerts: [60, 1440], isNotified: true, isCompleted: false,
};
const lesson: AppEvent = {
  ...exam, id: 'class', title: 'Cálculo', category: 'Faculdade/Aulas',
  subjectId: 'math', date: '2026-10-05', startTime: '08:00', endTime: '10:00',
  recurrence: 'weekly', recurrenceDays: [1, 3, 3, 8], alerts: [60, 1440],
};
const subjects: Subject[] = [{ id: 'math', name: 'Cálculo' }];
const attendance = (): NotificationRequestInput[] => [...scheduled.values()]
  .filter(request => request.content.data?.type === 'attendance_reminder');

async function run() {
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) { return args.length ? Reflect.construct(target, args) : new RealDate(now); },
    get(target, key, receiver) { return key === 'now' ? () => now : Reflect.get(target, key, receiver); },
  });
  mockReactNative.Platform.OS = 'android';
  mockNotifications.setNotificationChannelAsync = async () => { calls.push('channel'); };
  mockNotifications.getPermissionsAsync = async () => { calls.push('getPermission'); return { status: 'undetermined' }; };
  mockNotifications.requestPermissionsAsync = async () => { calls.push('requestPermission'); return { status: 'granted' }; };
  mockNotifications.getAllScheduledNotificationsAsync = async () => [...scheduled.values()] as any;
  mockNotifications.cancelScheduledNotificationAsync = async (id?: string) => { scheduled.delete(id!); };
  mockNotifications.scheduleNotificationAsync = async (request?: NotificationRequestInput) => {
    assert.ok(request?.identifier);
    writes++;
    calls.push('schedule');
    scheduled.set(request.identifier, request);
    return request.identifier;
  };

  await NotificationService.syncEventNotifications([exam, lesson], subjects);
  assert.deepEqual(calls.slice(0, 3), ['channel', 'getPermission', 'requestPermission']);
  assert.equal([...scheduled.values()].filter(request => request.content.data?.eventId === exam.id).length, 2);
  const weekly = [...scheduled.values()].filter(request => request.content.data?.type === 'event_reminder' &&
    request.content.data?.eventId === lesson.id);
  assert.equal(weekly.length, 4, 'Both alerts are scheduled for both selected weekdays');
  assert.deepEqual(weekly.map(request => (request.trigger as any).weekday).sort(), [1, 2, 3, 4]);
  assert.equal(attendance().length, 4, 'Two weeks of attendance prompts are scheduled');
  for (const request of attendance()) {
    const date = new RealDate((request.trigger as any).date);
    assert.equal(date.getHours(), 10);
    assert.equal(date.getMinutes(), 1);
    assert.equal(request.content.data?.attendanceDate, `${date.getFullYear()}-10-${String(date.getDate()).padStart(2, '0')}`);
  }

  mockNotifications.getPermissionsAsync = async () => ({ status: 'granted' });
  const firstWrites = writes;
  await NotificationService.syncEventNotifications([exam, lesson], subjects);
  assert.equal(writes, firstWrites, 'Unchanged sync/resume does not reset or duplicate existing alarms');
  const lost = [...scheduled.keys()].find(key => key.startsWith('lumen_exam'))!;
  scheduled.delete(lost);
  await NotificationService.syncEventNotifications([exam, lesson], subjects);
  assert.equal(writes, firstWrites + 1, 'Missing OS alarm is restored without editing the event');
  scheduled.clear();
  await NotificationService.syncEventNotifications([exam, lesson], subjects);
  assert.equal(scheduled.size, 10, 'All saved alerts recover after the OS schedule is lost');
  console.log('PASS: Android channel/permission initialization, multiple weekdays and recovery after update/resume');

  const records: AttendanceRecord[] = [
    { id: 'present', eventId: lesson.id, subjectId: 'math', date: '2026-10-05', status: 'present' },
    { id: 'cancelled', eventId: lesson.id, subjectId: 'math', date: '2026-10-07', status: 'cancelled' },
  ];
  await NotificationService.syncEventNotifications([exam, lesson], subjects, records);
  assert.deepEqual(attendance().map(request => request.content.data?.attendanceDate), ['2026-10-12', '2026-10-14']);
  await NotificationService.syncEventNotifications([lesson], subjects, [{ ...records[0], status: 'absent' }]);
  assert.ok(!attendance().some(request => request.content.data?.attendanceDate === '2026-10-05'));
  await NotificationService.syncEventNotifications([lesson], subjects, [{ ...records[0], status: 'pending' }]);
  assert.ok(attendance().some(request => request.content.data?.attendanceDate === '2026-10-05'));
  now = new RealDate('2026-10-05T10:02:00').getTime();
  await NotificationService.syncEventNotifications([lesson], subjects);
  assert.ok(!attendance().some(request => request.content.data?.attendanceDate === '2026-10-05'),
    'Delivered prompts are not sent again when the app resumes');
  const overnight = { ...lesson, id: 'overnight', startTime: '23:00', endTime: '01:00', recurrenceDays: [1] };
  await NotificationService.syncEventNotifications([overnight], subjects);
  const finish = new RealDate((attendance()[0].trigger as any).date);
  assert.equal(finish.getDate(), 6);
  assert.equal(finish.getHours(), 1);
  assert.equal(finish.getMinutes(), 1);
  console.log('PASS: attendance after class, overnight classes and cancellation of answered prompts');

  scheduled.set('timer', { identifier: 'timer', content: { data: { type: 'pomodoro_complete' } }, trigger: null });
  await NotificationService.syncEventNotifications([{ ...lesson, isNotified: false }], subjects);
  assert.deepEqual([...scheduled.keys()], ['timer']);
  await NotificationService.syncEventNotifications([lesson], [{ ...subjects[0], isArchived: true }]);
  assert.deepEqual([...scheduled.keys()], ['timer']);
  await NotificationService.syncEventNotifications([lesson], []);
  assert.deepEqual([...scheduled.keys()], ['timer']);
  await NotificationService.syncEventNotifications([exam], subjects);
  const edited = { ...exam, startTime: '13:00', alerts: [30], title: 'Prova remarcada' };
  await NotificationService.syncEventNotifications([edited], subjects);
  const reminders = [...scheduled.values()].filter(request => request.content.data?.eventId === exam.id);
  assert.equal(reminders.length, 1);
  assert.ok(reminders[0].content.title?.includes('remarcada'));
  assert.equal(new RealDate((reminders[0].trigger as any).date).getHours(), 12);
  await Promise.all([
    NotificationService.syncEventNotifications([exam], subjects),
    NotificationService.cancelEventNotifications(exam.id),
  ]);
  assert.deepEqual([...scheduled.keys()], ['timer'], 'Deletion waits for an in-flight recovery');
  console.log('PASS: edits, disabled notifications, archived/deleted subjects and concurrent deletion');

  const beforeDenied = writes;
  now = new RealDate('2026-10-05T07:00:00').getTime();
  mockNotifications.getPermissionsAsync = async () => ({ status: 'denied', canAskAgain: false });
  calls.length = 0;
  await NotificationService.syncEventNotifications([exam], subjects);
  assert.equal(writes, beforeDenied);
  assert.ok(!calls.includes('requestPermission'), 'A permanent denial is respected');
  mockNotifications.getPermissionsAsync = async () => ({ status: 'granted' });
  const schedule = mockNotifications.scheduleNotificationAsync;
  let failOnce = true;
  mockNotifications.scheduleNotificationAsync = async request => {
    if (failOnce) { failOnce = false; throw new Error('Injected OS scheduling failure'); }
    return schedule(request);
  };
  await NotificationService.syncEventNotifications([exam], subjects);
  assert.equal([...scheduled.values()].filter(request => request.content.data?.eventId === exam.id).length, 1);
  await NotificationService.syncEventNotifications([exam], subjects);
  assert.equal([...scheduled.values()].filter(request => request.content.data?.eventId === exam.id).length, 2);
  mockNotifications.scheduleNotificationAsync = schedule;
  console.log('PASS: permission denial and retry after an OS scheduling failure');

  const response = { notification: { request: { content: { data: { type: 'attendance_reminder', eventId: lesson.id } } } } };
  let receive: (response: any) => void = () => {};
  let cleared = 0;
  let removed = false;
  mockNotifications.getLastNotificationResponse = () => response as any;
  mockNotifications.addNotificationResponseReceivedListener = listener => {
    receive = listener;
    return { remove() { removed = true; } };
  };
  mockNotifications.clearLastNotificationResponse = () => { cleared++; };
  const received: Record<string, unknown>[] = [];
  const stop = NotificationService.observeNotificationResponses(data => received.push(data));
  assert.equal(received[0].type, 'attendance_reminder', 'Cold-start notification tap is handled');
  receive({ notification: { request: { content: { data: { type: 'event_reminder' } } } } });
  assert.equal(received[1].type, 'event_reminder');
  assert.equal(cleared, 2);
  stop();
  assert.equal(removed, true);

  // Run the actual lifecycle hook with a small effect dispatcher.
  let context = { isInitializing: true, events: [exam], subjects, attendances: [] as AttendanceRecord[] };
  const effects: (() => unknown)[] = [];
  const slots: any[] = [];
  let cursor = 0;
  const dispatcher = {
    useEffect(effect: () => unknown, deps?: any[]) {
      const index = cursor++;
      if (!slots[index] || deps?.some((dep, i) => dep !== slots[index][i])) effects.push(effect);
      slots[index] = deps;
    },
  };
  const render = async () => {
    cursor = 0;
    effects.length = 0;
    const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const previous = internals.H;
    internals.H = dispatcher;
    try { useNotificationRecovery(context.isInitializing, context.events, context.subjects, context.attendances); }
    finally { internals.H = previous; }
    effects.forEach(effect => effect());
    // Drain async work started by effects without scheduling another sync.
    await new Promise(resolve => setImmediate(resolve));
  };
  mockNotifications.getLastNotificationResponse = () => null;
  scheduled.clear();
  await render();
  assert.equal(scheduled.size, 0, 'Recovery waits until persisted data has loaded');
  context = { ...context, isInitializing: false };
  await render();
  assert.equal(scheduled.size, 2, 'Navigator recovers saved exam alerts during startup');
  scheduled.clear();
  context = { ...context, events: [...context.events] };
  await render();
  assert.equal(scheduled.size, 2, 'Reloaded data on resume/cloud sync recovers missing alerts');
  const beforeRearm = writes;
  context = { ...context, events: [...context.events] };
  await render();
  assert.equal(writes, beforeRearm + 2,
    'Resume re-arms native alarms even when Expo still has the persisted requests');
  assert.equal(scheduled.size, 2, 'Re-arming uses the same identifiers without duplicates');
  console.log('PASS: notification taps and application startup/resume integration');
}

run().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { globalThis.Date = RealDate; });
