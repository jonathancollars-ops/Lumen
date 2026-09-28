import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppEvent,
  ThemeType,
  Subject,
  AttendanceRecord,
  StudyTask,
  StudySession,
  AIConfig,
  Semester,
  AppSettings,
  StudyStreak,
  BackupData,
  AACCActivity,
  GroupProject,
  GamificationData,
  ActiveTimerState,
  SavedTimerState
} from '../types';
import { getCurrentSemesterId, getCurrentSemesterName } from '../utils';
import { CourseCRService } from './CourseCRService';

const EVENTS_KEY = '@organiza_events';
const THEME_KEY = '@organiza_theme';
const SUBJECTS_KEY = '@organiza_subjects';
const ATTENDANCES_KEY = '@organiza_attendances';
const TASKS_KEY = '@organiza_tasks';
const STUDY_SESSIONS_KEY = '@organiza_studysessions';
const SEMESTERS_KEY = '@organiza_semesters';
const SETTINGS_KEY = '@organiza_settings';
const STREAK_KEY = '@organiza_streak';
const TEAMS_CONFIG_KEY = '@organiza_teams_config';
const AI_CONFIG_KEY = '@organiza_ai_config';
const SECURE_AI_API_KEY = 'lumen_secure_ai_api_key';
const AACC_KEY = '@organiza_aacc';
const GROUP_PROJECTS_KEY = '@organiza_group_projects';
const GAMIFICATION_KEY = '@organiza_gamification';
const ACTIVE_TIMER_KEY = '@organiza_active_timer';
const GOOGLE_CLIENT_ID_KEY = '@organiza_google_client_id';

interface SecureStoreModule {
  setItemAsync: (key: string, value: string, options?: { keychainAccessible?: number }) => Promise<void>;
  getItemAsync: (key: string) => Promise<string | null>;
  deleteItemAsync: (key: string) => Promise<void>;
  WHEN_UNLOCKED_THIS_DEVICE_ONLY?: number;
}

let secureStoreModule: SecureStoreModule | null = null;
try {
  secureStoreModule = require('expo-secure-store');
} catch {
  secureStoreModule = null;
}

const inMemorySecureVault: Record<string, string> = {};
const SECURE_VAULT_PREFIX = '@organiza_secure_vault_';

/**
 * Resets the in-memory cache for secure secrets.
 * Exported strictly for testing cold-start simulation.
 */
export function _resetInMemorySecureVaultForTesting(): void {
  Object.keys(inMemorySecureVault).forEach(k => delete inMemorySecureVault[k]);
}

/**
 * Universal safe Base64 encoder for strings (handles UTF-8).
 * Works across Node, React Native (Hermes/JSC), and Browser environments.
 */
function encodeBase64(input: string): string {
  if (!input) return '';
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(input, 'utf-8').toString('base64');
    }
  } catch {
    // Buffer unavailable or failed, fallback
  }

  try {
    if (typeof btoa === 'function') {
      return btoa(unescape(encodeURIComponent(input)));
    }
  } catch {
    // btoa failed, fallback
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const utf8Bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let charcode = input.charCodeAt(i);
    if (charcode < 0x80) {
      utf8Bytes.push(charcode);
    } else if (charcode < 0x800) {
      utf8Bytes.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8Bytes.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (input.charCodeAt(i) & 0x3ff));
      utf8Bytes.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    }
  }
  let output = '';
  let i = 0;
  while (i < utf8Bytes.length) {
    const b1 = utf8Bytes[i++];
    const b2 = i < utf8Bytes.length ? utf8Bytes[i++] : NaN;
    const b3 = i < utf8Bytes.length ? utf8Bytes[i++] : NaN;
    const e1 = b1 >> 2;
    const e2 = ((b1 & 3) << 4) | (b2 >> 4);
    let e3 = ((b2 & 15) << 2) | (b3 >> 6);
    let e4 = b3 & 63;
    if (isNaN(b2)) {
      e3 = e4 = 64;
    } else if (isNaN(b3)) {
      e4 = 64;
    }
    output += chars.charAt(e1) + chars.charAt(e2) + chars.charAt(e3) + chars.charAt(e4);
  }
  return output;
}

/**
 * Universal safe Base64 decoder for strings (handles UTF-8).
 */
function decodeBase64(input: string): string {
  if (!input) return '';
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(input, 'base64').toString('utf-8');
    }
  } catch {
    // Buffer unavailable or failed, fallback
  }

  try {
    if (typeof atob === 'function') {
      return decodeURIComponent(escape(atob(input)));
    }
  } catch {
    // atob failed, fallback
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const str = input.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];
  let i = 0;
  while (i < str.length) {
    const enc1 = chars.indexOf(str.charAt(i++));
    const enc2 = chars.indexOf(str.charAt(i++));
    const enc3 = chars.indexOf(str.charAt(i++));
    const enc4 = chars.indexOf(str.charAt(i++));
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    bytes.push(chr1);
    if (enc3 !== 64 && enc3 !== -1) bytes.push(chr2);
    if (enc4 !== 64 && enc4 !== -1) bytes.push(chr3);
  }
  let out = '';
  let j = 0;
  while (j < bytes.length) {
    const c = bytes[j++];
    if (c < 128) {
      out += String.fromCharCode(c);
    } else if (c > 191 && c < 224) {
      const c2 = bytes[j++];
      out += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
    } else {
      const c2 = bytes[j++];
      const c3 = bytes[j++];
      out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
    }
  }
  return out;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fullscreen: false,
  pomodoroFocusMin: 25,
  pomodoroBreakMin: 5,
  pomodoroLongBreakMin: 15,
  defaultPassGrade: 7.0,
  examWeekMode: false,
  soundEnabled: true,
  hapticsEnabled: true,
};

export const DEFAULT_GAMIFICATION: GamificationData = {
  xp: 0,
  level: 1,
  unlockedAchievements: [],
  claimedAchievements: [],
  totalFocusMinutes: 0,
  processedEventIds: []
};

export const DEFAULT_STREAK: StudyStreak = {
  currentStreak: 0,
  longestStreak: 0,
  lastStudyDate: '',
  bestStreak: 0,
  totalStudyDays: 0,
};

const VALID_THEMES: ThemeType[] = ['dark', 'light', 'amoled'];

/**
 * Detects whether a storage write failure is caused by a full disk,
 * database quota exhaustion, or storage subsystem error.
 */
export function isDiskQuotaError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  return (
    lower.includes('quota') ||
    lower.includes('full') ||
    lower.includes('sqlite_full') ||
    lower.includes('disk is full') ||
    lower.includes('insufficient storage') ||
    lower.includes('no space left on device') ||
    lower.includes('exceeded the quota')
  );
}

