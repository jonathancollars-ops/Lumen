import './setup_env';
import assert from 'node:assert/strict';
import React from 'react';
import { EventModal } from '../src/components/EventModal';
import { ExamModal } from '../src/components/ExamModal';
import { AgendaScreenWrapper } from '../src/screens/AgendaScreenWrapper';
import { AgendaScreen } from '../src/screens/AgendaScreen';
import { AppProvider } from '../src/contexts/AppContext';
import { StorageService } from '../src/services/storage';
import { NotificationService } from '../src/services/notifications';
import { calculateDaySchedule } from '../src/utils/schedulePlanner';
import { AppEvent } from '../src/types';
import { lastAlertCalls } from './setup_env';

// Execute actual component callbacks without a native renderer. This harness
// models state and effect dependencies; it does not verify native layout.
function harness(component: any, initialProps: any, context?: any) {
  const slots: any[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  let props = initialProps;
  const dispatcher = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next: any) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next;
      }];
    },
    useMemo(factory: any) { return factory(); },
    useCallback(fn: any) { return fn; },
    useRef(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useContext() { return context; },
    useEffect(effect: any, deps: any[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous[i]))) effects.push(effect);
      slots[index] = deps;
    },
  };
  return {
    render(nextProps = props) {
      props = nextProps;
      cursor = 0;
      effects = [];
      const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = dispatcher;
      try { return component(props); } finally { internals.H = previous; }
    },
    flush() { effects.forEach(effect => effect()); },
  };
}

function find(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}

const base: AppEvent = {
  id: 'exam', title: 'Prova de Cálculo', category: 'Provas/Trabalhos',
  date: '2026-09-28', startTime: '08:00', endTime: '10:00',
  recurrence: 'none', alerts: [60], isCompleted: false,
  subjectId: 'math', grade: 8, weight: 2, maxGrade: 10,
  description: 'Capítulo 3', location: 'Sala 102', completedDates: ['2026-09-21'],
};

function saveThroughModal(event: AppEvent): AppEvent {
  let result: AppEvent | undefined;
  const modal = harness(EventModal, {
    visible: true, theme: 'light', initialEvent: event, onClose() {},
    onSave(saved: AppEvent) { result = saved; },
  });
  modal.render();
  modal.flush();
  const tree = modal.render();
  const input = find(tree, node => node.props?.placeholder === 'Título do compromisso');
  input.props.onChangeText('Título atualizado');
  const updated = modal.render();
  const button = find(updated, node => typeof node.props?.onPress === 'function' &&
    React.Children.toArray(node.props.children).some((child: any) => child.props?.children === 'Salvar'));
  assert.ok(button, 'Save button exists');
  button.props.onPress();
  assert.ok(result, 'Modal invokes save callback');
  return result;
}

