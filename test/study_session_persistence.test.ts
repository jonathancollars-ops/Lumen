import './setup_env';
import assert from 'node:assert/strict';
import { mockAsyncStorage, mockReactNative } from './setup_env';
import { StorageService } from '../src/services/storage';
import { TimerService } from '../src/services/TimerService';
import { subscribeStorageChanges } from '../src/services/StorageChanges';
import { AppProvider } from '../src/contexts/AppContext';
import { StudyScreenWrapper } from '../src/screens/StudyScreenWrapper';
import { StudyScreen } from '../src/screens/StudyScreen';

import { harness, find, text, button } from './helpers/componentHarness';

const intervals = new Map<number, () => void>();
const originalInterval = globalThis.setInterval;
const originalClear = globalThis.clearInterval;
let intervalId = 0;
globalThis.setInterval = ((callback: () => void) => {
  intervals.set(++intervalId, callback);
  return intervalId;
}) as any;
globalThis.clearInterval = ((id: number) => intervals.delete(id)) as any;
(mockReactNative as any).useWindowDimensions = () => ({ width: 1440, height: 900 });
mockReactNative.Platform.OS = 'web';
const mounted: ReturnType<typeof harness>[] = [];
function mount(component: any, props: any, context?: any) {
  const result = harness(component, props, context);
  mounted.push(result);
  return result;
}