export interface StorageErrorEvent {
  key: string;
  error: unknown;
  isQuota: boolean;
}

export type StorageErrorListener = (event: StorageErrorEvent) => void;
const storageErrorListeners = new Set<StorageErrorListener>();

export function addStorageErrorListener(listener: StorageErrorListener): () => void {
  storageErrorListeners.add(listener);
  return () => {
    storageErrorListeners.delete(listener);
  };
}

export function notifyStorageError(event: StorageErrorEvent): void {
  storageErrorListeners.forEach(listener => {
    try {
      listener(event);
    } catch (e: unknown) {
      console.warn('[StorageService] Error listener failed', e);
    }
  });
}

/**
 * Safely writes a key-value pair to AsyncStorage with comprehensive error isolation.
 * Protects against:
 * 1. Disk quota exceeded errors (SQLite full, QuotaExceededError, out of storage)
 * 2. Unhandled promise rejections that could crash or unmount the React component tree
 * 3. Empty or non-string key/value errors
 * 
 * Returns true if written successfully, or false if an error occurred (error is trapped and logged).
 */
export async function safeSetItem(key: string, value: string): Promise<boolean> {
  if (!key || typeof key !== 'string') {
    console.error('[StorageService] safeSetItem: invalid storage key provided');
    return false;
  }
  if (typeof value !== 'string') {
    console.error(`[StorageService] safeSetItem: invalid value provided for key "${key}"`);
    return false;
  }

  try {
    await AsyncStorage.setItem(key, value);
    return true;
  } catch (error: unknown) {
    const isQuota = isDiskQuotaError(error);
    if (isQuota) {
      console.error(`[StorageService] Disk quota exceeded while saving to "${key}". Write operation aborted safely without crashing UI.`, error);
    } else {
      console.error(`[StorageService] Storage write error for key "${key}". Operation trapped safely.`, error);
    }
    notifyStorageError({ key, error, isQuota });
    return false;
  }
}

/**
 * Safely parses a raw JSON string into a guaranteed non-null typed array.
 * Rules:
 * 1. If raw is null, undefined, not a string, or empty/whitespace -> returns fallback (or []).
 * 2. If raw is literal "null" or "undefined" -> returns fallback (or []).
 * 3. Catches all JSON.parse syntax errors -> returns fallback (or []).
 * 4. Ensures the parsed value is strictly an Array via Array.isArray().
 * 5. Sanitizes array elements by filtering out null and undefined values.
 */
export function safeParseArray<T>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw || typeof raw !== 'string') {
    return Array.isArray(fallback) ? fallback : [];
  }
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') {
    return Array.isArray(fallback) ? fallback : [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return Array.isArray(fallback) ? fallback : [];
    }
    return parsed.filter((item): item is T => item !== null && item !== undefined);
  } catch {
    return Array.isArray(fallback) ? fallback : [];
  }
}

/**
 * Safely parses a raw JSON string into a guaranteed non-null typed object,
 * merging with fallback values to guarantee field completeness.
 * Rules:
 * 1. If raw is null, undefined, not a string, or empty/whitespace -> returns shallow copy of fallback.
 * 2. If raw is literal "null" or "undefined" -> returns shallow copy of fallback.
 * 3. Catches all JSON.parse syntax errors -> returns shallow copy of fallback.
 * 4. Ensures parsed value is a non-null, non-array object (typeof === 'object' && !Array.isArray).
 * 5. Merges fallback with parsed object to supply missing/undefined fields.
 */
export function safeParseObject<T extends object>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== 'string') {
    return { ...fallback };
  }
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') {
    return { ...fallback };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...fallback, ...parsed };
    }
    return { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export interface BackupValidationResult {
  isValid: boolean;
  errors: string[];
  data?: BackupData;
}

/**
 * Validates untrusted input against the BackupData schema before allowing import into storage.
 * Strictly checks types, required fields, and entity integrity without throwing.
 */
export function validateBackupSchema(input: unknown): BackupValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      isValid: false,
      errors: ['O arquivo de backup deve ser um objeto JSON válido (não pode ser nulo, primitivo ou array).']
    };
  }

  const raw = input as Record<string, unknown>;

  // 1. Version validation
  if (typeof raw.version !== 'number' || !Number.isFinite(raw.version) || raw.version <= 0) {
    errors.push('Campo "version" é obrigatório e deve ser um número positivo.');
  }

  // 2. Timestamp validation
  if (typeof raw.timestamp !== 'string' || raw.timestamp.trim().length === 0) {
    errors.push('Campo "timestamp" é obrigatório e deve ser uma string de data válida.');
  }

  // Helper validators for collections
  const validateArrayOfObjects = (
    key: string,
    itemValidator?: (item: Record<string, unknown>, index: number) => string | null
  ): unknown[] | undefined => {
    if (raw[key] === undefined || raw[key] === null) {
      return undefined;
    }
    if (!Array.isArray(raw[key])) {
      errors.push(`Campo "${key}" deve ser um array.`);
      return undefined;
    }
    const arr = raw[key] as unknown[];
    if (itemValidator) {
      arr.forEach((item, idx) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(`Elemento [${idx}] em "${key}" não é um objeto válido.`);
        } else {
          const err = itemValidator(item as Record<string, unknown>, idx);
          if (err) errors.push(err);
        }
      });
    }
    return arr;
  };

  // Validate events
  const rawEvents = validateArrayOfObjects('events', (item, idx) => {
    if (typeof item.id !== 'string' || item.id.trim() === '') return `events[${idx}] possui "id" inválido ou ausente.`;
    if (typeof item.title !== 'string') return `events[${idx}] possui "title" inválido.`;
    if (typeof item.date !== 'string' || item.date.trim() === '') return `events[${idx}] possui "date" inválido ou ausente.`;
    return null;
  });

  // Validate subjects
  const rawSubjects = validateArrayOfObjects('subjects', (item, idx) => {
    if (typeof item.id !== 'string' || item.id.trim() === '') return `subjects[${idx}] possui "id" inválido ou ausente.`;
    if (typeof item.name !== 'string') return `subjects[${idx}] possui "name" inválido.`;
    return null;
  });

  // Validate attendances
  const rawAttendances = validateArrayOfObjects('attendances', (item, idx) => {
    if (typeof item.id !== 'string' || item.id.trim() === '') return `attendances[${idx}] possui "id" inválido ou ausente.`;
    if (typeof item.date !== 'string' || item.date.trim() === '') return `attendances[${idx}] possui "date" inválido ou ausente.`;
    return null;
  });

  // Validate tasks
  const rawTasks = validateArrayOfObjects('tasks', (item, idx) => {
    if (typeof item.id !== 'string' || item.id.trim() === '') return `tasks[${idx}] possui "id" inválido ou ausente.`;
    if (typeof item.title !== 'string') return `tasks[${idx}] possui "title" inválido.`;
    return null;
  });

  // Validate studySessions
  const rawSessions = validateArrayOfObjects('studySessions', (item, idx) => {
    if (typeof item.id !== 'string' || item.id.trim() === '') return `studySessions[${idx}] possui "id" inválido ou ausente.`;
    return null;
  });

  // Validate semesters
  const rawSemesters = validateArrayOfObjects('semesters', (item, idx) => {
    if (typeof item.id !== 'string' || item.id.trim() === '') return `semesters[${idx}] possui "id" inválido ou ausente.`;
    return null;
  });

  // Validate aaccActivities
  const rawAacc = validateArrayOfObjects('aaccActivities');

  // Validate groupProjects
  const rawGroupProjects = validateArrayOfObjects('groupProjects');

  // Validate settings object if present
  let settingsObj: Partial<AppSettings> | undefined = undefined;
  if (raw.settings !== undefined && raw.settings !== null) {
    if (typeof raw.settings !== 'object' || Array.isArray(raw.settings)) {
      errors.push('Campo "settings" deve ser um objeto.');
    } else {
      settingsObj = raw.settings as Partial<AppSettings>;
    }
  }

  // Validate streak object if present
  let streakObj: StudyStreak | undefined = undefined;
  if (raw.streak !== undefined && raw.streak !== null) {
    if (typeof raw.streak !== 'object' || Array.isArray(raw.streak)) {
      errors.push('Campo "streak" deve ser um objeto.');
    } else {
      streakObj = raw.streak as StudyStreak;
    }
  }

  // Validate gamification object if present
  let gamificationObj: GamificationData | undefined = undefined;
  if (raw.gamification !== undefined && raw.gamification !== null) {
    if (typeof raw.gamification !== 'object' || Array.isArray(raw.gamification)) {
      errors.push('Campo "gamification" deve ser um objeto.');
    } else {
      gamificationObj = raw.gamification as GamificationData;
    }
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      errors
    };
  }

  const sanitizedData: BackupData = {
    version: raw.version as number,
    timestamp: raw.timestamp as string,
    events: (rawEvents ? rawEvents.filter(Boolean) : []) as AppEvent[],
    subjects: (rawSubjects ? rawSubjects.filter(Boolean) : []) as Subject[],
    attendances: (rawAttendances ? rawAttendances.filter(Boolean) : []) as AttendanceRecord[],
    tasks: (rawTasks ? rawTasks.filter(Boolean) : []) as StudyTask[],
    studySessions: (rawSessions ? rawSessions.filter(Boolean) : []) as StudySession[],
    semesters: (rawSemesters ? rawSemesters.filter(Boolean) : []) as Semester[],
    settings: settingsObj,
    streak: streakObj,
    aaccActivities: (rawAacc ? rawAacc.filter(Boolean) : undefined) as AACCActivity[] | undefined,
    groupProjects: (rawGroupProjects ? rawGroupProjects.filter(Boolean) : undefined) as GroupProject[] | undefined,
    gamification: gamificationObj,
  };

  return {
    isValid: true,
    errors: [],
    data: sanitizedData
  };
}