async function main() {
  const saved = saveThroughModal(base);
  assert.deepEqual(saved, { ...base, title: 'Título atualizado', isImportant: false,
    isNotified: true, recurrenceDays: undefined, recurrenceInterval: undefined,
    recurrenceUnit: undefined, recurrenceMonthDay: undefined });
  const weekly = saveThroughModal({ ...base, recurrence: 'weekly', recurrenceDays: [1, 3, 5] });
  assert.deepEqual(weekly.recurrenceDays, [1, 3, 5]);
  const custom = saveThroughModal({ ...base, recurrence: 'custom_interval',
    recurrenceInterval: 3, recurrenceUnit: 'months', recurrenceMonthDay: 28 });
  assert.equal(custom.recurrenceInterval, 3);
  assert.equal(custom.recurrenceUnit, 'months');
  assert.equal(custom.recurrenceMonthDay, 28);
  const fullDay = saveThroughModal({ ...base, startTime: '08:00', endTime: '08:00' });
  assert.equal(fullDay.endTime, '08:00', 'Editing a full day must not reduce it to five minutes');

  const overnight = calculateDaySchedule([{ ...base, startTime: '20:00', endTime: '02:00' }]);
  assert.equal(overnight.busyBlocks[0].durationMinutes, 360);
  assert.equal(overnight.totalOccupiedMinutes, 120);
  assert.ok(!overnight.freeBlocks.some(block => block.startMinutes >= 1200));
  const ordered = calculateDaySchedule([
    { ...base, id: 'late', startTime: '10:00', endTime: '11:00' },
    { ...base, id: 'early', startTime: '9:00', endTime: '10:00' },
  ]);
  assert.deepEqual(ordered.busyBlocks.map(block => block.eventId), ['early', 'late']);

  await StorageService.saveSettings({ ...(await StorageService.getSettings()), currentSemesterId: '2026.2' });
  await StorageService.saveGamificationData({ xp: 100, level: 2, unlockedAchievements: ['first'],
    claimedAchievements: ['first'], processedEventIds: ['done'], totalFocusMinutes: 50 });
  await StorageService.saveStreak({ currentStreak: 2, longestStreak: 5, bestStreak: 5,
    totalStudyDays: 12, lastStudyDate: '2026-09-27' });
  const provider = harness(AppProvider, { children: null });
  await provider.render().props.value.refreshData();
  let value = provider.render().props.value;
  assert.equal(value.settings.currentSemesterId, '2026.2');
  assert.deepEqual(value.gamification.claimedAchievements, ['first']);
  assert.deepEqual(value.gamification.processedEventIds, ['done']);
  assert.equal(value.streak.totalStudyDays, 12);
  assert.equal(value.streak.bestStreak, 5);

  const scheduled: AppEvent[] = [];
  const originalSchedule = NotificationService.scheduleEventNotifications;
  const originalSave = StorageService.saveEvents;
  try {
    NotificationService.scheduleEventNotifications = async event => { scheduled.push(event); };
    await value.addOrUpdateEvent(base);
    value = provider.render().props.value;
    assert.deepEqual(await StorageService.getEvents(), [base]);
    assert.deepEqual(scheduled, [base]);
    StorageService.saveEvents = async () => false;
    await assert.rejects(value.addOrUpdateEvent({ ...base, title: 'Failed write' }));
    assert.equal(provider.render().props.value.events[0].title, base.title);
    assert.equal(scheduled.length, 1, 'Failed writes do not schedule reminders');
  } finally {
    StorageService.saveEvents = originalSave;
    NotificationService.scheduleEventNotifications = originalSchedule;
  }

  const wrapper = harness(AgendaScreenWrapper, {}, value);
  let tree = wrapper.render();
  find(tree, node => node.type === AgendaScreen).props.onSelectDate('2026-09-28');
  tree = wrapper.render();
  find(tree, node => node.type === AgendaScreen).props.onEditEvent(base);
  tree = wrapper.render();
  const modal = find(tree, node => node.type === EventModal);
  assert.equal(modal.props.visible, true);
  assert.equal(modal.props.isDateLocked, false, 'Existing events can change date');
  const originalAction = value.addOrUpdateEvent;
  value.addOrUpdateEvent = async () => { throw new Error('Disk full'); };
  try {
    tree = wrapper.render();
    await find(tree, node => node.type === EventModal).props.onSave(base);
    assert.equal(find(wrapper.render(), node => node.type === EventModal).props.visible, true);
    assert.equal(lastAlertCalls.at(-1)?.title, 'Não foi possível salvar');
  } finally { value.addOrUpdateEvent = originalAction; }

  const exam = harness(ExamModal, { visible: true, theme: 'light',
    initialDate: '2026-09-27', isDateLocked: true, onClose() {}, onSave() {},
    subjects: [{ id: 'math', name: 'Cálculo' }],
    events: [{ ...base, category: 'Faculdade/Aulas', recurrence: 'weekly', recurrenceDays: [1] }],
  });
  exam.render(); exam.flush(); exam.render(); exam.flush();
  const examTree = exam.render();
  assert.ok(find(examTree, node => React.Children.toArray(node.props?.children)
    .filter(child => typeof child === 'string').join('') === '27/09/2026 (Bloqueado nesta visão)'),
    'Locked exam date remains the selected Sunday, even for a Monday class');
  console.log('Agenda regression checks passed: edit metadata, dates, overnight schedule, hydration and save failures.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
