import './setup_env';
import assert from 'node:assert/strict';
import { mockAsyncStorage, mockReactNative, lastAlertCalls, clearMockAlertCalls } from './setup_env';
import { harness, find, text, button } from './helpers/componentHarness';
import { StorageService } from '../src/services/storage';
import { TimerService } from '../src/services/TimerService';
import { AppProvider } from '../src/contexts/AppContext';
import { StudyScreenWrapper } from '../src/screens/StudyScreenWrapper';
import { StudyScreen } from '../src/screens/StudyScreen';
import { AgendaScreenWrapper } from '../src/screens/AgendaScreenWrapper';
import { AgendaScreen } from '../src/screens/AgendaScreen';
import { EventModal } from '../src/components/EventModal';
import { PendingAttendanceModal } from '../src/components/PendingAttendanceModal';
import { SettingsModal } from '../src/components/SettingsModal';

(mockReactNative as any).useWindowDimensions = () => ({ width: 1440, height: 900 });
mockReactNative.Platform.OS = 'web';
const subjects = [{ id: 'math', name: 'Cálculo' }];
const task = { id: 'task-a', title: 'Resolver exercícios', isCompleted: false };
const components: ReturnType<typeof harness>[] = [];
function mount(component: any, props: any, context?: any) {
  const instance = harness(component, props, context);
  components.push(instance);
  return instance;
}
async function provider() {
  await StorageService.saveSubjects(subjects);
  const instance = mount(AppProvider, { children: null });
  await instance.render().props.value.refreshData();
  return instance;
}
function studyProps(context: any) {
  const wrapper = mount(StudyScreenWrapper, {}, context);
  return find(wrapper.render(), node => node.type === StudyScreen).props;
}
async function failWrite(key: string, action: () => Promise<void>) {
  const original = mockAsyncStorage.setItem;
  mockAsyncStorage.setItem = async (savedKey, value) => {
    if (savedKey === key) throw new Error(`Disk failure fixture: ${key}`);
    return original(savedKey, value);
  };
  try { await action(); } finally { mockAsyncStorage.setItem = original; }
}
let failed = 0;
async function test(name: string, action: () => Promise<void>) {
  await mockAsyncStorage.clear();
  clearMockAlertCalls();
  try { await action(); console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.error(`FAIL: ${name}`, error); }
  finally { components.splice(0).forEach(component => component.unmount()); }
}

