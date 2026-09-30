import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import * as Haptics from 'expo-haptics';
import { AppState, Platform } from 'react-native';
import { StorageService } from '../services/storage';
import { AttendanceService } from '../services/AttendanceService';
import { NotificationService } from '../services/notifications';
import { CourseCRService } from '../services/CourseCRService';
import { CloudSyncEngine, CloudSyncStatus } from '../services/CloudSyncEngine';
import { GoogleAuthService } from '../services/GoogleAuthService';
import { 
  AppEvent, 
  ThemeType, 
  Subject, 
  AttendanceRecord, 
  StudyTask, 
  StudySession, 
  StudyStreak, 
  Semester, 
  AppSettings, 
  GamificationData, 
  AIConfig,
  ActiveTimerState,
  SavedTimerState,
} from '../types';
import { 
  TimerService, 
  restoreTimerState as serviceRestoreTimerState, 
  saveTimerState as serviceSaveTimerState, 
  clearTimerState as serviceClearTimerState, 
  toActiveTimerState 
} from '../services/TimerService';
import { APP_VERSION } from '../utils/version';

export interface AppContextData {
  // Theme & Settings
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  aiConfig: AIConfig;
  setAiConfig: React.Dispatch<React.SetStateAction<AIConfig>>;
  
  // Data State
  events: AppEvent[];
  setEvents: React.Dispatch<React.SetStateAction<AppEvent[]>>;
  subjects: Subject[];
  setSubjects: React.Dispatch<React.SetStateAction<Subject[]>>;
  attendances: AttendanceRecord[];
  setAttendances: React.Dispatch<React.SetStateAction<AttendanceRecord[]>>;
  tasks: StudyTask[];
  setTasks: React.Dispatch<React.SetStateAction<StudyTask[]>>;
  studySessions: StudySession[];
  setStudySessions: React.Dispatch<React.SetStateAction<StudySession[]>>;
  streak: StudyStreak;
  setStreak: React.Dispatch<React.SetStateAction<StudyStreak>>;
  semesters: Semester[];
  setSemesters: React.Dispatch<React.SetStateAction<Semester[]>>;
  gamification: GamificationData | null;
  setGamification: React.Dispatch<React.SetStateAction<GamificationData | null>>;

  // Active Timer State (Pomodoro & Cronômetro Resilientes - Timestamp Diff)
  activeTimer: ActiveTimerState | null;
  setActiveTimer: React.Dispatch<React.SetStateAction<ActiveTimerState | null>>;
  saveActiveTimer: (timer: ActiveTimerState | null) => Promise<void>;
  savedTimer: SavedTimerState | null;
  restoreTimerState: () => Promise<SavedTimerState | null>;
  saveTimerState: (state: SavedTimerState | null) => Promise<boolean>;
  clearTimerState: () => Promise<boolean>;
  startTimer: (mode: 'pomodoro' | 'stopwatch', initialDurationSeconds: number, subjectId?: string, isBreak?: boolean) => Promise<void>;
  pauseTimer: () => Promise<void>;
  resumeTimer: () => Promise<void>;
  resetTimer: () => Promise<void>;
  
  // App Lifecycle
  isInitializing: boolean;
  refreshData: () => Promise<void>;
  handleThemeToggle: () => Promise<void>;
  
  // Actions
  toggleEventCompletion: (eventId: string) => Promise<void>;
  toggleTaskCompletion: (taskId: string) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  updateAttendance: (record: AttendanceRecord) => Promise<void>;
  archiveSubject: (subjectId: string) => Promise<void>;
  archiveSubjects: (subjectIds: string[]) => Promise<void>;
  deleteSubject: (subjectId: string) => Promise<void>;
  addOrUpdateSubject: (subject: Subject) => Promise<void>;
  addOrUpdateEvent: (event: AppEvent) => Promise<void>;
  updateAIConfig: (config: AIConfig) => Promise<boolean>;

  // Cloud Sync (Firebase Firestore)
  triggerDebouncedCloudSync: () => void;
  syncCloudNow: () => Promise<{ success: boolean; message: string }>;
  /** UID do usuário Firebase autenticado, ou null se não conectado. */
  firebaseUserId: string | null;
  cloudSyncStatus: CloudSyncStatus;
}


