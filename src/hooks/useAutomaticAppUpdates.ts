import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { AppUpdateService } from '../services/AppUpdateService';
import type { AppUpdateInfo } from '../types';

export function useAutomaticAppUpdates(onAvailable: (info: AppUpdateInfo) => void): void {
  const callback = useRef(onAvailable);
  callback.current = onAvailable;
  useEffect(() => {
    let mounted = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const info = await AppUpdateService.checkForUpdates();
        if (!mounted || !info?.hasUpdate || !(await AppUpdateService.shouldShowAutomaticPrompt(info.latestVersion))) return;
        if (!mounted) return;
        await AppUpdateService.recordPromptDismissed(info.latestVersion);
        if (mounted) callback.current(info);
      } catch {
        // Offline checks can retry when the app resumes or reconnects.
      } finally {
        checking = false;
      }
    };
    void check();
    const resume = () => { void check(); };
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') resume(); });
    // Check long-running Windows sessions too; the service limits successful
    // network checks to once every three hours.
    const interval = setInterval(resume, 15 * 60 * 1000);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('focus', resume);
      window.addEventListener('online', resume);
    }
    return () => {
      mounted = false;
      subscription.remove();
      clearInterval(interval);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('focus', resume);
        window.removeEventListener('online', resume);
      }
    };
  }, []);
}
