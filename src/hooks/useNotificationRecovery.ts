import { useEffect } from 'react';
import { NotificationService } from '../services/notifications';
import type { AppEvent, AttendanceRecord, Subject } from '../types';

export function useNotificationRecovery(
  isInitializing: boolean, events: AppEvent[], subjects: Subject[], attendances: AttendanceRecord[],
): void {
  useEffect(() => {
    if (isInitializing) return;
    // AppContext reloads these collections on launch, resume and cloud sync.
    // Reconcile with the OS even when the saved events themselves have not changed.
    void NotificationService.syncEventNotifications(events, subjects, attendances, true)
      .catch(error => console.warn('Erro ao recuperar notificações:', error));
  }, [isInitializing, events, subjects, attendances]);
}
