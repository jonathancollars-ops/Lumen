import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  AppState,
  AppStateStatus
} from 'react-native';
import { Subject, ThemeType, StudyTask, StudySession, StudyStreak, GamificationData, ActiveTimerState, SavedTimerState } from '../types';
import { getThemeColors, getContrastTextColor } from '../theme';
import { generateId, getLocalDateString } from '../utils';
import { StorageService } from '../services/storage';
import { NotificationService } from '../services/notifications';
import { TimerService, toActiveTimerState } from '../services/TimerService';
import { useTimerAppState } from '../hooks/useTimerAppState';
import { useResponsive } from '../hooks/useResponsive';
import { useApp, AppContextData } from '../contexts/AppContext';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';

interface Props {
  subjects: Subject[];
  tasks: StudyTask[];
  onUpdateTasks: (tasks: StudyTask[]) => void;
  sessions: StudySession[];
  onAddSession: (session: StudySession) => void;
  theme: ThemeType;
  focusMinutesDefault?: number;
  breakMinutesDefault?: number;
  onOpenAchievements?: () => void;
  onOpenAnalytics?: () => void;
  onAddNewSubject?: () => void;
}

export const StudyScreen: React.FC<Props> = ({
  subjects,
  tasks,
  onUpdateTasks,
  sessions,
  onAddSession,
  theme,
  focusMinutesDefault = 25,
  breakMinutesDefault = 5,
  onOpenAchievements,
  onOpenAnalytics,
  onAddNewSubject,
}) => {
  const navigation = useNavigation<any>();
  const colors = getThemeColors(theme);
  const isDark = theme !== 'light';
  const styles = getStyles(colors);
  const { isDesktop, hasWideContent } = useResponsive();

  let appContext: AppContextData | null = null;
  try {
    appContext = useApp();
  } catch {
    // Outside AppProvider in isolated tests
  }

  const [activeTab, setActiveTab] = useState<'pomodoro' | 'cronometro' | 'tarefas'>('pomodoro');
  const [gamification, setGamification] = useState<GamificationData | null>(null);
  
  // Pomodoro State
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(Array.isArray(subjects) && subjects.length > 0 ? subjects[0].id : null);
  const [activeFocusMinutes, setActiveFocusMinutes] = useState<number>(focusMinutesDefault);
  const [timeLeft, setTimeLeft] = useState(focusMinutesDefault * 60);
  const [isActive, setIsActive] = useState(false);
  const [isBreak, setIsBreak] = useState(false);

  // Stopwatch (Cronômetro Livre) State
  const [stopwatchSeconds, setStopwatchSeconds] = useState(0);
  const [isStopwatchRunning, setIsStopwatchRunning] = useState(false);
  const [stopwatchSubjectId, setStopwatchSubjectId] = useState<string | null>(Array.isArray(subjects) && subjects.length > 0 ? subjects[0].id : null);

  // Banner/Toast message instead of browser alert
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'warning' } | null>(null);

  // Streak State
  const [streak, setStreak] = useState<StudyStreak>({ currentStreak: 0, longestStreak: 0, lastStudyDate: '' });

  // Tarefas State
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [taskSubjectId, setTaskSubjectId] = useState<string | null>(null);
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [selectedFilterSubject, setSelectedFilterSubject] = useState<string | null>(null);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const stopwatchRef = useRef<NodeJS.Timeout | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const taskInputRef = useRef<TextInput>(null);

  // Refs de sincronização resiliente contra stale closures no ciclo de vida (AppState)
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const timeLeftRef = useRef(timeLeft);
  timeLeftRef.current = timeLeft;
  const isBreakRef = useRef(isBreak);
  isBreakRef.current = isBreak;
  const activeFocusMinutesRef = useRef(activeFocusMinutes);
  activeFocusMinutesRef.current = activeFocusMinutes;
  const focusMinutesDefaultRef = useRef(focusMinutesDefault);
  focusMinutesDefaultRef.current = focusMinutesDefault;
  const breakMinutesDefaultRef = useRef(breakMinutesDefault);
  breakMinutesDefaultRef.current = breakMinutesDefault;
  const selectedSubjectIdRef = useRef(selectedSubjectId);
  selectedSubjectIdRef.current = selectedSubjectId;
  const isStopwatchRunningRef = useRef(isStopwatchRunning);
  isStopwatchRunningRef.current = isStopwatchRunning;
  const stopwatchSecondsRef = useRef(stopwatchSeconds);
  stopwatchSecondsRef.current = stopwatchSeconds;
  const stopwatchSubjectIdRef = useRef(stopwatchSubjectId);
  stopwatchSubjectIdRef.current = stopwatchSubjectId;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const loadStreak = async () => {
    const s = await StorageService.getStreak();
    const g = await StorageService.getGamificationData();
    setStreak(s);
    setGamification(g);
  };

  const updateStreakOnSessionSaved = async () => {
    const todayStr = getLocalDateString();
    let newStreak = { ...streak };

    if (streak.lastStudyDate === todayStr) {
      // already studied today
      return;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    if (streak.lastStudyDate === yesterdayStr) {
      newStreak.currentStreak += 1;
    } else {
      newStreak.currentStreak = 1;
    }

    if (newStreak.currentStreak > newStreak.longestStreak) {
      newStreak.longestStreak = newStreak.currentStreak;
    }
    newStreak.lastStudyDate = todayStr;

    setStreak(newStreak);
    await StorageService.saveStreak(newStreak);
  };

  const showToast = (text: string, type: 'success' | 'info' | 'warning' = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage({ text, type });
    Haptics.notificationAsync(
      type === 'success' 
        ? Haptics.NotificationFeedbackType.Success 
        : Haptics.NotificationFeedbackType.Warning
    );
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const handlePomodoroComplete = async (
    forcedIsBreak?: boolean,
    forcedSubjectId?: string,
    forcedInitialDurationSec?: number
  ) => {
    setIsActive(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    await NotificationService.cancelTimerNotification();
    
    const breakStatus = typeof forcedIsBreak === 'boolean' ? forcedIsBreak : isBreak;
    const subId = forcedSubjectId || selectedSubjectId || (subjects.length > 0 ? subjects[0].id : 'general');
    
    if (!breakStatus) {
      const sessionDurationMin = forcedInitialDurationSec 
        ? Math.max(1, Math.round(forcedInitialDurationSec / 60))
        : (activeFocusMinutes || focusMinutesDefault);
      const newSession: StudySession = {
        id: generateId('sess'),
        subjectId: subId,
        durationMs: sessionDurationMin * 60 * 1000,
        date: getLocalDateString(),
        startTime: new Date().toISOString(),
      };
      onAddSession(newSession);
      await updateStreakOnSessionSaved();
      const updatedGamification = await StorageService.addXP(50, sessionDurationMin);
      setGamification(updatedGamification);
      showToast(`🎉 Sessão de ${sessionDurationMin}min concluída! (+50 XP) Hora do descanso.`, 'success');
      setIsBreak(true);
      setTimeLeft(breakMinutesDefault * 60);

      if (appContext?.saveActiveTimer) {
        await appContext.saveActiveTimer(null);
      } else {
        await StorageService.saveActiveTimer(null);
      }
    } else {
      showToast('⚡ Descanso finalizado! Hora de retomar o foco.', 'info');
      setIsBreak(false);
      setTimeLeft((activeFocusMinutes || focusMinutesDefault) * 60);

      if (appContext?.saveActiveTimer) {
        await appContext.saveActiveTimer(null);
      } else {
        await StorageService.saveActiveTimer(null);
      }
    }
  };

  const saveCurrentTimerOnBackground = useCallback(async () => {
    try {
      const isStopwatch = isStopwatchRunningRef.current;
      const isPomo = isActiveRef.current;
      const currentTab = activeTabRef.current;
      const now = Date.now();

      if (isStopwatch) {
        const currentSeconds = stopwatchSecondsRef.current;
        const subId = stopwatchSubjectIdRef.current || undefined;
        const stateToSave: SavedTimerState = {
          mode: 'stopwatch',
          isRunning: true,
          accumulatedSeconds: currentSeconds,
          lastSavedTimestamp: now,
          targetDuration: 0,
          remainingSeconds: currentSeconds,
          initialDuration: 0,
          subjectId: subId,
          isBreak: false,
        };
        await TimerService.saveTimerState(stateToSave);
        if (appContext?.saveTimerState) {
          await appContext.saveTimerState(stateToSave);
        }
      } else if (isPomo) {
        const currentSecondsRemaining = timeLeftRef.current;
        const targetDuration = (activeFocusMinutesRef.current || focusMinutesDefaultRef.current) * 60;
        const accumulated = Math.max(0, targetDuration - currentSecondsRemaining);
        const subId = selectedSubjectIdRef.current || undefined;
        const stateToSave: SavedTimerState = {
          mode: 'pomodoro',
          isRunning: true,
          accumulatedSeconds: accumulated,
          lastSavedTimestamp: now,
          targetDuration,
          remainingSeconds: currentSecondsRemaining,
          initialDuration: targetDuration,
          subjectId: subId,
          isBreak: isBreakRef.current,
        };
        await TimerService.saveTimerState(stateToSave);
        if (appContext?.saveTimerState) {
          await appContext.saveTimerState(stateToSave);
        }

        if (!isBreakRef.current) {
          const targetEndTime = now + (currentSecondsRemaining * 1000);
          const subName = subjects.find(s => s.id === subId)?.name || 'Estudos';
          await NotificationService.scheduleTimerNotification(
            targetEndTime,
            '⏱️ Ciclo de Estudo Concluído!',
            `Seu ciclo de Pomodoro de ${subName} foi finalizado. Parabéns pelo foco!`
          );
        }
      } else {
        if (currentTab === 'cronometro' && stopwatchSecondsRef.current > 0) {
          const stateToSave: SavedTimerState = {
            mode: 'stopwatch',
            isRunning: false,
            accumulatedSeconds: stopwatchSecondsRef.current,
            lastSavedTimestamp: now,
            targetDuration: 0,
            remainingSeconds: stopwatchSecondsRef.current,
            initialDuration: 0,
            subjectId: stopwatchSubjectIdRef.current || undefined,
            isBreak: false,
          };
          await TimerService.saveTimerState(stateToSave);
          if (appContext?.saveTimerState) {
            await appContext.saveTimerState(stateToSave);
          }
        } else if (currentTab === 'pomodoro') {
          const targetDuration = (activeFocusMinutesRef.current || focusMinutesDefaultRef.current) * 60;
          if (timeLeftRef.current < targetDuration) {
            const accumulated = Math.max(0, targetDuration - timeLeftRef.current);
            const stateToSave: SavedTimerState = {
              mode: 'pomodoro',
              isRunning: false,
              accumulatedSeconds: accumulated,
              lastSavedTimestamp: now,
              targetDuration,
              remainingSeconds: timeLeftRef.current,
              initialDuration: targetDuration,
              subjectId: selectedSubjectIdRef.current || undefined,
              isBreak: isBreakRef.current,
            };
            await TimerService.saveTimerState(stateToSave);
            if (appContext?.saveTimerState) {
              await appContext.saveTimerState(stateToSave);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[StudyScreen] Erro ao salvar timer ao ir para segundo plano:', err);
    }
  }, [appContext, subjects]);

  const syncTimerFromTimestamps = useCallback(async () => {
    try {
      await NotificationService.cancelTimerNotification();

      let restored: SavedTimerState | null = null;
      if (appContext?.restoreTimerState) {
        restored = await appContext.restoreTimerState();
      } else {
        restored = await TimerService.restoreTimerState();
      }

      if (!restored) {
        const fallbackActive = appContext?.activeTimer !== undefined
          ? appContext.activeTimer
          : await StorageService.getActiveTimer();
        if (fallbackActive) {
          restored = TimerService.fromActiveTimerState(fallbackActive);
        }
      }

      if (!restored) return;

      if (restored.mode === 'pomodoro') {
        const targetDuration = restored.targetDuration ?? restored.initialDuration ?? (25 * 60);
        const remaining = typeof restored.remainingSeconds === 'number'
          ? restored.remainingSeconds
          : Math.max(0, targetDuration - (restored.accumulatedSeconds || 0));

        if (remaining <= 0) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setIsActive(false);
          setTimeLeft(0);
          await handlePomodoroComplete(restored.isBreak, restored.subjectId, restored.initialDuration);
          if (appContext?.clearTimerState) {
            await appContext.clearTimerState();
          } else {
            await TimerService.clearTimerState();
          }
        } else if (restored.isRunning) {
          setTimeLeft(remaining);
          setIsActive(true);
          setIsBreak(Boolean(restored.isBreak));
          if (restored.subjectId) {
            setSelectedSubjectId(restored.subjectId);
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
          }
          timerRef.current = setInterval(() => {
            setTimeLeft((prev: number) => {
              if (prev <= 1) return 0;
              return prev - 1;
            });
          }, 1000);
        } else {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setTimeLeft(remaining);
          setIsActive(false);
          setIsBreak(Boolean(restored.isBreak));
          if (restored.subjectId) {
            setSelectedSubjectId(restored.subjectId);
          }
        }
      } else if (restored.mode === 'stopwatch') {
        const elapsed = typeof restored.accumulatedSeconds === 'number'
          ? Math.max(0, restored.accumulatedSeconds)
          : 0;

        if (restored.isRunning) {
          setStopwatchSeconds(elapsed);
          setIsStopwatchRunning(true);
          if (restored.subjectId) {
            setStopwatchSubjectId(restored.subjectId);
          }
          if (stopwatchRef.current) {
            clearInterval(stopwatchRef.current);
          }
          stopwatchRef.current = setInterval(() => {
            setStopwatchSeconds((prev: number) => prev + 1);
          }, 1000);
        } else {
          if (stopwatchRef.current) {
            clearInterval(stopwatchRef.current);
            stopwatchRef.current = null;
          }
          setStopwatchSeconds(elapsed);
          setIsStopwatchRunning(false);
          if (restored.subjectId) {
            setStopwatchSubjectId(restored.subjectId);
          }
        }
      }
    } catch (e) {
      console.warn('[StudyScreen] Erro ao sincronizar timer por timestamps:', e);
    }
  }, [appContext, handlePomodoroComplete]);

  // Sincronização do ciclo de vida do aplicativo (AppState) com o TimerService
  useTimerAppState({
    onSaveState: saveCurrentTimerOnBackground,
    onRestoreState: syncTimerFromTimestamps,
  });

  useEffect(() => {
    loadStreak();
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (stopwatchRef.current) {
        clearInterval(stopwatchRef.current);
        stopwatchRef.current = null;
      }
    };
  }, []);

  // Screen blur/focus: salva timer ao desfocar a tela e limpa intervals, sincroniza ao focar
  useEffect(() => {
    const unsubscribeBlur = navigation?.addListener?.('blur', () => {
      saveCurrentTimerOnBackground();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (stopwatchRef.current) {
        clearInterval(stopwatchRef.current);
        stopwatchRef.current = null;
      }
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    });

    const unsubscribeFocus = navigation?.addListener?.('focus', () => {
      syncTimerFromTimestamps();
    });

    return () => {
      if (unsubscribeBlur) unsubscribeBlur();
      if (unsubscribeFocus) unsubscribeFocus();
    };
  }, [navigation, saveCurrentTimerOnBackground, syncTimerFromTimestamps]);

  // Tab switch handler: unconditionally clear active intervals when moving between tabs
  const handleTabChange = (newTab: 'pomodoro' | 'cronometro' | 'tarefas') => {
    if (newTab !== activeTab) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (stopwatchRef.current) {
        clearInterval(stopwatchRef.current);
        stopwatchRef.current = null;
      }
      setActiveTab(newTab);
      syncTimerFromTimestamps();
    }
  };

  // Sync selected subjects when subjects array changes
  useEffect(() => {
    if (subjects.length > 0) {
      if (!selectedSubjectId || !subjects.some(s => s.id === selectedSubjectId)) {
        setSelectedSubjectId(subjects[0].id);
      }
      if (!stopwatchSubjectId || !subjects.some(s => s.id === stopwatchSubjectId)) {
        setStopwatchSubjectId(subjects[0].id);
      }
    }
  }, [subjects]);

  // Dynamic sync: when focusMinutesDefault or breakMinutesDefault change from Settings props,
  // update timeLeft immediately if the timer is idle (!isActive).
  useEffect(() => {
    if (!isActive) {
      if (!isBreak) {
        setActiveFocusMinutes(focusMinutesDefault);
        setTimeLeft(focusMinutesDefault * 60);
      } else {
        setTimeLeft(breakMinutesDefault * 60);
      }
    }
  }, [focusMinutesDefault, breakMinutesDefault, isBreak, isActive]);

  // Pomodoro timer tick without clock drift
  useEffect(() => {
    if (isActive) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeLeft((prev: number) => {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive]);

  // Handle pomodoro completion when timeLeft reaches 0
  useEffect(() => {
    if (timeLeft === 0 && isActive) {
      handlePomodoroComplete();
    }
  }, [timeLeft, isActive]);

  // Stopwatch timer tick
  useEffect(() => {
    if (isStopwatchRunning) {
      if (stopwatchRef.current) clearInterval(stopwatchRef.current);
      stopwatchRef.current = setInterval(() => {
        setStopwatchSeconds((prev: number) => prev + 1);
      }, 1000);
    } else {
      if (stopwatchRef.current) {
        clearInterval(stopwatchRef.current);
        stopwatchRef.current = null;
      }
    }
    return () => {
      if (stopwatchRef.current) {
        clearInterval(stopwatchRef.current);
        stopwatchRef.current = null;
      }
    };
  }, [isStopwatchRunning]);

  const toggleTimer = async () => {
    if (!selectedSubjectId && subjects.length > 0) {
      setSelectedSubjectId(subjects[0].id);
    }
    if (!selectedSubjectId && subjects.length === 0) {
      showToast('Cadastre uma matéria antes de iniciar o timer.', 'warning');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const nextIsActive = !isActive;
    setIsActive(nextIsActive);

    const now = Date.now();
    const subId = selectedSubjectId || (subjects.length > 0 ? subjects[0].id : undefined);

    if (nextIsActive) {
      const targetEndTime = now + (timeLeft * 1000);
      const timerState: ActiveTimerState = {
        mode: 'pomodoro',
        isRunning: true,
        startedAt: now,
        targetEndTime,
        remainingSeconds: timeLeft,
        initialDuration: (activeFocusMinutes || focusMinutesDefault) * 60,
        subjectId: subId,
        isBreak
      };
      if (appContext?.saveActiveTimer) {
        await appContext.saveActiveTimer(timerState);
      } else {
        await StorageService.saveActiveTimer(timerState);
      }
    } else {
      await NotificationService.cancelTimerNotification();
      const timerState: ActiveTimerState = {
        mode: 'pomodoro',
        isRunning: false,
        startedAt: now,
        targetEndTime: undefined,
        remainingSeconds: timeLeft,
        initialDuration: (activeFocusMinutes || focusMinutesDefault) * 60,
        subjectId: subId,
        isBreak
      };
      if (appContext?.saveActiveTimer) {
        await appContext.saveActiveTimer(timerState);
      } else {
        await StorageService.saveActiveTimer(timerState);
      }
    }
  };

  const resetTimer = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsActive(false);
    setIsBreak(false);
    setTimeLeft((activeFocusMinutes || focusMinutesDefault) * 60);
    await NotificationService.cancelTimerNotification();
    if (appContext?.resetTimer) {
      await appContext.resetTimer();
    } else if (appContext?.saveActiveTimer) {
      await appContext.saveActiveTimer(null);
    } else {
      await StorageService.saveActiveTimer(null);
    }
  };

  const handleSelectPreset = (minutes: number) => {
    if (isActive) {
      showToast('Pause o timer para alterar a duração.', 'warning');
      return;
    }
    Haptics.selectionAsync();
    setActiveFocusMinutes(minutes);
    if (!isBreak) {
      setTimeLeft(minutes * 60);
    }
  };

  const toggleStopwatch = async () => {
    if (!stopwatchSubjectId && subjects.length > 0) {
      setStopwatchSubjectId(subjects[0].id);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const nextRunning = !isStopwatchRunning;
    setIsStopwatchRunning(nextRunning);

    const now = Date.now();
    const subId = stopwatchSubjectId || (subjects.length > 0 ? subjects[0].id : undefined);

    if (nextRunning) {
      const timerState: ActiveTimerState = {
        mode: 'stopwatch',
        isRunning: true,
        startedAt: now - (stopwatchSeconds * 1000),
        remainingSeconds: stopwatchSeconds,
        initialDuration: 0,
        subjectId: subId
      };
      if (appContext?.saveActiveTimer) {
        await appContext.saveActiveTimer(timerState);
      } else {
        await StorageService.saveActiveTimer(timerState);
      }
    } else {
      const timerState: ActiveTimerState = {
        mode: 'stopwatch',
        isRunning: false,
        startedAt: now - (stopwatchSeconds * 1000),
        remainingSeconds: stopwatchSeconds,
        initialDuration: 0,
        subjectId: subId
      };
      if (appContext?.saveActiveTimer) {
        await appContext.saveActiveTimer(timerState);
      } else {
        await StorageService.saveActiveTimer(timerState);
      }
    }
  };

  const resetStopwatch = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsStopwatchRunning(false);
    setStopwatchSeconds(0);
    showToast('Cronômetro zerado.', 'info');
    if (appContext?.resetTimer) {
      await appContext.resetTimer();
    } else if (appContext?.saveActiveTimer) {
      await appContext.saveActiveTimer(null);
    } else {
      await StorageService.saveActiveTimer(null);
    }
  };

  const saveAndResetStopwatch = async () => {
    if (stopwatchSeconds < 30) {
      showToast('Estude por pelo menos 30 segundos para salvar a sessão.', 'warning');
      return;
    }

    const subId = stopwatchSubjectId || (subjects.length > 0 ? subjects[0].id : 'general');

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const newSession: StudySession = {
      id: generateId('sess'),
      subjectId: subId,
      durationMs: stopwatchSeconds * 1000,
      date: getLocalDateString(),
      startTime: new Date().toISOString(),
    };
    onAddSession(newSession);
    await updateStreakOnSessionSaved();

    const minutes = Math.max(1, Math.floor(stopwatchSeconds / 60));
    // Proportional XP: ~2 XP per minute, minimum 10 XP
    const xpGained = Math.max(10, Math.round(minutes * 2));
    const updatedGamification = await StorageService.addXP(xpGained, minutes);
    setGamification(updatedGamification);
    showToast(`🎉 Sessão de ${minutes} min salva! (+${xpGained} XP)`, 'success');

    setIsStopwatchRunning(false);
    setStopwatchSeconds(0);
    if (appContext?.resetTimer) {
      await appContext.resetTimer();
    } else if (appContext?.saveActiveTimer) {
      await appContext.saveActiveTimer(null);
    } else {
      await StorageService.saveActiveTimer(null);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatStopwatch = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatTotalTime = (ms: number) => {
    const hrs = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  const getSubjectTotalTime = (subId: string) => {
    const subSessions = sessions.filter(s => s.subjectId === subId);
    return subSessions.reduce((acc, curr) => acc + curr.durationMs, 0);
  };

  // Total time studied today
  const todayTotalStudyMs = useMemo(() => {
    const todayStr = getLocalDateString();
    return sessions
      .filter(s => s.date === todayStr)
      .reduce((acc, curr) => acc + curr.durationMs, 0);
  }, [sessions]);

  // Tarefas Handlers
  const handleAddTask = () => {
    if (!newTaskTitle.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newTask: StudyTask = {
      id: generateId('task'),
      title: newTaskTitle.trim(),
      isCompleted: false,
      subjectId: taskSubjectId || undefined,
      priority: taskPriority,
    };
    onUpdateTasks([...tasks, newTask]);
    setNewTaskTitle('');
  };

  const toggleTask = async (taskId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const target = tasks.find(t => t.id === taskId);
    const willComplete = target ? !target.isCompleted : false;
    const updated = tasks.map(t => t.id === taskId ? { ...t, isCompleted: !t.isCompleted } : t);
    onUpdateTasks(updated);

    if (willComplete) {
      const g = await StorageService.addXP(30);
      setGamification(g);
      showToast('Tarefa concluída! (+30 XP) 🎯', 'success');
    }
  };

  const deleteTask = (taskId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = tasks.filter(t => t.id !== taskId);
    onUpdateTasks(updated);
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (selectedFilterSubject && t.subjectId !== selectedFilterSubject) return false;
      return true;
    });
  }, [tasks, selectedFilterSubject]);

  const renderSubjectSelector = (
    selectedId: string | null,
    onSelect: (id: string) => void,
    title = 'Matéria em Foco'
  ) => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
      {subjects.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
          {subjects.map(sub => {
            const isSelected = selectedId === sub.id;
            const chipBg = isSelected ? (sub.color || colors.primary) : colors.surfaceSubtle;
            const textColor = isSelected ? getContrastTextColor(sub.color || colors.primary) : colors.text;

            return (
              <TouchableOpacity
                key={sub.id}
                style={[
                  styles.subjectChip,
                  {
                    backgroundColor: chipBg,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: isSelected ? (sub.color || colors.primary) : colors.border
                  }
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  onSelect(sub.id);
                }}
                activeOpacity={0.7}
              >
                <Text style={{ color: textColor, fontWeight: '700', fontSize: 13 }}>
                  {sub.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : (
        <View style={[styles.noSubjectsCard, { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle }]}>
          <Text style={{ fontSize: 22, marginBottom: 4 }}>📚</Text>
          <Text style={[styles.noSubjectsTitle, { color: colors.text }]}>
            Nenhuma disciplina cadastrada
          </Text>
          <Text style={[styles.noSubjectsText, { color: colors.textSecondary }]}>
            Cadastre suas matérias para vincular horas de foco e manter seu histórico.
          </Text>
          {onAddNewSubject && (
            <TouchableOpacity
              style={[styles.addSubjectCtaBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onAddNewSubject();
              }}
              activeOpacity={0.8}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Cadastrar Nova Matéria"
              accessibilityHint="Abre o modal para incluir disciplina"
            >
              <Text style={[styles.addSubjectCtaBtnText, { color: getContrastTextColor(colors.primary) }]}>
                + Cadastrar Matéria
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );

  const renderPomodoroPresets = () => (
    <View style={styles.presetsContainer}>
      <Text style={[styles.presetsLabel, { color: colors.textSecondary }]}>⏱️ Duração rápida:</Text>
      <View style={styles.presetsRow}>
        {[15, 25, 45, 50, 60].map((presetMin) => {
          const isPresetSelected = !isBreak && activeFocusMinutes === presetMin;
          return (
            <TouchableOpacity
              key={presetMin}
              style={[
                styles.presetChip,
                {
                  backgroundColor: isPresetSelected ? colors.primary : colors.surfaceSubtle,
                  borderColor: isPresetSelected ? colors.primary : colors.border,
                }
              ]}
              onPress={() => handleSelectPreset(presetMin)}
              activeOpacity={0.7}
            >
              <Text style={{
                color: isPresetSelected ? getContrastTextColor(colors.primary) : colors.text,
                fontWeight: '700',
                fontSize: 12
              }}>
                {presetMin}m
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderPomodoroTimerVisualizer = () => {
    const totalDurationSeconds = Math.max(1, (activeFocusMinutes || focusMinutesDefault) * 60);
    const progressFrac = Math.min(1, Math.max(0, (totalDurationSeconds - timeLeft) / totalDurationSeconds));
    const rotationDeg = Math.round(progressFrac * 360);

    return (
      <View style={styles.timerContainer}>
        {/* Anel de foco circular Pomodoro com gradiente sutil violeta/azul e tipografia numérica grande */}
        <View style={styles.activityRingsWrap}>
          {/* Outer Halo Track (Violeta / Azul Suave) */}
          <View style={[styles.ringHaloBg, { borderColor: isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.10)' }]} />

          {/* Outer Ring com rotação de progresso */}
          <View style={[styles.ringOuter, { borderColor: isDark ? 'rgba(139, 92, 246, 0.20)' : 'rgba(59, 130, 246, 0.15)' }]}>
            <View
              style={[
                styles.ringOuter,
                {
                  borderColor: isBreak ? colors.success : (isDark ? '#818CF8' : '#6366F1'),
                  borderLeftColor: 'transparent',
                  borderBottomColor: 'transparent',
                  transform: [{ rotate: `${rotationDeg}deg` }]
                }
              ]}
            />
          </View>

          {/* Inner Accent Ring (Azul Luminoso) */}
          <View style={[styles.ringInner, { borderColor: isDark ? 'rgba(59, 130, 246, 0.18)' : 'rgba(59, 130, 246, 0.12)' }]}>
            <View
              style={[
                styles.ringInner,
                {
                  borderColor: isBreak ? (colors.successDark || '#059669') : '#38BDF8',
                  borderTopColor: 'transparent',
                  borderRightColor: 'transparent',
                  transform: [{ rotate: `${(rotationDeg * 0.75) % 360}deg` }]
                }
              ]}
            />
          </View>

          <View style={styles.ringCenter}>
            <View
              style={[
                styles.statePill,
                {
                  backgroundColor: isBreak ? colors.successLight : (isDark ? 'rgba(99, 102, 241, 0.18)' : 'rgba(99, 102, 241, 0.12)'),
                  borderColor: isBreak ? colors.success : (isDark ? 'rgba(129, 140, 248, 0.4)' : '#6366F1')
                }
              ]}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '800',
                  color: isBreak ? colors.success : (isDark ? '#C7D2FE' : '#4F46E5')
                }}
              >
                {isBreak ? `☕ Descanso` : `🎯 Foco Total`}
              </Text>
            </View>
            <Text style={[styles.timerText, { color: colors.text }]}>{formatTime(timeLeft)}</Text>
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary }}>
              {activeFocusMinutes} min • {isBreak ? 'Pausa' : 'Imersão'}
            </Text>
          </View>
        </View>

        {/* Botões arredondados com toque háptico Haptics.selectionAsync */}
        <View style={styles.timerControls}>
          <TouchableOpacity
            style={[
              styles.timerButton,
              {
                backgroundColor: isBreak ? colors.success : (isDark ? '#6366F1' : colors.primary),
                shadowColor: isBreak ? colors.success : '#6366F1',
                shadowOpacity: isActive ? 0.35 : 0.15,
                shadowOffset: { width: 0, height: 4 },
                shadowRadius: 10,
              }
            ]}
            onPress={() => {
              try { Haptics.selectionAsync(); } catch {}
              toggleTimer();
            }}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.timerButtonText,
                { color: getContrastTextColor(isBreak ? colors.success : (isDark ? '#6366F1' : colors.primary)) }
              ]}
            >
              {isActive ? '⏸️ Pausar' : '▶️ Iniciar Foco'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.timerButton,
              {
                backgroundColor: colors.surfaceSubtle,
                borderWidth: 1,
                borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : colors.border)
              }
            ]}
            onPress={() => {
              try { Haptics.selectionAsync(); } catch {}
              resetTimer();
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.timerButtonText, { color: colors.text }]}>🔄 Resetar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  /**
   * Cards Gêmeos de Métricas Acadêmicas:
   * Velocímetro semicircular de Presença Segura (94%) e Coeficiente de Rendimento (CR 8.8)
   */
  const renderTwinMetricCards = () => {
    return (
      <View style={styles.twinMetricsRow}>
        {/* Card 1: Velocímetro de Presença Segura (94%) */}
        <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : colors.border) }]}>
          <View style={styles.metricHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 15 }}>🛡️</Text>
              <Text style={[styles.metricCardTitle, { color: colors.text }]}>Presença Segura</Text>
            </View>
            <View style={[styles.metricBadge, { backgroundColor: colors.successLight, borderColor: colors.success }]}>
              <Text style={[styles.metricBadgeText, { color: colors.successDark }]}>94%</Text>
            </View>
          </View>

          {/* Velocímetro semicircular Apple HIG */}
          <View style={styles.gaugeContainer}>
            <View style={styles.gaugeHalfWrap}>
              <View style={[styles.gaugeTrack, { borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)' }]} />
              <View
                style={[
                  styles.gaugeFill,
                  {
                    borderColor: colors.success,
                    transform: [{ rotate: '45deg' }]
                  }
                ]}
              />
            </View>
            <View style={styles.gaugeCenterTextWrap}>
              <Text style={[styles.gaugeValueText, { color: colors.text }]}>94%</Text>
              <Text style={[styles.gaugeSubText, { color: colors.textSecondary }]}>Limite: 75%</Text>
            </View>
          </View>

          <View style={styles.metricFooterRow}>
            <View style={[styles.metricStatusDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.metricFooterText, { color: colors.textSecondary }]}>
              Status Seguro (+19% margem)
            </Text>
          </View>
        </View>

        {/* Card 2: Velocímetro de Coeficiente de Rendimento (CR 8.8) */}
        <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : colors.border) }]}>
          <View style={styles.metricHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 15 }}>📈</Text>
              <Text style={[styles.metricCardTitle, { color: colors.text }]}>Rendimento (CR)</Text>
            </View>
            <View style={[styles.metricBadge, { backgroundColor: isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.10)', borderColor: isDark ? '#A78BFA' : '#7C3AED' }]}>
              <Text style={[styles.metricBadgeText, { color: isDark ? '#C4B5FD' : '#6D28D9' }]}>CR 8.8</Text>
            </View>
          </View>

          {/* Velocímetro semicircular Apple HIG */}
          <View style={styles.gaugeContainer}>
            <View style={styles.gaugeHalfWrap}>
              <View style={[styles.gaugeTrack, { borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)' }]} />
              <View
                style={[
                  styles.gaugeFill,
                  {
                    borderColor: isDark ? '#A78BFA' : '#7C3AED',
                    transform: [{ rotate: '35deg' }]
                  }
                ]}
              />
            </View>
            <View style={styles.gaugeCenterTextWrap}>
              <Text style={[styles.gaugeValueText, { color: colors.text }]}>CR 8.8</Text>
              <Text style={[styles.gaugeSubText, { color: colors.textSecondary }]}>Média Geral</Text>
            </View>
          </View>

          <View style={styles.metricFooterRow}>
            <View style={[styles.metricStatusDot, { backgroundColor: isDark ? '#A78BFA' : '#7C3AED' }]} />
            <Text style={[styles.metricFooterText, { color: colors.textSecondary }]}>
              Alto Desempenho
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderDailyOverview = () => (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 0 }]}>Tempo Hoje</Text>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>
          {formatTotalTime(todayTotalStudyMs)}
        </Text>
      </View>

      {todayTotalStudyMs === 0 ? (
        <View style={[styles.emptyDailyStudyCard, { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle }]}>
          <Text style={{ fontSize: 22, marginBottom: 6 }}>🌱</Text>
          <Text style={[styles.emptyDailyStudyTitle, { color: colors.text }]}>
            Nenhum ciclo registrado hoje
          </Text>
          <Text style={[styles.emptyDailyStudySubtitle, { color: colors.textSecondary }]}>
            Inicie um bloco de foco Pomodoro ou o cronômetro livre para acumular horas de dedicação e manter seu streak ativo.
          </Text>
        </View>
      ) : (
        <>
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 10 }}>Distribuição por matéria:</Text>
          {subjects.map(sub => {
            const total = getSubjectTotalTime(sub.id);
            if (total === 0) return null;
            return (
              <View key={sub.id} style={[styles.statRow, { borderBottomColor: colors.borderSubtle }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: sub.color || colors.primary, marginRight: 8 }} />
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{sub.name}</Text>
                </View>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{formatTotalTime(total)}</Text>
              </View>
            );
          })}
        </>
      )}
    </View>
  );

  const renderStopwatchVisualizerAndControls = () => (
    <View style={styles.timerContainer}>
      <View style={{ alignItems: 'center', marginVertical: 20 }}>
        <Text style={[styles.timerText, { color: colors.text, fontSize: 52 }]}>{formatStopwatch(stopwatchSeconds)}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>
          {isStopwatchRunning ? '⚡ Cronômetro ativo' : 'Pronto para iniciar'}
        </Text>
      </View>

      <View style={styles.timerControls}>
        <TouchableOpacity
          style={[
            styles.timerButton,
            { backgroundColor: isStopwatchRunning ? colors.danger : colors.primary }
          ]}
          onPress={toggleStopwatch}
          activeOpacity={0.8}
        >
          <Text style={[
            styles.timerButtonText,
            { color: isStopwatchRunning ? getContrastTextColor(colors.danger) : getContrastTextColor(colors.primary) }
          ]}>
            {isStopwatchRunning ? '⏸️ Pausar' : '▶️ Iniciar'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.timerButton, { backgroundColor: colors.success }]}
          onPress={saveAndResetStopwatch}
          activeOpacity={0.8}
        >
          <Text style={[styles.timerButtonText, { color: getContrastTextColor(colors.success) }]}>💾 Salvar</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.timerButton, { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.border }]}
          onPress={resetStopwatch}
          activeOpacity={0.8}
        >
          <Text style={[styles.timerButtonText, { color: colors.text }]}>🔄 Zerar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderAddTaskForm = () => (
    <View style={[styles.addTaskContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TextInput
        ref={taskInputRef}
        style={[styles.taskInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
        placeholder="Adicionar nova tarefa..."
        placeholderTextColor={colors.textSecondary}
        value={newTaskTitle}
        onChangeText={setNewTaskTitle}
        onSubmitEditing={handleAddTask}
      />

      {subjects.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10, marginBottom: 10 }}>
          <TouchableOpacity
            style={[
              styles.subjectChip,
              {
                backgroundColor: !taskSubjectId ? colors.primary : colors.surfaceSubtle,
                borderWidth: 1,
                borderColor: !taskSubjectId ? colors.primary : colors.border,
                paddingVertical: 5
              }
            ]}
            onPress={() => setTaskSubjectId(null)}
            activeOpacity={0.7}
          >
            <Text style={{
              color: !taskSubjectId ? getContrastTextColor(colors.primary) : colors.text,
              fontSize: 12,
              fontWeight: '700'
            }}>
              Geral
            </Text>
          </TouchableOpacity>
          {subjects.map(sub => {
            const isSelected = taskSubjectId === sub.id;
            const chipBg = isSelected ? (sub.color || colors.primary) : colors.surfaceSubtle;
            const textColor = isSelected ? getContrastTextColor(sub.color || colors.primary) : colors.text;

            return (
              <TouchableOpacity
                key={sub.id}
                style={[
                  styles.subjectChip,
                  {
                    backgroundColor: chipBg,
                    borderWidth: 1,
                    borderColor: isSelected ? (sub.color || colors.primary) : colors.border,
                    paddingVertical: 5
                  }
                ]}
                onPress={() => setTaskSubjectId(sub.id)}
                activeOpacity={0.7}
              >
                <Text style={{ color: textColor, fontSize: 12, fontWeight: '700' }}>
                  {sub.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>Prioridade:</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[
            { id: 'low', label: '🟢 Baixa' },
            { id: 'medium', label: '🟡 Média' },
            { id: 'high', label: '🔴 Alta' }
          ].map(p => {
            const isSelected = taskPriority === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                style={[
                  styles.priorityBtn,
                  {
                    backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle,
                    borderWidth: 1,
                    borderColor: isSelected ? colors.primary : colors.border
                  }
                ]}
                onPress={() => setTaskPriority(p.id as any)}
                activeOpacity={0.7}
              >
                <Text style={{
                  fontSize: 11,
                  color: isSelected ? getContrastTextColor(colors.primary) : colors.text,
                  fontWeight: '700'
                }}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.addButton, { backgroundColor: colors.primary }]}
        onPress={handleAddTask}
        activeOpacity={0.8}
      >
        <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '700', fontSize: 14 }}>
          + Adicionar Tarefa
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderTaskFiltersAndList = () => (
    <>
      {subjects.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <TouchableOpacity
            style={[
              styles.filterChip,
              {
                backgroundColor: !selectedFilterSubject ? colors.primary : colors.surface,
                borderColor: !selectedFilterSubject ? colors.primary : colors.border
              }
            ]}
            onPress={() => setSelectedFilterSubject(null)}
            activeOpacity={0.7}
          >
            <Text style={{
              color: !selectedFilterSubject ? getContrastTextColor(colors.primary) : colors.text,
              fontSize: 12,
              fontWeight: '700'
            }}>
              Todas ({tasks.length})
            </Text>
          </TouchableOpacity>
          {subjects.map(s => {
            const count = tasks.filter(t => t.subjectId === s.id).length;
            const isSelected = selectedFilterSubject === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: isSelected ? colors.primary : colors.surface,
                    borderColor: isSelected ? colors.primary : colors.border
                  }
                ]}
                onPress={() => setSelectedFilterSubject(s.id)}
                activeOpacity={0.7}
              >
                <Text style={{
                  color: isSelected ? getContrastTextColor(colors.primary) : colors.text,
                  fontSize: 12,
                  fontWeight: '700'
                }}>
                  {s.name} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {filteredTasks.length === 0 ? (
          <View style={[styles.emptyTasksCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.emptyTasksIconCircle, { backgroundColor: colors.surfaceSubtle }]}>
              <Text style={{ fontSize: 28 }}>📝</Text>
            </View>
            <Text style={[styles.emptyTasksTitle, { color: colors.text }]}>
              {selectedFilterSubject ? 'Nenhuma tarefa para esta matéria' : 'Nenhuma meta de estudo criada'}
            </Text>
            <Text style={[styles.emptyTasksSubtitle, { color: colors.textSecondary }]}>
              {selectedFilterSubject
                ? 'Não há tarefas cadastradas para o filtro selecionado.'
                : 'Crie tarefas pontuais de leitura, exercícios ou projetos para organizar sua rotina de estudos.'}
            </Text>
            {!selectedFilterSubject && (
              <TouchableOpacity
                style={[styles.emptyTasksBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  taskInputRef.current?.focus();
                }}
                activeOpacity={0.8}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Criar nova tarefa de estudo"
                accessibilityHint="Coloca o cursor no campo de adicionar tarefa"
              >
                <Text style={[styles.emptyTasksBtnText, { color: getContrastTextColor(colors.primary) }]}>
                  + Criar Nova Tarefa
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          filteredTasks.sort((a: StudyTask, b: StudyTask) => Number(a.isCompleted) - Number(b.isCompleted)).map((task: StudyTask) => {
            const sub = subjects.find(s => s.id === task.subjectId);
            return (
              <View key={task.id} style={[styles.taskRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <TouchableOpacity
                  onPress={() => toggleTask(task.id)}
                  style={[
                    styles.checkbox,
                    {
                      borderColor: task.isCompleted ? colors.primary : colors.border,
                      backgroundColor: task.isCompleted ? colors.primary : 'transparent'
                    }
                  ]}
                  activeOpacity={0.7}
                >
                  {task.isCompleted && <Text style={{ color: getContrastTextColor(colors.primary), fontSize: 13, fontWeight: '800' }}>✓</Text>}
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{
                    color: task.isCompleted ? colors.textSecondary : colors.text,
                    textDecorationLine: task.isCompleted ? 'line-through' : 'none',
                    fontSize: 15,
                    fontWeight: '600'
                  }}>
                    {task.title}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    {sub && (
                      <Text style={{ color: sub.color || colors.primary, fontSize: 11, fontWeight: '700' }}>
                        {sub.name}
                      </Text>
                    )}
                    {task.priority === 'high' && (
                      <Text style={{ fontSize: 10, color: colors.danger, fontWeight: '700' }}>• Urgente</Text>
                    )}
                  </View>
                </View>
                <TouchableOpacity onPress={() => deleteTask(task.id)} style={{ padding: 6 }} activeOpacity={0.7}>
                  <Text style={{ color: colors.danger, fontSize: 18 }}>×</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
        <View style={{ height: 100 }} />
      </ScrollView>
    </>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.headerRow, isDesktop && styles.desktopHeaderWidth]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.headerTitle}>Estudos</Text>
          {gamification && (
            <TouchableOpacity
              style={[styles.levelBadge, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
              onPress={() => {
                Haptics.selectionAsync();
                if (onOpenAchievements) onOpenAchievements();
              }}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.primary }}>
                Nv. {gamification.level} 🎓
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {onOpenAnalytics && (
            <TouchableOpacity
              style={[styles.headerActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
              onPress={() => {
                Haptics.selectionAsync();
                onOpenAnalytics();
              }}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>📈 Stats</Text>
            </TouchableOpacity>
          )}

          {streak.currentStreak > 0 && (
            <View style={[styles.streakBadge, { backgroundColor: colors.warningLight, borderColor: colors.warning }]}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.warning }}>
                🔥 {streak.currentStreak} {streak.currentStreak === 1 ? 'dia' : 'dias'}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Toast banner */}
      {toastMessage && (
        <View style={[
          styles.toastBanner,
          isDesktop && styles.desktopHeaderWidth,
          {
            backgroundColor: toastMessage.type === 'success' 
              ? colors.success 
              : toastMessage.type === 'warning' 
                ? colors.warning 
                : colors.primary
          }
        ]}>
          <Text style={{
            color: getContrastTextColor(
              toastMessage.type === 'success' ? colors.success : toastMessage.type === 'warning' ? colors.warning : colors.primary
            ),
            fontWeight: '700',
            fontSize: 13,
            textAlign: 'center'
          }}>
            {toastMessage.text}
          </Text>
        </View>
      )}

      {/* Apple HIG Segmented Control tabs */}
      <View style={[styles.segmentedControlWrap, { backgroundColor: colors.surfaceSubtle }, isDesktop && styles.desktopSegmentWidth]}>
        {[
          { id: 'pomodoro', label: '🍅 Pomodoro' },
          { id: 'cronometro', label: '⏱️ Cronômetro' },
          { id: 'tarefas', label: '📝 Tarefas' }
        ].map(t => {
          const isSelected = activeTab === t.id;
          return (
            <TouchableOpacity 
              key={t.id}
              style={[
                styles.segmentBtn,
                isSelected && [styles.segmentBtnActive, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]
              ]} 
              onPress={() => {
                Haptics.selectionAsync();
                handleTabChange(t.id as any);
              }}
              activeOpacity={0.8}
            >
              <Text style={[
                styles.segmentText,
                { color: isSelected ? colors.primary : colors.textSecondary, fontWeight: isSelected ? '700' : '500' }
              ]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === 'pomodoro' ? (
        <ScrollView
          style={styles.content}
          contentContainerStyle={[styles.scrollContentInner, !isDesktop && { paddingBottom: 120 }, isDesktop && styles.desktopContentWidth]}
          showsVerticalScrollIndicator={false}
        >
          {hasWideContent ? (
            <View style={styles.desktopColumnsContainer}>
              <View style={styles.desktopLeftColumn}>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : colors.border) }]}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>Temporizador Pomodoro</Text>
                  {renderPomodoroTimerVisualizer()}
                </View>
                {renderTwinMetricCards()}
              </View>

              <View style={styles.desktopRightColumn}>
                {renderSubjectSelector(selectedSubjectId, setSelectedSubjectId, 'Matéria em Foco')}
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : colors.border) }]}>
                  {renderPomodoroPresets()}
                </View>
                {renderDailyOverview()}
              </View>
            </View>
          ) : (
            <>
              {renderSubjectSelector(selectedSubjectId, setSelectedSubjectId, 'Matéria em Foco')}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : colors.border) }]}>
                {renderPomodoroPresets()}
                {renderPomodoroTimerVisualizer()}
              </View>
              {renderTwinMetricCards()}
              {renderDailyOverview()}
            </>
          )}
          <View style={{ height: 100 }} />
        </ScrollView>
      ) : activeTab === 'cronometro' ? (
        <ScrollView
          style={styles.content}
          contentContainerStyle={[styles.scrollContentInner, !isDesktop && { paddingBottom: 120 }, isDesktop && styles.desktopContentWidth]}
          showsVerticalScrollIndicator={false}
        >
          {hasWideContent ? (
            <View style={styles.desktopColumnsContainer}>
              <View style={styles.desktopLeftColumn}>
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>Cronômetro Livre</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 15 }}>
                    Contagem progressiva: estude no seu próprio ritmo e salve a sessão ao terminar.
                  </Text>
                  {renderStopwatchVisualizerAndControls()}
                </View>
              </View>

              <View style={styles.desktopRightColumn}>
                {renderSubjectSelector(stopwatchSubjectId, setStopwatchSubjectId, 'Disciplina da Sessão')}
                {renderDailyOverview()}
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Cronômetro Livre</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 15 }}>
                  Contagem progressiva: estude no seu próprio ritmo e salve a sessão ao terminar.
                </Text>
                {renderSubjectSelector(stopwatchSubjectId, setStopwatchSubjectId, 'Disciplina da Sessão')}
                {renderStopwatchVisualizerAndControls()}
              </View>
              {renderDailyOverview()}
            </>
          )}
          <View style={{ height: 100 }} />
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }, isDesktop && styles.desktopContentWidth]}>
          {hasWideContent ? (
            <View style={[styles.desktopColumnsContainer, { flex: 1 }]}>
              <View style={styles.desktopLeftColumn}>
                {renderAddTaskForm()}
              </View>
              <View style={[styles.desktopRightColumn, { flex: 1.5 }]}>
                {renderTaskFiltersAndList()}
              </View>
            </View>
          ) : (
            <>
              {renderAddTaskForm()}
              {renderTaskFiltersAndList()}
            </>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
};

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 8
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  levelBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, borderWidth: 1 },
  headerActionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  streakBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  toastBanner: { marginHorizontal: 18, padding: 12, borderRadius: 12, marginBottom: 10 },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center' },
  tabText: { fontSize: 13 },
  // Apple HIG Segmented Control
  segmentedControlWrap: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 12,
    padding: 3,
    borderRadius: 12,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentBtnActive: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 12,
    letterSpacing: -0.2,
  },
  content: { flex: 1, padding: 16 },
  card: {
    padding: 16,
    borderRadius: 20,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 12 },
  subjectChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, marginRight: 8 },
  presetsContainer: { marginBottom: 14 },
  presetsLabel: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  presetsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  presetChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  statePill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth },
  timerContainer: { alignItems: 'center', paddingVertical: 10 },
  // Activity Rings
  activityRingsWrap: {
    width: 226,
    height: 226,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  ringHaloBg: {
    position: 'absolute',
    width: 226,
    height: 226,
    borderRadius: 113,
    borderWidth: 1,
  },
  ringOuter: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    borderWidth: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    position: 'absolute',
    width: 174,
    height: 174,
    borderRadius: 87,
    borderWidth: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerText: { fontSize: 52, fontWeight: '800', marginBottom: 4, fontVariant: ['tabular-nums'], letterSpacing: -1.5 },
  timerControls: { flexDirection: 'row', justifyContent: 'center', gap: 12, width: '100%', marginTop: 8 },
  timerButton: { flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  timerButtonText: { fontSize: 14, fontWeight: '700' },

  // Twin Metric Cards (Presença Segura & CR)
  twinMetricsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  metricCard: {
    flex: 1,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  metricHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  metricCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  metricBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  metricBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  gaugeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 72,
    marginVertical: 4,
    position: 'relative',
  },
  gaugeHalfWrap: {
    width: 104,
    height: 52,
    overflow: 'hidden',
    position: 'absolute',
    top: 4,
  },
  gaugeTrack: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 9,
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    position: 'absolute',
    top: 0,
    left: 0,
    transform: [{ rotate: '-45deg' }],
  },
  gaugeFill: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 9,
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  gaugeCenterTextWrap: {
    position: 'absolute',
    bottom: 2,
    alignItems: 'center',
  },
  gaugeValueText: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  gaugeSubText: {
    fontSize: 10,
    fontWeight: '600',
  },
  metricFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  metricStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  metricFooterText: {
    fontSize: 11,
    fontWeight: '500',
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1 },
  addTaskContainer: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2
  },
  taskInput: { padding: 12, borderRadius: 12, borderWidth: 1, fontSize: 14 },
  priorityBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  addButton: { padding: 13, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, marginRight: 8 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1
  },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  emptyTasksCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: 10,
  },
  emptyTasksIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTasksTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyTasksSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
    maxWidth: 280,
  },
  emptyTasksBtn: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTasksBtnText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  emptyDailyStudyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  emptyDailyStudyTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyDailyStudySubtitle: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  noSubjectsCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 14,
  },
  noSubjectsTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  noSubjectsText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 12,
  },
  addSubjectCtaBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSubjectCtaBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  desktopColumnsContainer: {
    flexDirection: 'row',
    gap: 20,
    alignItems: 'flex-start',
    width: '100%',
  },
  desktopLeftColumn: {
    flex: 1,
    minWidth: 0,
  },
  desktopRightColumn: {
    flex: 1.2,
    minWidth: 0,
  },
  desktopHeaderWidth: {
    maxWidth: 1200,
    alignSelf: 'center',
    width: '100%',
  },
  desktopSegmentWidth: {
    maxWidth: 1168,
    alignSelf: 'center',
    width: '100%',
  },
  desktopContentWidth: {
    maxWidth: 1200,
    alignSelf: 'center',
    width: '100%',
  },
  scrollContentInner: {
    paddingBottom: 40,
  },
});