async function run() {
  await test('study task creation, completion and deletion survive reload', async () => {
    const state = await provider();
    let context = state.render().props.value;
    await studyProps(context).onUpdateTasks([task]);
    assert.deepEqual(await StorageService.getTasks(), [task]);
    await context.refreshData();
    context = state.render().props.value;
    assert.deepEqual(context.tasks, [task]);
    await studyProps(context).onUpdateTasks([{ ...task, isCompleted: true }]);
    assert.equal((await StorageService.getTasks())[0].isCompleted, true);
    await context.refreshData();
    await studyProps(state.render().props.value).onUpdateTasks([]);
    await context.refreshData();
    assert.deepEqual(state.render().props.value.tasks, []);
  });

  await test('failed task creation keeps the entered title for retry', async () => {
    const state = await provider();
    const context = state.render().props.value;
    const screen = mount(StudyScreen, studyProps(context), context);
    let tree = await screen.settle();
    button(tree, '📝 Tarefas')();
    tree = await screen.settle();
    find(tree, node => node.props?.placeholder === 'Adicionar nova tarefa...').props.onChangeText('Revisar cálculo');
    tree = await screen.settle();
    await failWrite('@organiza_tasks', async () => {
      await find(tree, node => node.props?.placeholder === 'Adicionar nova tarefa...').props.onSubmitEditing();
    });
    tree = await screen.settle();
    assert.equal(find(tree, node => node.props?.placeholder === 'Adicionar nova tarefa...').props.value, 'Revisar cálculo');
    assert.deepEqual(await StorageService.getTasks(), []);
    assert.ok(text(tree, 'Não foi possível salvar a tarefa. Tente novamente.'));
  });

  await test('failed task completion does not award XP or change its saved status', async () => {
    await StorageService.saveTasks([task]);
    const state = await provider();
    const context = state.render().props.value;
    const screen = mount(StudyScreen, studyProps(context), context);
    let tree = await screen.settle();
    button(tree, '📝 Tarefas')();
    tree = await screen.settle();
    const row = find(tree, node => Array.isArray(node.props?.children) &&
      typeof node.props.children[0]?.props?.onPress === 'function' && text(node.props.children[1], task.title));
    assert.ok(row, 'Task checkbox is rendered');
    const before = await StorageService.getGamificationData();
    await failWrite('@organiza_tasks', async () => { await row.props.children[0].props.onPress(); });
    assert.deepEqual(await StorageService.getGamificationData(), before);
    assert.equal((await StorageService.getTasks())[0].isCompleted, false);
  });

  await test('rapid pending-attendance updates preserve both confirmations', async () => {
    const events = ['a', 'b'].map(id => ({ id, subjectId: 'math', title: 'Aula',
      category: 'Faculdade/Aulas', date: '2099-10-18', recurrence: 'none' as const }));
    const records = events.map(event => ({ id: `att-${event.id}`, subjectId: 'math', eventId: event.id,
      date: '2099-10-18', status: 'pending' as const }));
    await StorageService.saveEvents(events);
    await StorageService.saveAttendances(records);
    const state = await provider();
    const wrapper = mount(AgendaScreenWrapper, {}, state.render().props.value);
    const modal = find(wrapper.render(), node => node.type === PendingAttendanceModal);
    await Promise.all([modal.props.onUpdateStatus('att-a', 'present'), modal.props.onUpdateStatus('att-b', 'absent')]);
    const saved = await StorageService.getAttendances();
    assert.equal(saved.find(record => record.id === 'att-a')?.status, 'present');
    assert.equal(saved.find(record => record.id === 'att-b')?.status, 'absent');
  });

  await test('rapid task confirmations preserve both completion states', async () => {
    await StorageService.saveTasks([task, { ...task, id: 'task-b' }]);
    const state = await provider();
    const context = state.render().props.value;
    await Promise.all([context.toggleTaskCompletion('task-a'), context.toggleTaskCompletion('task-b')]);
    assert.ok((await StorageService.getTasks()).every(saved => saved.isCompleted));
    await failWrite('@organiza_tasks', async () => { await context.toggleTaskCompletion('task-a'); });
    assert.ok((await StorageService.getTasks()).every(saved => saved.isCompleted), 'Failed updates keep confirmed tasks');
  });

  await test('concurrent event creation and deletion preserve other edits', async () => {
    const state = await provider();
    const context = state.render().props.value;
    const event = { id: 'event-a', title: 'Revisão', category: 'Pessoal', date: '2099-10-18', recurrence: 'none' };
    await Promise.all([context.addOrUpdateEvent(event), context.addOrUpdateEvent({ ...event, id: 'event-b' })]);
    assert.equal((await StorageService.getEvents()).length, 2);
    await context.refreshData();
    const refreshed = state.render().props.value;
    await Promise.all([refreshed.deleteEvent('event-a'), refreshed.toggleEventCompletion('event-b')]);
    const saved = await StorageService.getEvents();
    assert.equal(saved.length, 1, 'Concurrent completion must not restore a deleted event');
    assert.equal(saved[0].id, 'event-b');
    assert.equal(saved[0].isCompleted, true);
    await failWrite('@organiza_events', async () => {
      await assert.rejects(context.addOrUpdateEvent({ ...event, id: 'failed' }));
      await context.toggleEventCompletion('event-b');
    });
    assert.deepEqual(await StorageService.getEvents(), saved);

    const wrapper = mount(AgendaScreenWrapper, {}, state.render().props.value);
    find(wrapper.render(), node => node.type === AgendaScreen).props.onEditEvent(saved[0]);
    await failWrite('@organiza_events', async () => {
      await find(wrapper.render(), node => node.type === EventModal).props.onDelete('event-b');
    });
    assert.equal(find(wrapper.render(), node => node.type === EventModal).props.visible, true,
      'A failed deletion keeps the event editor open');
    assert.deepEqual(await StorageService.getEvents(), saved);
  });

  await test('zero is preserved as a valid default passing grade', async () => {
    const defaults = await StorageService.getSettings();
    assert.equal(await StorageService.saveSettings({ ...defaults, defaultPassGrade: 0 }), true);
    assert.equal((await StorageService.getSettings()).defaultPassGrade, 0);
    await StorageService.saveSettings({ ...defaults, defaultPassGrade: Infinity });
    assert.equal((await StorageService.getSettings()).defaultPassGrade, defaults.defaultPassGrade);
  });

  await test('clearing all data removes both timer formats', async () => {
    for (const mode of ['pomodoro', 'stopwatch'] as const) {
      await StorageService.saveActiveTimer({ mode, isRunning: false, startedAt: Date.now(),
        remainingSeconds: 60, initialDuration: mode === 'pomodoro' ? 1500 : 0 });
      await StorageService.clearAllData();
      assert.equal(await TimerService.restoreTimerState(), null);
      assert.equal(await StorageService.getActiveTimer(), null);
    }
  });

  await test('settings failures do not publish changes or report success', async () => {
    const settings = await StorageService.getSettings();
    const changes: unknown[] = [];
    const modal = mount(SettingsModal, { visible: true, onClose() {}, theme: 'dark', settings,
      onThemeChange() {}, onUpdateSettings: (updated: unknown) => changes.push(updated) });
    await failWrite('@organiza_settings', async () => { await button(modal.render(), 'Salvar')(); });
    assert.equal(changes.length, 0);
    assert.ok(lastAlertCalls.length > 0);
    assert.notEqual(lastAlertCalls.at(-1)?.title, 'Sucesso');
    const fullscreenSwitch = find(modal.render(), node => node.type === 'Switch');
    await failWrite('@organiza_settings', async () => { await fullscreenSwitch.props.onValueChange(true); });
    assert.equal(changes.length, 0);
    assert.equal(find(modal.render(), node => node.type === 'Switch').props.value, false);
  });

  await test('semester creation failures keep the form and current list', async () => {
    const changes: unknown[] = [];
    const modal = mount(SettingsModal, { visible: true, onClose() {}, theme: 'dark',
      settings: await StorageService.getSettings(), onThemeChange() {}, onUpdateSettings() {},
      semesters: [], onUpdateSemesters: (updated: unknown) => changes.push(updated) });
    button(modal.render(), '📅 Semestres')();
    let tree = modal.render();
    find(tree, node => node.props?.placeholder === 'Ex: 2026.1, 2026.2').props.onChangeText('2027.1');
    tree = modal.render();
    await failWrite('@organiza_semesters', async () => {
      await button(tree, '+ Adicionar')();
      await new Promise(resolve => setImmediate(resolve));
    });
    assert.equal(changes.length, 0);
    assert.equal(find(modal.render(), node => node.props?.placeholder === 'Ex: 2026.1, 2026.2').props.value, '2027.1');
  });
  if (failed) throw new Error(`${failed} persistence regressions failed`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
