import { AppEvent, Subject } from '../types';

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

// In-memory timer references for web/Tauri
let activeWebTimerTimeout: any = null;
const scheduledEventTimeouts = new Map<string, any[]>();

/**
 * Web/Tauri fallback for NotificationService.
 * Seamlessly interfaces with the browser/Tauri Web Notification API
 * without relying on native mobile push/alarm services.
 */
export const NotificationService = {
  async requestPermissions(): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          return true;
        }
        if (Notification.permission !== 'denied') {
          const perm = await Notification.requestPermission();
          return perm === 'granted';
        }
      }
      return false;
    } catch (e) {
      console.warn('[NotificationService.web] Erro ao requisitar permissão:', e);
      return false;
    }
  },

  async scheduleEventNotifications(event: AppEvent): Promise<void> {
    if (!event || typeof event !== 'object' || !event.id) return;
    try {
      await this.cancelEventNotifications(event.id);
      // In web/desktop, notifications are primarily visual or active timer alerts
    } catch (err) {
      console.warn('[NotificationService.web] Falha ao processar notificações do evento', event?.id, err);
    }
  },

  async cancelEventNotifications(eventId: string): Promise<void> {
    if (!eventId || typeof eventId !== 'string') return;
    const timeouts = scheduledEventTimeouts.get(eventId);
    if (timeouts) {
      timeouts.forEach(t => clearTimeout(t));
      scheduledEventTimeouts.delete(eventId);
    }
  },

  async cancelSubjectNotifications(subjectId: string, eventIds?: string[]): Promise<void> {
    if (!subjectId && (!eventIds || eventIds.length === 0)) return;
    if (Array.isArray(eventIds)) {
      for (const id of eventIds) {
        await this.cancelEventNotifications(id);
      }
    }
  },

  async reconcileAndPurgeOrphanNotifications(
    _activeEvents: AppEvent[],
    _activeSubjects: Subject[]
  ): Promise<{ purgedCount: number }> {
    // Pure no-op on web without orphan native channels
    return { purgedCount: 0 };
  },

  async scheduleNotificationAsync(request: any): Promise<string> {
    try {
      const title = request?.content?.title || 'Lumen';
      const body = request?.content?.body || '';

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
        });
      }
      return 'web-notif-' + Date.now();
    } catch (e) {
      console.warn('[NotificationService.web] Erro ao disparar notificação web:', e);
      return 'web-notif-fallback';
    }
  },

  async scheduleTimerNotification(targetEndTime: number, title?: string, body?: string): Promise<string | null> {
    try {
      await this.cancelTimerNotification();
      const delay = Math.max(0, targetEndTime - Date.now());
      const notifTitle = title || '⏱️ Tempo Concluído!';
      const notifBody = body || 'Seu ciclo de Pomodoro foi finalizado. Parabéns pelo foco!';

      if (typeof window !== 'undefined') {
        activeWebTimerTimeout = setTimeout(() => {
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(notifTitle, {
                body: notifBody,
                icon: '/favicon.ico',
              });
            } catch {}
          }
        }, delay);
      }
      return 'web-timer-' + Date.now();
    } catch (e) {
      console.warn('[NotificationService.web] Erro ao agendar notificação de timer:', e);
      return null;
    }
  },

  async cancelTimerNotification(): Promise<void> {
    if (activeWebTimerTimeout) {
      clearTimeout(activeWebTimerTimeout);
      activeWebTimerTimeout = null;
    }
  }
};