export const StorageService = {
  async getEvents(): Promise<AppEvent[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(EVENTS_KEY);
      return safeParseArray<AppEvent>(jsonValue, []);
    } catch (e) {
      console.error('Failed to fetch events from storage', e);
      return [];
    }
  },

  async saveEvents(events: AppEvent[]): Promise<boolean> {
    try {
      const safeEvents = Array.isArray(events)
        ? events.filter((e): e is AppEvent => Boolean(e && typeof e === 'object' && typeof e.id === 'string'))
        : [];
      const jsonValue = JSON.stringify(safeEvents);
      return await safeSetItem(EVENTS_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize events', e);
      notifyStorageError({ key: EVENTS_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async getSubjects(): Promise<Subject[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(SUBJECTS_KEY);
      return safeParseArray<Subject>(jsonValue, []);
    } catch (e) {
      console.error('Failed to fetch subjects from storage', e);
      return [];
    }
  },

  async saveSubjects(subjects: Subject[]): Promise<boolean> {
    try {
      const safeSubjects = Array.isArray(subjects)
        ? subjects.filter((s): s is Subject => Boolean(s && typeof s === 'object' && typeof s.id === 'string'))
        : [];
      const jsonValue = JSON.stringify(safeSubjects);
      return await safeSetItem(SUBJECTS_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize subjects', e);
      notifyStorageError({ key: SUBJECTS_KEY, error: e, isQuota: false });
      return false;
    }
  },

  /**
   * Exclui uma disciplina em cascata do armazenamento local:
   * 1. Remove de @organiza_subjects
   * 2. Remove eventos vinculados ou órfãos de provas de @organiza_events
   * 3. Remove registros de frequência de @organiza_attendances
   * 4. Remove tarefas de estudo de @organiza_tasks
   * 5. Reconcilia o histórico curricular em CourseCRService, desassociando e removendo referências em courseData.semesters
   */
  async deleteSubject(subjectId: string): Promise<boolean> {
    if (!subjectId || typeof subjectId !== 'string') return false;

    try {
      // 1. Remove de subjects
      const subjects = await this.getSubjects();
      const targetSubject = subjects.find(s => s.id === subjectId);
      const targetName = targetSubject?.name?.trim().toLowerCase();
      const updatedSubjects = subjects.filter(s => s.id !== subjectId);
      await this.saveSubjects(updatedSubjects);

      // 2. Remove eventos associados
      const events = await this.getEvents();
      const isSubjectEvent = (e: AppEvent): boolean => {
        if (e.subjectId === subjectId) return true;
        if (!e.subjectId || e.subjectId.trim() === '') {
          if (targetName && targetName.length > 0) {
            const titleLower = (e.title || '').toLowerCase();
            const isExam = (
              e.category === 'Provas/Trabalhos' ||
              e.category?.toLowerCase().includes('prova') ||
              titleLower.includes('prova') ||
              typeof e.grade !== 'undefined' ||
              typeof e.weight !== 'undefined'
            );
            if (isExam && titleLower.includes(targetName)) {
              return true;
            }
          }
        }
        return false;
      };
      const updatedEvents = events.filter(e => !isSubjectEvent(e));
      await this.saveEvents(updatedEvents);

      // 3. Remove presenças
      const attendances = await this.getAttendances();
      const updatedAttendances = attendances.filter(a => a.subjectId !== subjectId);
      await this.saveAttendances(updatedAttendances);

      // 4. Remove tarefas
      const tasks = await this.getTasks();
      const updatedTasks = tasks.filter(t => t.subjectId !== subjectId);
      await this.saveTasks(updatedTasks);

      // 5. Reconciliação atômica no Desempenho (CourseCRService)
      try {
        const courseData = await CourseCRService.loadCourseProgress();
        if (courseData) {
          const activeIds = updatedSubjects.map(s => s.id);
          let updatedCourse = CourseCRService.reconcileWithActiveSubjects(courseData, activeIds);
          updatedCourse = CourseCRService.removeSubjectFromCurrentSemester(
            updatedCourse,
            subjectId,
            targetSubject?.name
          );
          await CourseCRService.saveCourseProgress(updatedCourse);
        }
      } catch (crErr) {
        console.warn('[StorageService] Falha ao reconciliar courseData ao deletar matéria:', crErr);
      }

      return true;
    } catch (e: unknown) {
      console.error('[StorageService] Erro ao deletar matéria em cascata:', e);
      return false;
    }
  },

  async getTheme(): Promise<ThemeType> {
    try {
      const theme = await AsyncStorage.getItem(THEME_KEY);
      return (theme && VALID_THEMES.includes(theme as ThemeType)) ? (theme as ThemeType) : 'dark';
    } catch (e) {
      return 'dark';
    }
  },

  async saveTheme(theme: ThemeType): Promise<boolean> {
    try {
      const safeTheme = VALID_THEMES.includes(theme) ? theme : 'dark';
      return await safeSetItem(THEME_KEY, safeTheme);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to save theme', e);
      notifyStorageError({ key: THEME_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async getAttendances(): Promise<AttendanceRecord[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(ATTENDANCES_KEY);
      return safeParseArray<AttendanceRecord>(jsonValue, []);
    } catch (e) {
      console.error('Failed to fetch attendances', e);
      return [];
    }
  },

  async saveAttendances(records: AttendanceRecord[]): Promise<boolean> {
    try {
      const safeRecords = Array.isArray(records)
        ? records.filter((r): r is AttendanceRecord => Boolean(r && typeof r === 'object' && typeof r.id === 'string'))
        : [];
      const jsonValue = JSON.stringify(safeRecords);
      return await safeSetItem(ATTENDANCES_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize attendances', e);
      notifyStorageError({ key: ATTENDANCES_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async getTasks(): Promise<StudyTask[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(TASKS_KEY);
      return safeParseArray<StudyTask>(jsonValue, []);
    } catch (e) {
      console.error('Failed to fetch tasks', e);
      return [];
    }
  },

  async saveTasks(tasks: StudyTask[]): Promise<boolean> {
    try {
      const safeTasks = Array.isArray(tasks)
        ? tasks.filter((t): t is StudyTask => Boolean(t && typeof t === 'object' && typeof t.id === 'string'))
        : [];
      const jsonValue = JSON.stringify(safeTasks);
      return await safeSetItem(TASKS_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize tasks', e);
      notifyStorageError({ key: TASKS_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async getStudySessions(): Promise<StudySession[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(STUDY_SESSIONS_KEY);
      return safeParseArray<StudySession>(jsonValue, []);
    } catch (e) {
      console.error('Failed to fetch study sessions', e);
      return [];
    }
  },

  async saveStudySessions(sessions: StudySession[]): Promise<boolean> {
    try {
      const safeSessions = Array.isArray(sessions)
        ? sessions.filter((s): s is StudySession => Boolean(s && typeof s === 'object' && typeof s.id === 'string'))
        : [];
      const jsonValue = JSON.stringify(safeSessions);
      return await safeSetItem(STUDY_SESSIONS_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize study sessions', e);
      notifyStorageError({ key: STUDY_SESSIONS_KEY, error: e, isQuota: false });
      return false;
    }
  },

  /**
   * Obtém o estado resiliente do timer/cronômetro ativo em background/foreground.
   */
  async getActiveTimer(): Promise<ActiveTimerState | null> {
    try {
      const raw = await AsyncStorage.getItem(ACTIVE_TIMER_KEY);
      if (!raw || typeof raw !== 'string' || raw.trim() === '' || raw === 'null') {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && (parsed.mode === 'pomodoro' || parsed.mode === 'stopwatch')) {
        const safeStartedAt = Number.isFinite(parsed.startedAt) ? Number(parsed.startedAt) : Date.now();
        const safeTargetEnd = Number.isFinite(parsed.targetEndTime) ? Number(parsed.targetEndTime) : undefined;
        const safeRemaining = Number.isFinite(parsed.remainingSeconds) ? Math.max(0, Number(parsed.remainingSeconds)) : 0;
        const safeInitial = Number.isFinite(parsed.initialDuration) ? Math.max(0, Number(parsed.initialDuration)) : 0;
        return {
          ...parsed,
          startedAt: safeStartedAt,
          targetEndTime: safeTargetEnd,
          remainingSeconds: safeRemaining,
          initialDuration: safeInitial,
        } as ActiveTimerState;
      }
      return null;
    } catch (e) {
      console.error('[StorageService] Erro ao ler activeTimer:', e);
      return null;
    }
  },

  /**
   * Salva ou limpa o estado do timer resiliente (timestamps Unix para evitar drift de clock).
   */
  async saveActiveTimer(timer: ActiveTimerState | null): Promise<boolean> {
    try {
      if (!timer) {
        await AsyncStorage.removeItem(ACTIVE_TIMER_KEY);
        try {
          const { TIMER_STATE_KEY } = require('./TimerService');
          await AsyncStorage.removeItem(TIMER_STATE_KEY);
        } catch {}
        return true;
      }
      const jsonValue = JSON.stringify(timer);
      const res = await safeSetItem(ACTIVE_TIMER_KEY, jsonValue);
      try {
        const { fromActiveTimerState, TIMER_STATE_KEY } = require('./TimerService');
        const saved = fromActiveTimerState(timer);
        if (saved) {
          await safeSetItem(TIMER_STATE_KEY, JSON.stringify(saved));
        }
      } catch {}
      return res;
    } catch (e) {
      console.error('[StorageService] Erro ao salvar activeTimer:', e);
      return false;
    }
  },

  /**
   * Delegados do TimerService para a arquitetura Timestamp Diff
   */
  async getSavedTimerState(): Promise<SavedTimerState | null> {
    try {
      const { TimerService } = require('./TimerService');
      return await TimerService.getTimerState();
    } catch (e) {
      console.error('[StorageService] Erro em getSavedTimerState:', e);
      return null;
    }
  },

  async saveTimerState(state: SavedTimerState | null): Promise<boolean> {
    try {
      const { TimerService } = require('./TimerService');
      return await TimerService.saveTimerState(state);
    } catch (e) {
      console.error('[StorageService] Erro em saveTimerState:', e);
      return false;
    }
  },

  async restoreTimerState(): Promise<SavedTimerState | null> {
    try {
      const { TimerService } = require('./TimerService');
      return await TimerService.restoreTimerState();
    } catch (e) {
      console.error('[StorageService] Erro em restoreTimerState:', e);
      return null;
    }
  },

  async clearTimerState(): Promise<boolean> {
    try {
      const { TimerService } = require('./TimerService');
      return await TimerService.clearTimerState();
    } catch (e) {
      console.error('[StorageService] Erro em clearTimerState:', e);
      return false;
    }
  },

  async getSemesters(): Promise<Semester[]> {
    try {
      const currentSemId = getCurrentSemesterId();
      const currentSemName = getCurrentSemesterName();
      const jsonValue = await AsyncStorage.getItem(SEMESTERS_KEY);
      let semesters: Semester[] = safeParseArray<Semester>(jsonValue, []);

      if (semesters.length === 0) {
        semesters = [{
          id: currentSemId,
          name: currentSemName || currentSemId,
          isCurrent: true
        }];
        await this.saveSemesters(semesters);
      } else {
        const hasCurrent = semesters.some(s => s && (s.id === currentSemId || s.name === currentSemId || s.name === currentSemName));
        if (!hasCurrent) {
          semesters = semesters.map(s => ({ ...s, isCurrent: false }));
          semesters.unshift({
            id: currentSemId,
            name: currentSemName || currentSemId,
            isCurrent: true
          });
          await this.saveSemesters(semesters);
        }
      }
      return semesters;
    } catch (e) {
      console.error('Failed to fetch semesters from storage', e);
      const semId = getCurrentSemesterId();
      const semName = getCurrentSemesterName();
      return [{ id: semId, name: semName || semId, isCurrent: true }];
    }
  },

  async saveSemesters(semesters: Semester[]): Promise<boolean> {
    try {
      const safeSemesters = Array.isArray(semesters)
        ? semesters.filter((s): s is Semester => Boolean(s && typeof s === 'object' && typeof s.id === 'string'))
        : [];
      const jsonValue = JSON.stringify(safeSemesters);
      return await safeSetItem(SEMESTERS_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize semesters', e);
      notifyStorageError({ key: SEMESTERS_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async getSettings(): Promise<AppSettings> {
    try {
      const jsonValue = await AsyncStorage.getItem(SETTINGS_KEY);
      const parsed = safeParseObject<AppSettings>(jsonValue, DEFAULT_SETTINGS);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        fullscreen: parsed.fullscreen === true,
        pomodoroFocusMin: Number.isFinite(parsed.pomodoroFocusMin) ? Number(parsed.pomodoroFocusMin) : DEFAULT_SETTINGS.pomodoroFocusMin,
        pomodoroBreakMin: Number.isFinite(parsed.pomodoroBreakMin) ? Number(parsed.pomodoroBreakMin) : DEFAULT_SETTINGS.pomodoroBreakMin,
        pomodoroLongBreakMin: Number.isFinite(parsed.pomodoroLongBreakMin) ? Number(parsed.pomodoroLongBreakMin) : DEFAULT_SETTINGS.pomodoroLongBreakMin,
        defaultPassGrade: Number.isFinite(parsed.defaultPassGrade) ? Number(parsed.defaultPassGrade) : DEFAULT_SETTINGS.defaultPassGrade,
        soundEnabled: parsed.soundEnabled !== false,
        hapticsEnabled: parsed.hapticsEnabled !== false,
        examWeekMode: parsed.examWeekMode === true,
      };
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  },

  async saveSettings(settings: AppSettings): Promise<boolean> {
    try {
      const safe: AppSettings = {
        theme: (settings && VALID_THEMES.includes(settings.theme)) ? settings.theme : DEFAULT_SETTINGS.theme,
        fullscreen: settings?.fullscreen === true,
        pomodoroFocusMin: Math.max(1, Math.min(180, Number(settings?.pomodoroFocusMin) || DEFAULT_SETTINGS.pomodoroFocusMin)),
        pomodoroBreakMin: Math.max(1, Math.min(60, Number(settings?.pomodoroBreakMin) || DEFAULT_SETTINGS.pomodoroBreakMin)),
        pomodoroLongBreakMin: Math.max(1, Math.min(60, Number(settings?.pomodoroLongBreakMin) || DEFAULT_SETTINGS.pomodoroLongBreakMin)),
        defaultPassGrade: Math.max(0, Math.min(10, Number(settings?.defaultPassGrade) || DEFAULT_SETTINGS.defaultPassGrade)),
        examWeekMode: settings?.examWeekMode === true,
        soundEnabled: settings?.soundEnabled !== false,
        hapticsEnabled: settings?.hapticsEnabled !== false,
        currentSemesterId: settings?.currentSemesterId || undefined,
      };
      const jsonValue = JSON.stringify(safe);
      return await safeSetItem(SETTINGS_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize settings', e);
      notifyStorageError({ key: SETTINGS_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async getStreak(): Promise<StudyStreak> {
    try {
      const jsonValue = await AsyncStorage.getItem(STREAK_KEY);
      const parsed = safeParseObject<StudyStreak>(jsonValue, DEFAULT_STREAK);
      const current = Number.isFinite(parsed.currentStreak) ? Math.max(0, Number(parsed.currentStreak)) : 0;
      const longest = Number.isFinite(parsed.longestStreak)
        ? Math.max(0, Number(parsed.longestStreak))
        : Number.isFinite(parsed.bestStreak)
        ? Math.max(0, Number(parsed.bestStreak!))
        : 0;
      const best = Number.isFinite(parsed.bestStreak)
        ? Math.max(0, Number(parsed.bestStreak!))
        : longest;
      const totalDays = Number.isFinite(parsed.totalStudyDays)
        ? Math.max(0, Number(parsed.totalStudyDays!))
        : 0;
      return {
        currentStreak: current,
        longestStreak: Math.max(longest, best),
        lastStudyDate: typeof parsed.lastStudyDate === 'string' ? parsed.lastStudyDate : '',
        bestStreak: Math.max(best, longest),
        totalStudyDays: totalDays,
      };
    } catch (e) {
      return DEFAULT_STREAK;
    }
  },

  async saveStreak(streak: StudyStreak): Promise<boolean> {
    try {
      const current = Math.max(0, Number(streak?.currentStreak) || 0);
      const longest = Number.isFinite(streak?.longestStreak)
        ? Math.max(0, Number(streak.longestStreak))
        : Number.isFinite(streak?.bestStreak)
        ? Math.max(0, Number(streak.bestStreak!))
        : 0;
      const best = Number.isFinite(streak?.bestStreak)
        ? Math.max(0, Number(streak.bestStreak!))
        : longest;
      const totalDays = Number.isFinite(streak?.totalStudyDays)
        ? Math.max(0, Number(streak.totalStudyDays!))
        : 0;
      const safe: StudyStreak = {
        currentStreak: current,
        longestStreak: Math.max(longest, best),
        lastStudyDate: typeof streak?.lastStudyDate === 'string' ? streak.lastStudyDate : '',
        bestStreak: Math.max(best, longest),
        totalStudyDays: totalDays,
      };
      const jsonValue = JSON.stringify(safe);
      return await safeSetItem(STREAK_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize streak', e);
      notifyStorageError({ key: STREAK_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async getAACCActivities(): Promise<AACCActivity[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(AACC_KEY);
      return safeParseArray<AACCActivity>(jsonValue, []);
    } catch (e) {
      console.error('Failed to fetch AACC activities', e);
      return [];
    }
  },

  async saveAACCActivities(activities: AACCActivity[]): Promise<boolean> {
    try {
      const safeActivities = Array.isArray(activities)
        ? activities.filter((a): a is AACCActivity => Boolean(a && typeof a === 'object' && typeof a.id === 'string'))
        : [];
      const jsonValue = JSON.stringify(safeActivities);
      return await safeSetItem(AACC_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize AACC activities', e);
      notifyStorageError({ key: AACC_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async getGroupProjects(): Promise<GroupProject[]> {
    try {
      const jsonValue = await AsyncStorage.getItem(GROUP_PROJECTS_KEY);
      const parsed = safeParseArray<GroupProject>(jsonValue, []);
      return parsed.map(p => ({
        ...p,
        members: Array.isArray(p.members) ? p.members.filter(Boolean) : [],
        tasks: Array.isArray(p.tasks) ? p.tasks.filter(Boolean) : []
      }));
    } catch (e) {
      console.error('Failed to fetch group projects', e);
      return [];
    }
  },

  async saveGroupProjects(projects: GroupProject[]): Promise<boolean> {
    try {
      const safeProjects = Array.isArray(projects) ? projects.filter(Boolean).map(p => ({
        ...p,
        members: Array.isArray(p.members) ? p.members.filter(Boolean) : [],
        tasks: Array.isArray(p.tasks) ? p.tasks.filter(Boolean) : []
      })) : [];
      const jsonValue = JSON.stringify(safeProjects);
      return await safeSetItem(GROUP_PROJECTS_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize group projects', e);
      notifyStorageError({ key: GROUP_PROJECTS_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async getGamificationData(): Promise<GamificationData> {
    try {
      const jsonValue = await AsyncStorage.getItem(GAMIFICATION_KEY);
      const parsed = safeParseObject<GamificationData>(jsonValue, DEFAULT_GAMIFICATION);
      return {
        xp: Number.isFinite(parsed.xp) ? Math.max(0, Number(parsed.xp)) : 0,
        level: Number.isFinite(parsed.level) ? Math.max(1, Number(parsed.level)) : 1,
        unlockedAchievements: Array.isArray(parsed.unlockedAchievements) ? parsed.unlockedAchievements.filter(Boolean) : [],
        claimedAchievements: Array.isArray(parsed.claimedAchievements) ? parsed.claimedAchievements.filter(Boolean) : [],
        totalFocusMinutes: Number.isFinite(parsed.totalFocusMinutes) ? Math.max(0, Number(parsed.totalFocusMinutes)) : 0,
        processedEventIds: Array.isArray(parsed.processedEventIds) ? parsed.processedEventIds.filter(Boolean) : [],
      };
    } catch (e) {
      return DEFAULT_GAMIFICATION;
    }
  },

  async saveGamificationData(data: GamificationData): Promise<boolean> {
    try {
      const safe: GamificationData = {
        xp: Math.max(0, Number(data?.xp) || 0),
        level: Math.max(1, Number(data?.level) || 1),
        unlockedAchievements: Array.isArray(data?.unlockedAchievements) ? data.unlockedAchievements.filter(Boolean) : [],
        claimedAchievements: Array.isArray(data?.claimedAchievements) ? data.claimedAchievements.filter(Boolean) : [],
        totalFocusMinutes: Math.max(0, Number(data?.totalFocusMinutes) || 0),
        processedEventIds: Array.isArray(data?.processedEventIds) ? data.processedEventIds.filter(Boolean) : [],
      };
      const jsonValue = JSON.stringify(safe);
      return await safeSetItem(GAMIFICATION_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to serialize gamification data', e);
      notifyStorageError({ key: GAMIFICATION_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async addXP(amount: number, additionalMinutes: number = 0, eventId?: string): Promise<GamificationData> {
    try {
      const validAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
      const validMinutes = Number.isFinite(additionalMinutes) ? Math.max(0, additionalMinutes) : 0;
      
      const current = await this.getGamificationData();
      const processedIds = current.processedEventIds || [];
      
      if (eventId && processedIds.includes(eventId)) {
        return current;
      }
      
      // Dependência isolada dinamicamente para evitar ciclo circular caso StorageService carregue antes
      const GamificationServiceModule = require('./GamificationService');
      const GamificationService = GamificationServiceModule.GamificationService;
      
      let updated: GamificationData;
      if (validMinutes > 0) {
        updated = GamificationService.awardStudyXP(current, validMinutes);
        if (validAmount > 0) {
           updated = GamificationService.awardGenericXP(updated, validAmount);
        }
      } else {
        updated = GamificationService.awardGenericXP(current, validAmount);
      }
      
      if (eventId) {
        updated.processedEventIds = [...processedIds, eventId].slice(-5000);
      }
      
      await this.saveGamificationData(updated);
      return updated;
    } catch (e) {
      return DEFAULT_GAMIFICATION;
    }
  },

  async claimAchievementXP(id: string, xp: number): Promise<GamificationData> {
    try {
      if (!id || typeof id !== 'string') {
        return await this.getGamificationData();
      }
      const current = await this.getGamificationData();
      const claimed = new Set(current.claimedAchievements || []);
      if (claimed.has(id)) {
        return current; // Idempotente: previne resgate duplicado de XP
      }
      claimed.add(id);

      const unlocked = new Set(current.unlockedAchievements || []);
      unlocked.add(id);

      const safeXP = Math.max(0, Number.isFinite(xp) ? xp : 0);
      const newXP = current.xp + safeXP;

      const GamificationServiceModule = require('./GamificationService');
      const GamificationService = GamificationServiceModule.GamificationService;
      const newLevel = Math.max(current.level, GamificationService.calculateLevelFromXP(newXP));

      const updated: GamificationData = {
        ...current,
        xp: newXP,
        level: newLevel,
        unlockedAchievements: Array.from(unlocked),
        claimedAchievements: Array.from(claimed),
      };

      await this.saveGamificationData(updated);
      return updated;
    } catch (e) {
      console.error('[StorageService] Failed to claim achievement XP', e);
      return DEFAULT_GAMIFICATION;
    }
  },

  async claimAllAchievementsXP(achievements: { id: string; xp: number }[]): Promise<GamificationData> {
    try {
      const current = await this.getGamificationData();
      if (!Array.isArray(achievements) || achievements.length === 0) {
        return current;
      }
      const claimed = new Set(current.claimedAchievements || []);
      const unlocked = new Set(current.unlockedAchievements || []);
      let addedXP = 0;

      for (const ach of achievements) {
        if (ach && ach.id && typeof ach.id === 'string' && !claimed.has(ach.id)) {
          claimed.add(ach.id);
          unlocked.add(ach.id);
          const safeXP = Math.max(0, Number.isFinite(ach.xp) ? ach.xp : 0);
          addedXP += safeXP;
        }
      }

      if (addedXP === 0) {
        return current;
      }

      const newXP = current.xp + addedXP;
      const GamificationServiceModule = require('./GamificationService');
      const GamificationService = GamificationServiceModule.GamificationService;
      const newLevel = Math.max(current.level, GamificationService.calculateLevelFromXP(newXP));

      const updated: GamificationData = {
        ...current,
        xp: newXP,
        level: newLevel,
        unlockedAchievements: Array.from(unlocked),
        claimedAchievements: Array.from(claimed),
      };

      await this.saveGamificationData(updated);
      return updated;
    } catch (e) {
      console.error('[StorageService] Failed to claim all achievements XP', e);
      return DEFAULT_GAMIFICATION;
    }
  },


  async saveSecureSecret(key: string, value: string): Promise<boolean> {
    if (!key) return false;
    try {
      if (!value || value.trim() === '') {
        await this.deleteSecureSecret(key);
        return true;
      }
      const trimmed = value.trim();
      inMemorySecureVault[key] = trimmed;

      if (secureStoreModule && typeof secureStoreModule.setItemAsync === 'function') {
        try {
          await secureStoreModule.setItemAsync(key, trimmed, {
            keychainAccessible: secureStoreModule.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
        } catch (nativeErr: unknown) {
          console.warn('[StorageService] Native SecureStore setItem failed, falling back to secure vault', nativeErr);
        }
      }

      // Always maintain persistent obfuscated fallback in AsyncStorage for Expo Go / mock / reboot recovery
      try {
        const obfuscated = encodeBase64(trimmed);
        await AsyncStorage.setItem(`${SECURE_VAULT_PREFIX}${key}`, obfuscated);
      } catch (vaultErr: unknown) {
        console.warn('[StorageService] Failed to persist secure secret fallback to AsyncStorage', vaultErr);
      }

      return true;
    } catch (e: unknown) {
      console.error('[StorageService] Error saving secure secret', e);
      return false;
    }
  },

  async getSecureSecret(key: string): Promise<string | null> {
    if (!key) return null;

    // 1. Try native SecureStore if available
    try {
      if (secureStoreModule && typeof secureStoreModule.getItemAsync === 'function') {
        const val = await secureStoreModule.getItemAsync(key);
        if (typeof val === 'string' && val.length > 0) {
          inMemorySecureVault[key] = val;
          return val;
        }
      }
    } catch (e: unknown) {
      // Native SecureStore failed or not supported, fallback below
    }

    // 2. Check in-memory L1 cache
    if (typeof inMemorySecureVault[key] === 'string' && inMemorySecureVault[key].length > 0) {
      return inMemorySecureVault[key];
    }

    // 3. Fallback to obfuscated persistent vault in AsyncStorage
    try {
      const stored = await AsyncStorage.getItem(`${SECURE_VAULT_PREFIX}${key}`);
      if (typeof stored === 'string' && stored.length > 0) {
        const decoded = decodeBase64(stored);
        if (decoded && decoded.trim().length > 0) {
          inMemorySecureVault[key] = decoded.trim();
          return decoded.trim();
        }
      }
    } catch (vaultErr: unknown) {
      console.warn('[StorageService] Failed to read secure secret fallback from AsyncStorage', vaultErr);
    }

    return null;
  },

  async deleteSecureSecret(key: string): Promise<boolean> {
    if (!key) return false;
    delete inMemorySecureVault[key];
    let nativeSuccess = true;
    try {
      if (secureStoreModule && typeof secureStoreModule.deleteItemAsync === 'function') {
        await secureStoreModule.deleteItemAsync(key);
      }
    } catch (e: unknown) {
      nativeSuccess = false;
    }

    try {
      await AsyncStorage.removeItem(`${SECURE_VAULT_PREFIX}${key}`);
    } catch (vaultErr: unknown) {
      // Ignored safely
    }

    return nativeSuccess;
  },

  async getAIConfig(): Promise<AIConfig> {
    let secureApiKey: string | null = null;
    try {
      secureApiKey = await this.getSecureSecret(SECURE_AI_API_KEY);
    } catch {
      secureApiKey = null;
    }

    try {
      const jsonValue = await AsyncStorage.getItem(AI_CONFIG_KEY);
      const parsed = safeParseObject<Partial<AIConfig>>(jsonValue, {});
      const legacyApiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : '';

      // Backward compatibility migration: migrate plaintext key from AsyncStorage to SecureStore
      if (!secureApiKey && legacyApiKey && legacyApiKey.trim().length > 0) {
        await this.saveSecureSecret(SECURE_AI_API_KEY, legacyApiKey.trim());
        secureApiKey = legacyApiKey.trim();
        const sanitized = { ...parsed, apiKey: '' };
        await AsyncStorage.setItem(AI_CONFIG_KEY, JSON.stringify(sanitized)).catch(() => {});
      }

      let resolvedModel = parsed.model || 'gemini-3.6-flash';
      if (typeof resolvedModel === 'string' && (resolvedModel.includes('1.5') || resolvedModel.includes('2.5') || resolvedModel === 'gemini-flash')) {
        resolvedModel = 'gemini-3.6-flash';
      }

      return {
        provider: parsed.provider === 'openai' ? 'openai' : 'gemini',
        mode: parsed.mode || 'local_edge',
        apiKey: secureApiKey || '',
        model: resolvedModel,
        enableFallbackToCloud: parsed.enableFallbackToCloud !== false,
        localModelPath: parsed.localModelPath
      };
    } catch (e: unknown) {
      console.warn('[StorageService] Failed to fetch AI config from storage', e);
      return {
        provider: 'gemini',
        mode: 'local_edge',
        apiKey: secureApiKey || '',
        model: 'gemini-3.6-flash',
        enableFallbackToCloud: true
      };
    }
  },

  async saveAIConfig(config: AIConfig): Promise<boolean> {
    try {
      if (config.apiKey && config.apiKey.trim().length > 0) {
        await this.saveSecureSecret(SECURE_AI_API_KEY, config.apiKey.trim());
      } else {
        await this.deleteSecureSecret(SECURE_AI_API_KEY);
      }

      // Persist config without sensitive plaintext in unencrypted AsyncStorage
      const sanitizedConfig: AIConfig = {
        ...config,
        apiKey: ''
      };
      const jsonValue = JSON.stringify(sanitizedConfig);
      return await safeSetItem(AI_CONFIG_KEY, jsonValue);
    } catch (e: unknown) {
      console.error('[StorageService] Failed to save AI config to storage', e);
      notifyStorageError({ key: AI_CONFIG_KEY, error: e, isQuota: false });
      return false;
    }
  },

  async getGoogleClientId(): Promise<string> {
    try {
      const val = await AsyncStorage.getItem(GOOGLE_CLIENT_ID_KEY);
      return val ? val.trim() : '';
    } catch (e) {
      console.warn('[StorageService] Error getting Google Client ID:', e);
      return '';
    }
  },

  async saveGoogleClientId(clientId: string): Promise<boolean> {
    try {
      const sanitized = clientId ? clientId.trim() : '';
      if (sanitized) {
        return await safeSetItem(GOOGLE_CLIENT_ID_KEY, sanitized);
      } else {
        await AsyncStorage.removeItem(GOOGLE_CLIENT_ID_KEY);
        return true;
      }
    } catch (e) {
      console.error('[StorageService] Failed to save Google Client ID to storage', e);
      notifyStorageError({ key: GOOGLE_CLIENT_ID_KEY, error: e, isQuota: false });
      return false;
    }
  },

  /**
   * Export all user application data into a single structured JSON object
   */
  async exportBackup(): Promise<BackupData> {
    const [events, subjects, attendances, tasks, studySessions, semesters, settings, aaccActivities, groupProjects, gamification, streak] = await Promise.all([
      this.getEvents(),
      this.getSubjects(),
      this.getAttendances(),
      this.getTasks(),
      this.getStudySessions(),
      this.getSemesters(),
      this.getSettings(),
      this.getAACCActivities(),
      this.getGroupProjects(),
      this.getGamificationData(),
      this.getStreak(),
    ]);

    const rawBackup: BackupData = {
      version: 2,
      timestamp: new Date().toISOString(),
      events,
      subjects,
      attendances,
      tasks,
      studySessions,
      semesters,
      settings,
      streak,
      aaccActivities,
      groupProjects,
      gamification,
    };

    // Deep sanitize backup to guarantee zero credential leakage (API keys, tokens, secrets)
    const scrubCredentialsDeep = (obj: unknown): unknown => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(scrubCredentialsDeep);
      const clean: Record<string, unknown> = {};
      const record = obj as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('apikey') ||
          lowerKey.includes('api_key') ||
          lowerKey.includes('token') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('password')
        ) {
          continue; // omit secret from backup
        }
        clean[key] = scrubCredentialsDeep(value);
      }
      return clean;
    };

    const scrubbed = scrubCredentialsDeep(rawBackup);
    const validation = validateBackupSchema(scrubbed);
    if (!validation.isValid || !validation.data) {
      throw new Error(`Falha na validação do schema do backup gerado: ${validation.errors.join('; ')}`);
    }

    return validation.data;
  },

  /**
   * Import and restore data from a valid BackupData object.
   * Performs strict runtime schema validation before executing any storage write.
   */
  async importBackup(backup: unknown): Promise<boolean> {
    const validation = validateBackupSchema(backup);
    if (!validation.isValid || !validation.data) {
      const errorMsg = `Formato de backup inválido: ${validation.errors.join('; ')}`;
      console.error(`[StorageService] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    const validData = validation.data;

    try {
      const writeResults: boolean[] = [];

      if (Array.isArray(validData.events)) {
        writeResults.push(await this.saveEvents(validData.events));
      }
      if (Array.isArray(validData.subjects)) {
        writeResults.push(await this.saveSubjects(validData.subjects));
      }
      if (Array.isArray(validData.attendances)) {
        writeResults.push(await this.saveAttendances(validData.attendances));
      }
      if (Array.isArray(validData.tasks)) {
        writeResults.push(await this.saveTasks(validData.tasks));
      }
      if (Array.isArray(validData.studySessions)) {
        writeResults.push(await this.saveStudySessions(validData.studySessions));
      }
      if (Array.isArray(validData.semesters)) {
        writeResults.push(await this.saveSemesters(validData.semesters));
      }
      if (Array.isArray(validData.aaccActivities)) {
        writeResults.push(await this.saveAACCActivities(validData.aaccActivities));
      }
      if (Array.isArray(validData.groupProjects)) {
        writeResults.push(await this.saveGroupProjects(validData.groupProjects));
      }
      if (validData.gamification) {
        writeResults.push(await this.saveGamificationData(validData.gamification));
      }
      if (validData.streak) {
        writeResults.push(await this.saveStreak(validData.streak));
      }
      if (validData.settings) {
        writeResults.push(await this.saveSettings({ ...DEFAULT_SETTINGS, ...validData.settings }));
        if (validData.settings.theme) {
          writeResults.push(await this.saveTheme(validData.settings.theme));
        }
      }

      const allSuccess = writeResults.every(r => r === true);
      if (!allSuccess) {
        console.warn('[StorageService] Alguns blocos do backup falharam ao serem persistidos devido a restrição de armazenamento.');
      }

      return true;
    } catch (err: unknown) {
      console.error('[StorageService] Erro ao restaurar backup', err);
      throw err;
    }
  },

  /**
   * Clear all application data
   */
  async clearAllData(): Promise<void> {
    await this.deleteSecureSecret(SECURE_AI_API_KEY);
    Object.keys(inMemorySecureVault).forEach(k => delete inMemorySecureVault[k]);
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const vaultKeys = allKeys.filter(k => k.startsWith(SECURE_VAULT_PREFIX));
      if (vaultKeys.length > 0) {
        await AsyncStorage.multiRemove(vaultKeys);
      }
    } catch {
      // Ignored safely
    }
    await AsyncStorage.multiRemove([
      EVENTS_KEY,
      THEME_KEY,
      SUBJECTS_KEY,
      ATTENDANCES_KEY,
      TASKS_KEY,
      STUDY_SESSIONS_KEY,
      SEMESTERS_KEY,
      SETTINGS_KEY,
      STREAK_KEY,
      TEAMS_CONFIG_KEY,
      AACC_KEY,
      GROUP_PROJECTS_KEY,
      GAMIFICATION_KEY,
      AI_CONFIG_KEY,
      ACTIVE_TIMER_KEY,
      GOOGLE_CLIENT_ID_KEY,
      '@organiza_local_ai_model_info',
    ]);
  }
};
