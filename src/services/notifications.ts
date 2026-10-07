import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { AppEvent, Subject } from '../types';
import { parseISO, subMinutes } from 'date-fns';

const eventNotificationJobs = new Map<string, Promise<void>>();

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
      try {
        const perm = await Notifications.getPermissionsAsync();
        existingStatus = perm?.status || 'undetermined';
      } catch (getErr) {
        // Trata negações ou exceções de leitura de permissões
        console.warn('Erro ao consultar permissões de notificação / alarmes exatos', getErr);
      }

      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
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

  async scheduleEventNotifications(event: AppEvent): Promise<void> {
    if (!event || typeof event !== 'object' || !event.id) return;

    // A refresh and an edit must finish cancelling/scheduling in request order.
    const previous = eventNotificationJobs.get(event.id) ?? Promise.resolve();
    const job = previous.then(async () => {
      try {
        // First, cancel any existing notifications for this event
        await this.cancelEventNotifications(event.id);

        if (event.isNotified === false || !Array.isArray(event.alerts) || event.alerts.length === 0) return;
        if (!event.date || typeof event.date !== 'string' || !event.startTime) return;

        const datePart = event.date.split('T')[0];
        const timePart = typeof event.startTime === 'string' && event.startTime.includes(':')
          ? event.startTime
          : '08:00';
        const eventDate = parseISO(`${datePart}T${timePart}:00`);
      
        if (isNaN(eventDate.getTime())) return;

        const categoryEmoji = event.category?.includes('Prova') || event.title?.toLowerCase().includes('prova')
          ? '📝'
          : event.category?.includes('Saúde') || event.category?.includes('Academia')
          ? '💪'
          : event.category?.includes('Lazer')
          ? '☕'
          : '📅';

        for (const minutesBefore of event.alerts) {
          if (!Number.isFinite(minutesBefore)) continue;
          const triggerDate = subMinutes(eventDate, minutesBefore);
          if (isNaN(triggerDate.getTime())) continue;

          const hour = triggerDate.getHours();
          const minute = triggerDate.getMinutes();

          const timeNotice = formatNotificationTimeNotice(minutesBefore, timePart);

          const content = {
            title: `${categoryEmoji} ${event.title || 'Compromisso'}`,
            body: event.description ? `${timeNotice} • ${event.description}` : timeNotice,
            data: {
              eventId: event.id,
              subjectId: event.subjectId || '',
              category: event.category || '',
            },
            sound: true,
            vibrate: [0, 250, 250, 250],
          };

          try {
            if (event.recurrence === 'daily') {
              // Daily recurring notification
              await Notifications.scheduleNotificationAsync({
                content,
                trigger: {
                  type: Notifications.SchedulableTriggerInputTypes.DAILY,
                  hour,
                  minute,
                  channelId: 'default',
                },
              });
            } else if (event.recurrence === 'weekly') {
              // Weekly recurring notification
              // Note: date-fns getDay returns 0-6 (Sun-Sat). Expo requires 1-7 (Sun-Sat).
              const triggerWeekday = triggerDate.getDay() + 1;
              await Notifications.scheduleNotificationAsync({
                content,
                trigger: {
                  type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
                  weekday: triggerWeekday,
                  hour,
                  minute,
                  channelId: 'default',
                },
              });
            } else if (hasMonthlyRecurrence(event)) {
              for (const trigger of monthlyNotificationTriggers(event, eventDate, minutesBefore)) {
                await Notifications.scheduleNotificationAsync({ content, trigger });
              }
            } else {
              // One-time notification
              if (triggerDate.getTime() > Date.now()) {
                await Notifications.scheduleNotificationAsync({
                  content,
                  trigger: {
                    type: Notifications.SchedulableTriggerInputTypes.DATE,
                    date: triggerDate.getTime(),
                    channelId: 'default',
                  },
                });
              }
            }
          } catch (scheduleErr) {
            // Gracefully suppress OS denial / exact alarm rejection for this single alert
            console.warn(`Falha ao agendar alerta (${minutesBefore}min) do evento ${event.id}`, scheduleErr);
          }
        }
      } catch (err) {
        console.warn('Falha ao processar notificações do evento', event?.id, err);
      }
    });
    eventNotificationJobs.set(event.id, job);
    try { await job; }
    finally {
      if (eventNotificationJobs.get(event.id) === job) eventNotificationJobs.delete(event.id);
    }
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
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      if (Array.isArray(scheduled)) {
        for (const notif of scheduled) {
          if (notif?.content?.data?.eventId === eventId) {
            await Notifications.cancelScheduledNotificationAsync(notif.identifier);
          }
        }
      }
    } catch (e) {
      console.warn('Falha ao cancelar notificações', eventId, e);
    }
  },

  async cancelSubjectNotifications(subjectId: string, eventIds?: string[]): Promise<void> {
    if (!subjectId && (!eventIds || eventIds.length === 0)) return;
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