async function run() {
  await mockAsyncStorage.clear();
  const subjects = [{ id: 'math', name: 'Cálculo' }];
  await StorageService.saveSubjects(subjects);
  const provider = mount(AppProvider, { children: null });
  await provider.render().props.value.refreshData();
  let context = provider.render().props.value;
  const wrapper = mount(StudyScreenWrapper, {}, context);
  const screenProps = find(wrapper.render(), node => node.type === StudyScreen).props;

  // Complete a real Pomodoro through the screen's restoration/completion callback.
  await StorageService.saveActiveTimer({ mode: 'pomodoro', isRunning: false,
    startedAt: Date.now() - 1500000, remainingSeconds: 0, initialDuration: 1500, subjectId: 'math' });
  const pomodoro = mount(StudyScreen, screenProps, context);
  await pomodoro.settle();
  let saved = await StorageService.getStudySessions();
  assert.equal(saved.length, 1, 'Completed Pomodoro is written to storage');
  assert.equal(saved[0].durationMs, 25 * 60000);
  assert.equal(await TimerService.getTimerState(), null, 'Timer cleared only after saving');
  pomodoro.unmount();
  console.log('PASS: Pomodoro completion persists through the real screen/wrapper/provider');

  // Restore a paused stopwatch and save through the actual button, including double clicks.
  await StorageService.saveActiveTimer({ mode: 'stopwatch', isRunning: false,
    startedAt: Date.now() - 90000, remainingSeconds: 90, initialDuration: 0, subjectId: 'math' });
  const stopwatch = mount(StudyScreen, screenProps, context);
  let tree = await stopwatch.settle();
  button(tree, '⏱️ Cronômetro')();
  tree = await stopwatch.settle();
  assert.ok(text(tree, '01:30'));
  const save = button(tree, '💾 Salvar');
  await Promise.all([save(), save()]);
  tree = await stopwatch.settle();
  saved = await StorageService.getStudySessions();
  assert.equal(saved.length, 2, 'Double click saves exactly one stopwatch session');
  assert.equal(saved[1].durationMs, 90000);
  assert.ok(text(tree, '00:00'), 'Stopwatch resets after persistence succeeds');
  stopwatch.unmount();

  await context.refreshData();
  assert.equal(provider.render().props.value.studySessions.length, 2, 'Refresh retains both sessions');
  const restarted = mount(AppProvider, { children: null });
  await restarted.render().props.value.refreshData();
  assert.deepEqual(restarted.render().props.value.studySessions, saved, 'A fresh provider restores history');
  console.log('PASS: stopwatch save, double click, refresh and restart preserve history');

  // Disk failure must keep the stopwatch and withhold XP/success/reset.
  await StorageService.saveActiveTimer({ mode: 'stopwatch', isRunning: false,
    startedAt: Date.now() - 90000, remainingSeconds: 90, initialDuration: 0, subjectId: 'math' });
  const retry = mount(StudyScreen, screenProps, context);
  tree = await retry.settle();
  button(tree, '⏱️ Cronômetro')();
  tree = await retry.settle();
  const xpBefore = await StorageService.getGamificationData();
  const originalWrite = mockAsyncStorage.setItem;
  mockAsyncStorage.setItem = async (key, value) => {
    if (key === '@organiza_studysessions') throw new Error('Disk failure fixture');
    return originalWrite(key, value);
  };
  try { await button(tree, '💾 Salvar')(); } finally { mockAsyncStorage.setItem = originalWrite; }
  tree = await retry.settle();
  assert.ok(text(tree, '01:30'), 'Failed write preserves stopwatch time');
  assert.equal((await StorageService.getStudySessions()).length, 2);
  assert.deepEqual(await StorageService.getGamificationData(), xpBefore, 'No XP for an unsaved session');
  assert.ok((await TimerService.getTimerState())?.accumulatedSeconds === 90);
  await button(tree, '💾 Salvar')();
  assert.equal((await StorageService.getStudySessions()).length, 3, 'Failed save can be retried');
  retry.unmount();
  console.log('PASS: failed writes preserve the timer and retry without false success or XP');

  // A paused custom Pomodoro keeps its remaining time and original duration.
  await StorageService.saveActiveTimer({ mode: 'pomodoro', isRunning: false,
    startedAt: Date.now(), remainingSeconds: 1200, initialDuration: 2700, subjectId: 'math' });
  const paused = mount(StudyScreen, screenProps, context);
  tree = await paused.settle();
  assert.ok(text(tree, '20:00'));
  button(tree, '▶️ Iniciar Foco')();
  await paused.settle();
  for (const callback of [...intervals.values()]) callback();
  tree = await paused.settle();
  button(tree, '⏸️ Pausar')();
  tree = await paused.settle();
  assert.ok(text(tree, '19:59'), 'Pausing does not reset to the configured default');
  const timer = await TimerService.getTimerState();
  assert.equal(timer?.targetDuration, 2700, 'Custom duration survives restoration');
  assert.equal(timer?.isRunning, false);
  paused.unmount();
  console.log('PASS: restoring and pausing a custom Pomodoro keeps its progress');

  // A completed custom Pomodoro must remain recoverable if its session write fails.
  await StorageService.saveActiveTimer({ mode: 'pomodoro', isRunning: false,
    startedAt: Date.now() - 2700000, remainingSeconds: 0, initialDuration: 2700, subjectId: 'math' });
  mockAsyncStorage.setItem = async (key, value) => {
    if (key === '@organiza_studysessions') throw new Error('Pomodoro disk failure fixture');
    return originalWrite(key, value);
  };
  const failedPomodoro = mount(StudyScreen, screenProps, context);
  try { tree = await failedPomodoro.settle(); } finally { mockAsyncStorage.setItem = originalWrite; }
  assert.equal((await StorageService.getStudySessions()).length, 3);
  assert.equal((await TimerService.getTimerState())?.targetDuration, 2700, 'Failed completion retains saved timer');
  button(tree, '▶️ Iniciar Foco')();
  await failedPomodoro.settle();
  saved = await StorageService.getStudySessions();
  assert.equal(saved.length, 4);
  assert.equal(saved[3].durationMs, 45 * 60000, 'Retry retains the restored custom duration');
  failedPomodoro.unmount();

  await StorageService.saveActiveTimer({ mode: 'pomodoro', isRunning: false, isBreak: true,
    startedAt: Date.now() - 300000, remainingSeconds: 0, initialDuration: 300, subjectId: 'math' });
  const completedBreak = mount(StudyScreen, screenProps, context);
  await completedBreak.settle();
  assert.equal((await StorageService.getStudySessions()).length, 4, 'Rest breaks do not become study sessions');
  completedBreak.unmount();
  console.log('PASS: failed Pomodoro completion can be retried with its original duration; breaks are excluded');

  // Appending reads inside the shared queue and emits the existing cloud-sync signal.
  const changes: string[] = [];
  const stop = subscribeStorageChanges(key => changes.push(key));
  const first = { id: 'concurrent-a', subjectId: 'math', date: '2026-10-18', durationMs: 60000 };
  const second = { ...first, id: 'concurrent-b' };
  await Promise.all([context.addStudySession(first), context.addStudySession(second)]);
  await context.addStudySession(first);
  stop();
  saved = await StorageService.getStudySessions();
  assert.equal(saved.length, 6, 'Concurrent appends retain both sessions without duplicates');
  assert.equal(changes.filter(key => key === '@organiza_studysessions').length, 2);
  console.log('PASS: concurrent appends preserve history and notify cloud sync');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  mounted.forEach(component => component.unmount());
  globalThis.setInterval = originalInterval;
  globalThis.clearInterval = originalClear;
});
