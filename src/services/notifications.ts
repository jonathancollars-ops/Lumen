import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { AppEvent, AttendanceRecord, Subject } from '../types';
import { parseISO, subMinutes } from 'date-fns';
import { getLocalDateString } from '../utils/date';

// Edits, deletion and recovery share a queue so an older refresh cannot restore
// notifications after an event has been deleted or disabled.
let notificationJob: Promise<unknown> = Promise.resolve();
function runNotificationJob<T>(work: () => Promise<T>): Promise<T> {
  const job = notificationJob.then(work);
  notificationJob = job.catch(() => {});
  return job;
}

async function cancelEventNotifications(eventId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const notification of scheduled ?? []) {
    if (notification.content.data?.eventId === eventId) {
      await Notifications.cancelScheduledNotificationAsync(notification.identifier);
    }
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function formatNotificationTimeNotice(minutesBefore: number, timePart: string): string {
  if (minutesBefore <= 0) return "Começando agora!";
  if (minutesBefore < 60) return `Começa em ${minutesBefore} minutos (${timePart})`;
  if (minutesBefore >= 60 && minutesBefore < 1440) {
    const hours = Math.floor(minutesBefore / 60);
    const remMinutes = minutesBefore % 60;
    if (remMinutes === 0) {
      return `Começa em ${hours} ${hours === 1 ? 'hora' : 'horas'} (${timePart})`;
    }
    return `Começa em ${hours}h ${remMinutes}min (${timePart})`;
  }
  if (minutesBefore === 1440) return `Começa amanhã às ${timePart}`;
  if (minutesBefore === 10080) return `Começa em 1 semana (${timePart})`;
  const days = Math.floor(minutesBefore / 1440);
  return `Começa em ${days} dias (${timePart})`;
}

function hasMonthlyRecurrence(event: AppEvent): boolean {
  return event.recurrence === 'monthly' ||
    (event.recurrence === 'custom_interval' && (!event.recurrenceUnit || event.recurrenceUnit === 'months'));
}

function monthlyNotificationTriggers(
  event: AppEvent, eventDate: Date, minutesBefore: number,
): Notifications.SchedulableNotificationTriggerInput[] {
  const now = Date.now();
  const interval = Number.isFinite(event.recurrenceInterval) && event.recurrenceInterval! > 0
    ? Math.max(1, Math.floor(event.recurrenceInterval!)) : 1;
  const day = Number.isInteger(event.recurrenceMonthDay)
    ? Math.max(1, Math.min(31, event.recurrenceMonthDay!)) : eventDate.getDate();
  const occurrenceAt = (index: number): Date => {
    const date = new Date(eventDate.getFullYear(), eventDate.getMonth() + index * interval, 1,
      eventDate.getHours(), eventDate.getMinutes());
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
    return date;
  };
  const firstOccurrence = occurrenceAt(0);
  const firstAlert = subMinutes(firstOccurrence, minutesBefore);

  // Native repetition is exact for fixed days with alerts in the same month.
  // Other schedules need dated occurrences to preserve intervals and short months.
  if (interval === 1 && day <= 28 && eventDate.getTime() <= now &&
      firstOccurrence.getTime() <= now && firstAlert.getMonth() === firstOccurrence.getMonth() &&
      firstAlert.getFullYear() === firstOccurrence.getFullYear()) {
    return [{
      type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
      day: firstAlert.getDate(), hour: firstAlert.getHours(), minute: firstAlert.getMinutes(),
      channelId: 'default',
    }];
  }

  // Refilled on launch/resume; each alert retains its calendar date and offset.
  const reference = new Date(now + minutesBefore * 60_000);
  const monthDiff = (reference.getFullYear() - eventDate.getFullYear()) * 12 +
    reference.getMonth() - eventDate.getMonth();
  const startIndex = Math.max(0, Math.floor(monthDiff / interval) - 1);
  const triggers: Notifications.SchedulableNotificationTriggerInput[] = [];
  for (let i = startIndex; i < startIndex + 24 && triggers.length < 12; i++) {
    const occurrence = occurrenceAt(i);
    if (occurrence.getTime() < eventDate.getTime()) continue;
    const date = subMinutes(occurrence, minutesBefore).getTime();
    if (Number.isFinite(date) && date > now) {
      triggers.push({ type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: 'default' });
    }
  }
  return triggers;
}

function eventNotificationRequests(event: AppEvent, attendances: AttendanceRecord[]): Notifications.NotificationRequestInput[] {
  if (event.isNotified === false || typeof event.date !== 'string' || typeof event.startTime !== 'string') return [];
  const datePart = event.date.split('T')[0];
  const eventDate = parseISO(`${datePart}T${event.startTime}`);
  if (!Number.isFinite(eventDate.getTime())) return [];
  const requests: Notifications.NotificationRequestInput[] = [];
  const add = (key: string, content: Notifications.NotificationContentInput,
    trigger: Notifications.SchedulableNotificationTriggerInput) => {
    // Persist the intended content and trigger in data: native trigger objects
    // have platform-specific shapes when read back from the OS.
    const signature = JSON.stringify({ content, trigger });
    requests.push({
      identifier: `lumen_${encodeURIComponent(event.id)}_${key}`,
      content: { ...content, data: { ...content.data, notificationSignature: signature } },
      trigger,
    });
  };
  const data = { eventId: event.id, subjectId: event.subjectId || '', category: event.category || '' };
  const days = Array.isArray(event.recurrenceDays)
    ? [...new Set(event.recurrenceDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
  const weekdays = days.length ? days : [eventDate.getDay()];
  const categoryEmoji = event.category?.includes('Prova') || event.title?.toLowerCase().includes('prova')
    ? '📝' : event.category?.includes('Saúde') || event.category?.includes('Academia')
    ? '💪' : event.category?.includes('Lazer') ? '☕' : '📅';

  for (const minutesBefore of new Set(Array.isArray(event.alerts) ? event.alerts : [])) {
    if (!Number.isFinite(minutesBefore) || minutesBefore < 0) continue;
    const timeNotice = formatNotificationTimeNotice(minutesBefore, event.startTime);
    const content: Notifications.NotificationContentInput = {
      title: `${categoryEmoji} ${event.title || 'Compromisso'}`,
      body: event.description ? `${timeNotice} • ${event.description}` : timeNotice,
      data: { ...data, type: 'event_reminder' }, sound: true, vibrate: [0, 250, 250, 250],
    };
    const triggerDate = subMinutes(eventDate, minutesBefore);
    if (!Number.isFinite(triggerDate.getTime())) continue;
    if (event.recurrence === 'daily') {
      add(`alert_${minutesBefore}`, content, {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: triggerDate.getHours(), minute: triggerDate.getMinutes(), channelId: 'default',
      });
    } else if (event.recurrence === 'weekly') {
      for (const day of weekdays) {
        const occurrence = new Date(eventDate);
        occurrence.setDate(occurrence.getDate() + (day - eventDate.getDay() + 7) % 7);
        const alert = subMinutes(occurrence, minutesBefore);
        add(`alert_${minutesBefore}_${day}`, content, {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: alert.getDay() + 1, hour: alert.getHours(), minute: alert.getMinutes(), channelId: 'default',
        });
      }
    } else if (hasMonthlyRecurrence(event)) {
      for (const trigger of monthlyNotificationTriggers(event, eventDate, minutesBefore)) {
        const key = 'date' in trigger ? trigger.date : 'monthly';
        add(`alert_${minutesBefore}_${key}`, content, trigger);
      }
    } else if (triggerDate.getTime() > Date.now()) {
      add(`alert_${minutesBefore}`, content, {
        type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate.getTime(), channelId: 'default',
      });
    }
  }

  // Dated reminders allow an individual class to be confirmed/cancelled without
  // disabling the following weeks. The next two weeks are refilled on resume.
  if (event.category === 'Faculdade/Aulas' && event.subjectId && event.recurrence === 'weekly') {
    const endParts = /^(\d{1,2}):([0-5]\d)$/.exec(event.endTime || '');
    if (!endParts || Number(endParts[1]) > 23) return requests;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    // Include yesterday for a class that finishes after midnight today.
    cursor.setDate(cursor.getDate() - 1);
    for (let i = 0; i < 15; i++, cursor.setDate(cursor.getDate() + 1)) {
      const date = getLocalDateString(cursor);
      if (date < datePart || !weekdays.includes(cursor.getDay())) continue;
      const recorded = attendances.some(record => record.date === date && record.status !== 'pending' &&
        (record.eventId === event.id || (!record.eventId && record.subjectId === event.subjectId)));
      if (recorded) continue;
      const end = new Date(cursor);
      end.setHours(Number(endParts[1]), Number(endParts[2]), 0, 0);
      const start = new Date(cursor);
      start.setHours(eventDate.getHours(), eventDate.getMinutes(), 0, 0);
      if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
      // Leave a minute for the class to end before asking for confirmation.
      end.setMinutes(end.getMinutes() + 1);
      if (end.getTime() <= Date.now()) continue;
      add(`attendance_${date}`, {
        title: `🎓 Confirmar presença: ${event.title || 'Aula'}`,
        body: 'Você esteve presente ou faltou? Toque para registrar sua frequência.',
        sound: true, vibrate: [0, 250, 250, 250],
        data: { ...data, type: 'attendance_reminder', attendanceDate: date },
      }, { type: Notifications.SchedulableTriggerInputTypes.DATE, date: end.getTime(), channelId: 'default' });
    }
  }
  return requests;
}

export const NotificationService = {
  async requestPermissions(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Lumen Acadêmico',
            description: 'Notificações de aulas, provas e estudos do Lumen',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#00FFAA',
            enableLights: true,
            enableVibrate: true,
            showBadge: true,
            bypassDnd: false,
          });
        } catch (channelErr) {
          // Trata com segurança falhas de permissão de canal ou vibração no Android
          console.warn('Erro ao configurar canal de notificação Android (vibração/permissão)', channelErr);
        }
      }

      let existingStatus = 'undetermined';
      let canAskAgain = true;
      try {
        const perm = await Notifications.getPermissionsAsync();
        existingStatus = perm?.status || 'undetermined';
        canAskAgain = perm?.canAskAgain !== false;
      } catch (getErr) {
        // Trata negações ou exceções de leitura de permissões
        console.warn('Erro ao consultar permissões de notificação / alarmes exatos', getErr);
      }

      let finalStatus = existingStatus;
      if (existingStatus !== 'granted' && canAskAgain) {
        try {
          const req = await Notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
            },
            android: {},
          });
          finalStatus = req?.status || 'denied';
        } catch (reqErr) {
          // Trata com try/catch seguro qualquer negação de alarme exato (SCHEDULE_EXACT_ALARM) ou restrição do Android 12+
          console.warn('Erro ao requisitar permissões de notificação do SO (SCHEDULE_EXACT_ALARM / restrições de bateria)', reqErr);
          finalStatus = 'denied';
        }
      }
      return finalStatus === 'granted';
    } catch (e) {
      console.warn('Erro geral ao solicitar permissões de notificação', e);
      return false;
    }
  },

  async scheduleEventNotifications(event: AppEvent, attendances: AttendanceRecord[] = []): Promise<void> {
    if (!event || typeof event !== 'object' || !event.id) return;
    await runNotificationJob(async () => {
      try {
        if (!(await this.requestPermissions())) return;
        await cancelEventNotifications(event.id);
        for (const request of eventNotificationRequests(event, attendances)) {
          try {
            await Notifications.scheduleNotificationAsync(request);
          } catch (error) {
            console.warn('Falha ao agendar notificação do evento', event.id, error);
          }
        }
      } catch (error) {
        console.warn('Falha ao processar notificações do evento', event.id, error);
      }
    });
  },

  async syncEventNotifications(
    events: AppEvent[], subjects: Subject[], attendances: AttendanceRecord[] = [], forceReschedule = false,
  ): Promise<void> {
    await runNotificationJob(async () => {
      if (!(await this.requestPermissions())) return;
      const activeSubjects = new Set(subjects.filter(subject => !subject.isArchived).map(subject => subject.id));
      const desired = new Map<string, Notifications.NotificationRequestInput>();
      for (const event of events) {
        if (!event?.id || (event.subjectId && !activeSubjects.has(event.subjectId))) continue;
        for (const request of eventNotificationRequests(event, attendances)) {
          desired.set(request.identifier!, request);
        }
      }
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const current = new Map((scheduled ?? []).map(notification => [notification.identifier, notification]));
      for (const notification of scheduled ?? []) {
        // Preserve independent notifications such as the active Pomodoro.
        if (notification.content.data?.eventId && !desired.has(notification.identifier)) {
          await Notifications.cancelScheduledNotificationAsync(notification.identifier);
        }
      }
      for (const [identifier, request] of desired) {
        if (!forceReschedule &&
          current.get(identifier)?.content.data?.notificationSignature === request.content.data?.notificationSignature) continue;
        try {
          // The same identifier replaces an edited notification without a
          // cancellation gap. On Android the saved request can survive an OS
          // alarm being dropped, so lifecycle recovery explicitly re-arms it.
          await Notifications.scheduleNotificationAsync(request);
        } catch (error) {
          console.warn('Falha ao recuperar notificação', identifier, error);
        }
      }
    });
  },

  async refreshMonthlyNotifications(events: AppEvent[], subjects: Subject[]): Promise<void> {
    for (const event of events) {
      if (!event || !hasMonthlyRecurrence(event)) continue;
      const subject = subjects.find(subject => subject.id === event.subjectId);
      if (event.subjectId && (!subject || subject.isArchived)) {
        await this.cancelEventNotifications(event.id);
      } else {
        await this.scheduleEventNotifications(event);
      }
    }
  },

  async cancelEventNotifications(eventId: string): Promise<void> {
    if (!eventId || typeof eventId !== 'string') return;
    await runNotificationJob(() => cancelEventNotifications(eventId))
      .catch(error => console.warn('Falha ao cancelar notificações', eventId, error));
  },

  async cancelSubjectNotifications(subjectId: string, eventIds?: string[]): Promise<void> {
    if (!subjectId && (!eventIds || eventIds.length === 0)) return;
    await runNotificationJob(async () => {
      try {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        if (!Array.isArray(scheduled) || scheduled.length === 0) return;

        const eventIdSet = new Set<string>(
          Array.isArray(eventIds) ? eventIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
        );
        const toCancel: string[] = [];

        for (const notif of scheduled) {
          const notifData = notif?.content?.data as { eventId?: string; subjectId?: string; category?: string } | undefined;
          if (!notifData || typeof notifData !== 'object') continue;

          const notifSubjectId = typeof notifData.subjectId === 'string' ? notifData.subjectId : '';
          const notifEventId = typeof notifData.eventId === 'string' ? notifData.eventId : '';

          const matchesSubject = Boolean(subjectId && notifSubjectId === subjectId);
          const matchesEvent = Boolean(notifEventId && eventIdSet.has(notifEventId));

          if (matchesSubject || matchesEvent) {
            if (notif.identifier) {
              toCancel.push(notif.identifier);
            }
          }
        }

        if (toCancel.length > 0) {
          await Promise.all(toCancel.map(id => Notifications.cancelScheduledNotificationAsync(id)));
        }
      } catch (e) {
        console.warn('Falha ao cancelar notificações da matéria em lote', subjectId, e);
      }
    });
  },

  async reconcileAndPurgeOrphanNotifications(
    activeEvents: AppEvent[],
    activeSubjects: Subject[]
  ): Promise<{ purgedCount: number }> {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      if (!Array.isArray(scheduled) || scheduled.length === 0) {
        return { purgedCount: 0 };
      }

      const activeEventMap = new Map<string, AppEvent>();
      if (Array.isArray(activeEvents)) {
        for (const e of activeEvents) {
          if (e && typeof e.id === 'string') {
            activeEventMap.set(e.id, e);
          }
        }
      }

      const activeSubjectIdSet = new Set<string>();
      if (Array.isArray(activeSubjects)) {
        for (const s of activeSubjects) {
          if (s && typeof s.id === 'string') {
            activeSubjectIdSet.add(s.id);
          }
        }
      }

      const toCancel: string[] = [];

      for (const notif of scheduled) {
        const data = notif?.content?.data as { eventId?: string; subjectId?: string; category?: string } | undefined;
        if (!data || typeof data !== 'object') continue;

        const eventId = typeof data.eventId === 'string' && data.eventId.trim() !== '' ? data.eventId : undefined;
        const subjectId = typeof data.subjectId === 'string' && data.subjectId.trim() !== '' ? data.subjectId : undefined;

        let isOrphan = false;

        // If notification is tied to an eventId, verify event exists and its subject (if any) is valid
        if (eventId) {
          const associatedEvent = activeEventMap.get(eventId);
          if (!associatedEvent) {
            isOrphan = true;
          } else if (associatedEvent.subjectId && !activeSubjectIdSet.has(associatedEvent.subjectId)) {
            isOrphan = true;
          }
        }

        // If notification is tied to a subjectId directly, verify subject exists
        if (subjectId && !activeSubjectIdSet.has(subjectId)) {
          isOrphan = true;
        }

        if (isOrphan && notif.identifier) {
          toCancel.push(notif.identifier);
        }
      }

      if (toCancel.length > 0) {
        await Promise.all(toCancel.map(id => Notifications.cancelScheduledNotificationAsync(id)));
      }

      return { purgedCount: toCancel.length };
    } catch (e) {
      console.warn('Falha ao reconciliar e purgar notificações órfãs:', e);
      return { purgedCount: 0 };
    }
  },

  observeNotificationResponses(listener: (data: Record<string, unknown>) => void): () => void {
    const handle = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data;
      if (data?.type !== 'attendance_reminder' && data?.type !== 'event_reminder') return;
      listener(data);
      Notifications.clearLastNotificationResponse();
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(handle);
    handle(Notifications.getLastNotificationResponse());
    return () => subscription.remove();
  },

  async scheduleNotificationAsync(request: Notifications.NotificationRequestInput): Promise<string> {
    return await Notifications.scheduleNotificationAsync(request);
  },

  async scheduleTimerNotification(targetEndTime: number, title?: string, body?: string): Promise<string | null> {
    try {
      await this.cancelTimerNotification();
      return await Notifications.scheduleNotificationAsync({
        identifier: 'lumen_active_pomodoro_completion',
        content: {
          title: title || '⏱️ Tempo Concluído!',
          body: body || 'Seu ciclo de Pomodoro foi finalizado. Parabéns pelo foco!',
          sound: true,
          data: { type: 'pomodoro_complete' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(targetEndTime),
        },
      });
    } catch (e) {
      console.warn('[NotificationService] Erro ao agendar notificação de timer:', e);
      return null;
    }
  },

  async cancelTimerNotification(): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync('lumen_active_pomodoro_completion');
    } catch (e) {
      // Ignored safely
    }
  }
};