const AppContext = createContext<AppContextData | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Theme & Settings State
  const [theme, setTheme] = useState<ThemeType>('dark');
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'dark',
    fullscreen: false,
    pomodoroFocusMin: 25,
    pomodoroBreakMin: 5,
    pomodoroLongBreakMin: 15,
    defaultPassGrade: 7.0,
    examWeekMode: false,
    soundEnabled: true,
    hapticsEnabled: true,
  });
  const [aiConfig, setAiConfig] = useState<AIConfig>({ provider: 'gemini', mode: 'gemini_cloud', apiKey: '' });
  
  // Data State
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([]);
  const [tasks, setTasks] = useState<StudyTask[]>([]);
  const [studySessions, setStudySessions] = useState<StudySession[]>([]);
  const [streak, setStreak] = useState<StudyStreak>({ currentStreak: 0, longestStreak: 0, lastStudyDate: '' });
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [gamification, setGamification] = useState<GamificationData | null>(null);
  const [activeTimer, setActiveTimer] = useState<ActiveTimerState | null>(null);
  const [savedTimer, setSavedTimer] = useState<SavedTimerState | null>(null);
  
  // App Lifecycle
  const [isInitializing, setIsInitializing] = useState(true);

  const loadData = async () => {
    try {
      const [
        savedTheme,
        savedEvents,
        savedSubjects,
        savedAttendances,
        savedTasks,
        savedSessions,
        savedSemesters,
        savedSettings,
        savedGamification,
        savedStreak,
        savedAIConfig,
        savedActiveTimer
      ] = await Promise.all([
        StorageService.getTheme().catch(() => 'dark' as ThemeType),
        StorageService.getEvents().catch(() => [] as AppEvent[]),
        StorageService.getSubjects().catch(() => [] as Subject[]),
        StorageService.getAttendances().catch(() => [] as AttendanceRecord[]),
        StorageService.getTasks().catch(() => [] as StudyTask[]),
        StorageService.getStudySessions().catch(() => [] as StudySession[]),
        StorageService.getSemesters().catch(() => [] as Semester[]),
        StorageService.getSettings().catch(() => null),
        StorageService.getGamificationData().catch(() => null),
        StorageService.getStreak().catch(() => null),
        StorageService.getAIConfig().catch(() => null),
        StorageService.getActiveTimer().catch(() => null),
      ]);

      // Sanitize array collections
      const safeEvents = Array.isArray(savedEvents) ? savedEvents.filter((e): e is AppEvent => Boolean(e && typeof e === 'object')) : [];
      const safeSubjects = Array.isArray(savedSubjects) ? savedSubjects.filter((s): s is Subject => Boolean(s && typeof s === 'object')) : [];
      const safeAttendances = Array.isArray(savedAttendances) ? savedAttendances.filter((a): a is AttendanceRecord => Boolean(a && typeof a === 'object')) : [];
      const safeTasks = Array.isArray(savedTasks) ? savedTasks.filter((t): t is StudyTask => Boolean(t && typeof t === 'object')) : [];
      const safeSessions = Array.isArray(savedSessions) ? savedSessions.filter((ss): ss is StudySession => Boolean(ss && typeof ss === 'object')) : [];
      const safeSemesters = Array.isArray(savedSemesters) ? savedSemesters.filter((sem): sem is Semester => Boolean(sem && typeof sem === 'object')) : [];

      // Check for pending attendances safely
      let updatedAttendances = safeAttendances;
      try {
        updatedAttendances = await AttendanceService.generatePendingAttendances(safeEvents, safeAttendances);
      } catch (attError) {
        console.warn('AppContext: Attendance calculation error in loadData:', attError);
      }

      // Sanitize theme
      const safeTheme: ThemeType = savedTheme === 'light' || savedTheme === 'amoled' || savedTheme === 'dark' ? savedTheme : 'dark';

      // Sanitize settings
      const safeSettings: AppSettings = (savedSettings && typeof savedSettings === 'object' && !Array.isArray(savedSettings))
        ? {
            theme: (savedSettings.theme === 'light' || savedSettings.theme === 'amoled' || savedSettings.theme === 'dark') ? savedSettings.theme : safeTheme,
            fullscreen: Boolean(savedSettings.fullscreen),
            pomodoroFocusMin: Number(savedSettings.pomodoroFocusMin) || 25,
            pomodoroBreakMin: Number(savedSettings.pomodoroBreakMin) || 5,
            pomodoroLongBreakMin: Number(savedSettings.pomodoroLongBreakMin) || 15,
            defaultPassGrade: typeof savedSettings.defaultPassGrade === 'number' && !isNaN(savedSettings.defaultPassGrade) ? savedSettings.defaultPassGrade : 7.0,
            examWeekMode: Boolean(savedSettings.examWeekMode),
            soundEnabled: savedSettings.soundEnabled !== false,
            hapticsEnabled: savedSettings.hapticsEnabled !== false,
            currentSemesterId: savedSettings.currentSemesterId,
          }
        : { theme: safeTheme, fullscreen: false, pomodoroFocusMin: 25, pomodoroBreakMin: 5, pomodoroLongBreakMin: 15, defaultPassGrade: 7.0, examWeekMode: false, soundEnabled: true, hapticsEnabled: true };

      // Sanitize gamification
      const safeGamification: GamificationData = (savedGamification && typeof savedGamification === 'object' && !Array.isArray(savedGamification))
        ? {
            xp: Number(savedGamification.xp) || 0,
            level: Number(savedGamification.level) || 1,
            unlockedAchievements: Array.isArray(savedGamification.unlockedAchievements) ? savedGamification.unlockedAchievements : [],
            claimedAchievements: Array.isArray(savedGamification.claimedAchievements) ? savedGamification.claimedAchievements : [],
            processedEventIds: Array.isArray(savedGamification.processedEventIds) ? savedGamification.processedEventIds : [],
            totalFocusMinutes: Number(savedGamification.totalFocusMinutes) || 0,
          }
        : { xp: 0, level: 1, unlockedAchievements: [], totalFocusMinutes: 0 };

      // Sanitize study streak
      const safeStreak: StudyStreak = (savedStreak && typeof savedStreak === 'object' && !Array.isArray(savedStreak))
        ? {
            currentStreak: Number(savedStreak.currentStreak) || 0,
            longestStreak: Number(savedStreak.longestStreak) || 0,
            lastStudyDate: typeof savedStreak.lastStudyDate === 'string' ? savedStreak.lastStudyDate : '',
            bestStreak: savedStreak.bestStreak,
            totalStudyDays: savedStreak.totalStudyDays,
          }
        : { currentStreak: 0, longestStreak: 0, lastStudyDate: '' };

      // Sanitize AI config
      const rawModel = typeof savedAIConfig?.model === 'string' ? savedAIConfig.model.trim() : '';
      const sanitizedModel = (!rawModel || rawModel.includes('1.5') || rawModel.includes('2.5') || rawModel === 'gemini-flash')
        ? 'gemini-3.6-flash'
        : rawModel;

      const safeAIConfig: AIConfig = (savedAIConfig && typeof savedAIConfig === 'object')
        ? {
            provider: savedAIConfig.provider === 'openai' ? 'openai' : 'gemini',
            mode: savedAIConfig.mode || 'gemini_cloud',
            apiKey: typeof savedAIConfig.apiKey === 'string' ? savedAIConfig.apiKey : '',
            model: sanitizedModel,
            enableFallbackToCloud: savedAIConfig.enableFallbackToCloud !== false,
            localModelPath: savedAIConfig.localModelPath
          }
        : { provider: 'gemini', mode: 'gemini_cloud', apiKey: '', model: 'gemini-3.6-flash', enableFallbackToCloud: true };

      setTheme(safeTheme);
      setEvents(safeEvents);
      setSubjects(safeSubjects);
      setAttendances(Array.isArray(updatedAttendances) ? updatedAttendances : safeAttendances);
      setTasks(safeTasks);
      setStudySessions(safeSessions);
      setSemesters(safeSemesters);
      setSettings(safeSettings);
      setGamification(safeGamification);
      setStreak(safeStreak);
      setAiConfig(safeAIConfig);

      // Restauração com arquitetura de Timestamp Diff
      const restoredSaved = await serviceRestoreTimerState().catch(() => null);
      let effectiveTimer: ActiveTimerState | null = null;
      if (restoredSaved) {
        setSavedTimer(restoredSaved);
        effectiveTimer = toActiveTimerState(restoredSaved);
      } else if (savedActiveTimer) {
        effectiveTimer = savedActiveTimer;
        if (effectiveTimer.isRunning && effectiveTimer.mode === 'pomodoro' && effectiveTimer.targetEndTime) {
          const remaining = Math.max(0, Math.round((effectiveTimer.targetEndTime - Date.now()) / 1000));
          effectiveTimer = { ...effectiveTimer, remainingSeconds: remaining };
        } else if (effectiveTimer.isRunning && effectiveTimer.mode === 'stopwatch') {
          const elapsed = Math.max(0, Math.floor((Date.now() - effectiveTimer.startedAt) / 1000));
          effectiveTimer = { ...effectiveTimer, remainingSeconds: elapsed };
        }
        setSavedTimer(TimerService.fromActiveTimerState(effectiveTimer));
      }
      setActiveTimer(effectiveTimer);
    } catch (err) {
      console.error('Error loading app data in AppContext:', err);
    } finally {
      setIsInitializing(false);
    }
  };


  // A single engine owns local writes, server transactions and realtime updates.
  const [firebaseUserId, setFirebaseUserId] = useState<string | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>({
    state: 'disconnected', message: 'Conecte a mesma conta Google nos dois dispositivos.',
  });
  const cloudEngineRef = useRef<CloudSyncEngine | null>(null);
  const reloadRef = useRef(loadData);
  reloadRef.current = loadData;

  const triggerDebouncedCloudSync = useCallback(() => cloudEngineRef.current?.schedule(), []);
  const syncCloudNow = async (): Promise<{ success: boolean; message: string }> => {
    const engine = cloudEngineRef.current;
    if (!engine) return { success: false, message: 'Usuário não conectado ao Firebase.' };
    try {
      await engine.syncNow();
      return { success: true, message: 'Alterações enviadas e recebidas do Firebase.' };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Falha ao sincronizar.' };
    }
  };

  useEffect(() => {
    let mounted = true;
    let authRevision = 0;
    const loaded = loadData();
    const unsubscribe = GoogleAuthService.onAuthChange(async user => {
      const revision = ++authRevision;
      cloudEngineRef.current?.stop();
      cloudEngineRef.current = null;
      setFirebaseUserId(user?.uid ?? null);
      setCloudSyncStatus({ state: 'disconnected', message: 'Conecte a mesma conta Google nos dois dispositivos.' });
      await loaded;
      if (!mounted || revision !== authRevision || !user) return;
      const engine = new CloudSyncEngine(
        user.uid, Platform.OS === 'android' ? 'android' : 'web',
        () => reloadRef.current(),
        status => { if (mounted && revision === authRevision) setCloudSyncStatus(status); },
      );
      cloudEngineRef.current = engine;
      engine.start();
    });
    const resume = () => cloudEngineRef.current?.schedule(0);
    const appState = AppState.addEventListener('change', state => { if (state === 'active') resume(); });
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('online', resume);
      window.addEventListener('focus', resume);
    }
    return () => {
      mounted = false;
      ++authRevision;
      unsubscribe();
      appState.remove();
      cloudEngineRef.current?.stop();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('online', resume);
        window.removeEventListener('focus', resume);
      }
    };
  }, []);

  const handleThemeToggle = async () => {
    if (settings.hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const nextTheme: ThemeType = theme === 'dark' ? 'amoled' : theme === 'amoled' ? 'light' : 'dark';
    setTheme(nextTheme);
    await StorageService.saveTheme(nextTheme);
    const updatedSettings = { ...settings, theme: nextTheme };
    setSettings(updatedSettings);
    await StorageService.saveSettings(updatedSettings);
  };

  // Funções de Controle do Timer Resiliente (Unix Timestamps & Timestamp Diff)
  const saveActiveTimer = async (timer: ActiveTimerState | null) => {
    setActiveTimer(timer);
    await StorageService.saveActiveTimer(timer);
    setSavedTimer(timer ? TimerService.fromActiveTimerState(timer) : null);
  };

  const restoreTimerState = async (): Promise<SavedTimerState | null> => {
    const restored = await serviceRestoreTimerState();
    setSavedTimer(restored);
    setActiveTimer(toActiveTimerState(restored));
    return restored;
  };

  const saveTimerState = async (state: SavedTimerState | null): Promise<boolean> => {
    setSavedTimer(state);
    setActiveTimer(toActiveTimerState(state));
    return await serviceSaveTimerState(state);
  };

  const clearTimerState = async (): Promise<boolean> => {
    setSavedTimer(null);
    setActiveTimer(null);
    return await serviceClearTimerState();
  };

  const startTimer = async (
    mode: 'pomodoro' | 'stopwatch',
    initialDurationSeconds: number,
    subjectId?: string,
    isBreak?: boolean
  ) => {
    const now = Date.now();
    const newTimer: ActiveTimerState = {
      mode,
      isRunning: true,
      startedAt: now,
      targetEndTime: mode === 'pomodoro' ? now + (initialDurationSeconds * 1000) : undefined,
      remainingSeconds: initialDurationSeconds,
      initialDuration: initialDurationSeconds,
      subjectId,
      isBreak
    };
    await saveActiveTimer(newTimer);
  };

  const pauseTimer = async () => {
    if (!activeTimer) return;
    const now = Date.now();
    let remaining = activeTimer.remainingSeconds;
    if (activeTimer.mode === 'pomodoro' && activeTimer.targetEndTime) {
      remaining = Math.max(0, Math.round((activeTimer.targetEndTime - now) / 1000));
    } else if (activeTimer.mode === 'stopwatch') {
      remaining = Math.max(0, Math.floor((now - activeTimer.startedAt) / 1000));
    }

    const updated: ActiveTimerState = {
      ...activeTimer,
      isRunning: false,
      targetEndTime: undefined,
      remainingSeconds: remaining
    };
    await saveActiveTimer(updated);
  };

  const resumeTimer = async () => {
    if (!activeTimer) return;
    const now = Date.now();
    const updated: ActiveTimerState = {
      ...activeTimer,
      isRunning: true,
      startedAt: activeTimer.mode === 'stopwatch' ? now - (activeTimer.remainingSeconds * 1000) : now,
      targetEndTime: activeTimer.mode === 'pomodoro' ? now + (activeTimer.remainingSeconds * 1000) : undefined
    };
    await saveActiveTimer(updated);
  };

  const resetTimer = async () => {
    await clearTimerState();
  };

  const toggleEventCompletion = async (eventId: string) => {
    const updatedEvents = events.map(e => e.id === eventId ? { ...e, isCompleted: !e.isCompleted } : e);
    setEvents(updatedEvents);
    await StorageService.saveEvents(updatedEvents);
    triggerDebouncedCloudSync();
  };

  const toggleTaskCompletion = async (taskId: string) => {
    const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, isCompleted: !t.isCompleted } : t);
    setTasks(updatedTasks);
    await StorageService.saveTasks(updatedTasks);
    triggerDebouncedCloudSync();
  };

  const deleteEvent = async (eventId: string) => {
    const updatedEvents = events.filter(e => e.id !== eventId);
    setEvents(updatedEvents);
    await StorageService.saveEvents(updatedEvents);
    await NotificationService.cancelEventNotifications(eventId);
    triggerDebouncedCloudSync();
  };

  const updateAttendance = async (record: AttendanceRecord) => {
    const exists = attendances.find(a => a.id === record.id);
    const updated = exists 
      ? attendances.map(a => a.id === record.id ? record : a)
      : [...attendances, record];
    setAttendances(updated);
    await StorageService.saveAttendances(updated);
    triggerDebouncedCloudSync();
  };

  const archiveSubject = async (subjectId: string) => {
    const updated = subjects.map(s => s.id === subjectId ? { ...s, isArchived: true } : s);
    setSubjects(updated);
    await StorageService.saveSubjects(updated);
    triggerDebouncedCloudSync();
  };

  const archiveSubjects = async (subjectIds: string[]) => {
    if (!Array.isArray(subjectIds) || subjectIds.length === 0) return;
    const idSet = new Set(subjectIds);
    const updated = subjects.map(s => idSet.has(s.id) ? { ...s, isArchived: true } : s);
    setSubjects(updated);
    await StorageService.saveSubjects(updated);
    triggerDebouncedCloudSync();
  };

  const deleteSubject = async (subjectId: string) => {
    if (!subjectId || typeof subjectId !== 'string') return;

    const targetSubject = subjects.find(s => s.id === subjectId);
    const targetSubjectName = targetSubject?.name?.trim().toLowerCase();

    // Identifica eventos vinculados diretamente à matéria ou eventos de prova órfãos cujo título referencia o nome da matéria excluída
    const isSubjectEvent = (e: AppEvent): boolean => {
      if (e.subjectId === subjectId) return true;
      if (!e.subjectId || e.subjectId.trim() === '') {
        if (targetSubjectName && targetSubjectName.length > 0) {
          const titleLower = (e.title || '').toLowerCase();
          const isExam = (
            e.category === 'Provas/Trabalhos' ||
            e.category?.toLowerCase().includes('prova') ||
            titleLower.includes('prova') ||
            typeof e.grade !== 'undefined' ||
            typeof e.weight !== 'undefined'
          );
          if (isExam && titleLower.includes(targetSubjectName)) {
            return true;
          }
        }
      }
      return false;
    };

    const removedEvents = events.filter(isSubjectEvent);
    const removedEventIds = removedEvents.map(e => e.id);
    const updatedEvents = events.filter(e => !isSubjectEvent(e));
    const updatedSubjects = subjects.filter(s => s.id !== subjectId);
    const updatedAttendances = attendances.filter(a => a.subjectId !== subjectId);
    const updatedTasks = tasks.filter(t => t.subjectId !== subjectId);

    setSubjects(updatedSubjects);
    setEvents(updatedEvents);
    setAttendances(updatedAttendances);
    setTasks(updatedTasks);

    await Promise.all([
      StorageService.deleteSubject(subjectId),
      NotificationService.cancelSubjectNotifications(subjectId, removedEventIds),
    ]);
    triggerDebouncedCloudSync();
  };

  const addOrUpdateSubject = async (subject: Subject) => {
    const exists = subjects.find(s => s.id === subject.id);
    const updated = exists 
      ? subjects.map(s => s.id === subject.id ? subject : s)
      : [...subjects, subject];
    setSubjects(updated);
    await StorageService.saveSubjects(updated);
    triggerDebouncedCloudSync();
  };

  const addOrUpdateEvent = async (event: AppEvent) => {
    const exists = events.find(e => e.id === event.id);
    const updated = exists
      ? events.map(e => e.id === event.id ? event : e)
      : [...events, event];
    const saved = await StorageService.saveEvents(updated);
    if (!saved) throw new Error('Não foi possível salvar o evento.');
    setEvents(updated);
    await NotificationService.scheduleEventNotifications(event);
    triggerDebouncedCloudSync();
  };

  const updateAIConfig = async (config: AIConfig): Promise<boolean> => {
    try {
      const success = await StorageService.saveAIConfig(config);
      if (success) {
        setAiConfig(config);
      }
      return success;
    } catch (err) {
      console.error('AppContext: Error updating AI config:', err);
      return false;
    }
  };

  const value: AppContextData = {
    theme, setTheme,
    settings, setSettings,
    aiConfig, setAiConfig,
    events, setEvents,
    subjects, setSubjects,
    attendances, setAttendances,
    tasks, setTasks,
    studySessions, setStudySessions,
    streak, setStreak,
    semesters, setSemesters,
    gamification, setGamification,
    activeTimer, setActiveTimer,
    saveActiveTimer,
    savedTimer,
    restoreTimerState,
    saveTimerState,
    clearTimerState,
    startTimer,
    pauseTimer,
    resumeTimer,
    resetTimer,
    isInitializing,
    refreshData: loadData,
    handleThemeToggle,
    toggleEventCompletion,
    toggleTaskCompletion,
    deleteEvent,
    updateAttendance,
    archiveSubject,
    archiveSubjects,
    deleteSubject,
    addOrUpdateSubject,
    addOrUpdateEvent,
    updateAIConfig,
    triggerDebouncedCloudSync,
    syncCloudNow,
    firebaseUserId,
    cloudSyncStatus,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextData => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
