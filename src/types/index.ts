export type EventCategory = 'Saúde/Academia' | 'Faculdade/Aulas' | 'Provas/Trabalhos' | 'Lazer' | 'Outros';

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom_interval';

export interface GradeItem {
  id: string;
  name: string; // e.g., 'P1', 'Trabalho 1'
  weight: number; // e.g., 1
  grade?: number; // Resulting grade
  maxGrade: number; // e.g., 10
  eventId?: string; // Link to an AppEvent (exam)
  isFinalExam?: boolean; // Se for prova final, a regra de cálculo muda
}

export interface GradeGroup {
  id: string;
  name: string; // e.g., 'Média das Provas', 'Seminários'
  weight: number; // Weight of this group in the final grade
  items: GradeItem[];
}

export interface Semester {
  id: string;
  name: string; // e.g. "2026.1", "2026.2"
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  isCurrent?: boolean;
  isArchived?: boolean;
}

export interface Subject {
  id: string;
  name: string;
  code?: string;
  color?: string;
  passGrade?: number; // ex: 7.0
  maxAbsences?: number; // ex: 15 (Calculated from workload)
  workloadHours?: number; // ex: 60h
  gradeGroups?: GradeGroup[];
  isArchived?: boolean; // If true, events are hidden from the calendar
  semesterId?: string; // Link to a Semester
  notes?: string;
}

export interface AppEvent {
  id: string;
  title: string;
  description?: string;
  category: EventCategory;
  date: string; // ISO string for the specific date or start date
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  recurrence: RecurrenceType;
  recurrenceDays?: number[]; // 0 = Sunday, 1 = Monday, etc. Used for weekly.
  recurrenceInterval?: number; // ex: 1, 2, 3, 6 (a cada N meses ou semanas)
  recurrenceUnit?: 'days' | 'weeks' | 'months' | 'years'; // padrão: 'months'
  recurrenceMonthDay?: number; // dia do mês fixo (ex: dia 10, dia 15)
  alerts: number[]; // Array of minutes before the event to notify (e.g. [60, 1440])
  isCompleted: boolean; // For the habit tracking
  isImportant?: boolean; // Highlighted below the calendar
  isNotified?: boolean; // Default true, allows disabling notifications
  completedDates?: string[]; // Array of ISO date strings for recurring events check-ins
  subjectId?: string; // Link to a Subject if it's an exam or class
  location?: string; // Sala, prédio ou link da aula/evento
  
  // Grade Engine
  weight?: number; // Weight in the weighted average
  grade?: number; // Grade obtained (null/undefined if not taken yet)
  maxGrade?: number; // Maximum possible grade (default 10)
  isExtraPoint?: boolean; // If true, adds directly to final grade instead of average
}

export type AttendanceStatus = 'present' | 'absent' | 'pending' | 'cancelled';

export interface AttendanceRecord {
  id: string;
  subjectId: string;
  date: string; // YYYY-MM-DD
  eventId: string; // Link to the specific weekly class AppEvent
  status: AttendanceStatus;
}

export type ThemeType = 'dark' | 'light' | 'amoled';

export interface StudyTask {
  id: string;
  title: string;
  isCompleted: boolean;
  subjectId?: string; // Optional: linked to a specific subject
  dueDate?: string; // Optional: YYYY-MM-DD
  priority?: 'low' | 'medium' | 'high';
}

export interface StudySession {
  id: string;
  subjectId: string;
  durationMs: number; // Time studied in milliseconds
  date: string; // YYYY-MM-DD
  startTime?: string; // ISO date-time string
}

export interface StudyStreak {
  currentStreak: number;
  longestStreak: number;
  lastStudyDate: string; // YYYY-MM-DD
  bestStreak?: number;
  totalStudyDays?: number;
}

export interface AppSettings {
  theme: ThemeType;
  fullscreen?: boolean; // Default false (Barra de status visível)
  pomodoroFocusMin: number; // Default 25
  pomodoroBreakMin: number; // Default 5
  pomodoroLongBreakMin: number; // Default 15
  defaultPassGrade: number; // Default 7.0
  examWeekMode: boolean; // Default false
  soundEnabled: boolean; // Default true
  hapticsEnabled: boolean; // Default true
  currentSemesterId?: string;
}

export interface AACCActivity {
  id: string;
  title: string;
  category: 'Ensino' | 'Pesquisa' | 'Extensão' | 'Outros';
  hours: number;
  date: string; // YYYY-MM-DD
  institution?: string;
  notes?: string;
}

export interface GroupTask {
  id: string;
  title: string;
  assignedTo: string;
  status: 'todo' | 'doing' | 'done';
  dueDate?: string; // YYYY-MM-DD
}

export interface GroupProject {
  id: string;
  subjectId: string;
  title: string;
  deadline: string; // YYYY-MM-DD
  members: string[];
  tasks: GroupTask[];
  description?: string;
}

export interface GamificationData {
  xp: number;
  level: number;
  unlockedAchievements: string[];
  claimedAchievements?: string[]; // IDs de conquistas com XP resgatado
  totalFocusMinutes: number;
  processedEventIds?: string[]; // Para impedir XP Farming
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  xp: number;
  unlocked: boolean;
  progress?: { current: number; total: number };
}

export interface BackupData {
  version: number;
  timestamp: string;
  events: AppEvent[];
  subjects: Subject[];
  attendances: AttendanceRecord[];
  tasks: StudyTask[];
  studySessions: StudySession[];
  semesters: Semester[];
  settings?: Partial<AppSettings>;
  streak?: StudyStreak;
  aaccActivities?: AACCActivity[];
  groupProjects?: GroupProject[];
  gamification?: GamificationData;
}

// ==========================================
// Microsoft Teams & AI Integration Types
// ==========================================

export interface TeamsConfig {
  clientId: string;
  tenantId: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  selectedTeamId?: string;
  selectedChannelId?: string;
  isConnected: boolean;
  lastSync?: string;
}

export type AIProvider = 'gemini' | 'openai';

export type AIProviderMode = 'local_edge' | 'gemini_cloud' | 'heuristic_offline' | 'cloud';

export type LocalModelDownloadState = 'not_downloaded' | 'downloading' | 'paused' | 'downloaded' | 'error';

export interface LocalAIModelInfo {
  id: string;
  name: string;
  filename: string;
  description: string;
  sizeBytes: number;
  formattedSize: string;
  downloadUrl: string;
  downloadState: LocalModelDownloadState;
  downloadProgress: number; // 0.0 to 1.0
  downloadedBytes: number;
  localPath?: string;
  lastUpdated?: string;
  errorMessage?: string;
}

export interface AIConfig {
  provider: AIProvider;
  mode: AIProviderMode;
  apiKey: string;
  model?: string;
  localModelPath?: string;
  enableFallbackToCloud?: boolean;
}

export type AIIntent = 'cancelled_class' | 'homework' | 'exam' | 'none';

export interface AIParsedItem {
  intent: AIIntent;
  subjectName: string;
  title: string;
  description?: string;
  targetDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  alerts: number[]; // e.g. [10080, 1440]
  rawSummary: string;
  confidence?: number;
  isReschedule?: boolean;
}

export interface AIParsingResult {
  items: AIParsedItem[];
  confidence: number;
  rawResponse?: string;
  sourceMode?: AIProviderMode;
}

export interface UniversalAIInput {
  rawText: string;
  sourceType: 'whatsapp' | 'classroom' | 'sheets' | 'teams' | 'text' | 'image';
  sender?: string;
  subjectHint?: string;
}

export interface GradeFormulaExtraction {
  passGrade: number;
  description: string;
  groups: {
    name: string;
    weight: number;
    items: {
      name: string;
      weight: number;
      maxGrade: number;
    }[];
  }[];
  extraPoints?: {
    name: string;
    maxPoints: number;
  };
  finalExamRule?: string;
}

export interface SyncResult {
  cancelledAttendances: AttendanceRecord[];
  createdEvents: AppEvent[];
  updatedEvents: AppEvent[];
  logs: string[];
}

export interface TeamsMessageSender {
  displayName?: string;
  id?: string;
}

export interface TeamsMessageBody {
  content: string;
  contentType?: 'html' | 'text' | string;
}

export interface TeamsMessage {
  id: string;
  createdDateTime: string;
  subject?: string;
  body: TeamsMessageBody | string;
  from?: {
    user?: TeamsMessageSender;
  };
  senderName?: string;
  cleanText?: string;
  rawHtml?: string;
}

export interface GoogleSheetsConfig {
  spreadsheetUrl: string;
  isConnected: boolean;
  autoSyncEnabled: boolean;
  lastSync?: string;
  syncIntervalMinutes?: number;
}

// ─────────────────────────────────────────────────────────────
// Lumen 3.0: Course History, Weighted CR Tracker & Degree Progress
// ─────────────────────────────────────────────────────────────

export interface CourseHistorySubject {
  id: string;
  name: string;
  code?: string;
  credits: number; // e.g. 4 credits (80h)
  hours?: number; // e.g. 80
  grade?: number; // Optional grade
  isCompleted: boolean; // Simple clean checkmark (✅ Concluída)
  isPassing?: boolean;
}

export interface CourseSemester {
  semesterNumber: number; // 1, 2, 3, ..., 10
  title: string; // "1º Semestre"
  subjects: CourseHistorySubject[];
}

export interface CourseProgressData {
  courseName?: string;
  targetCR?: number; // e.g. 8.5
  baselineCR?: number; // CR calculated from past semesters
  officialCR?: number; // CR/IRA printed on the imported academic transcript
  totalRequiredCredits: number; // e.g. 240
  completedCredits: number; // e.g. 120
  totalRequiredHours?: number; // e.g. 3600
  completedHours?: number; // e.g. 1800
  semesters: CourseSemester[];
  lastUpdated?: string;
}

export type CourseData = CourseProgressData;

export interface ActiveTimerState {
  mode: 'pomodoro' | 'stopwatch';
  isRunning: boolean;
  startedAt: number;
  targetEndTime?: number;
  remainingSeconds: number;
  initialDuration: number;
  subjectId?: string;
  isBreak?: boolean;
}

export interface SavedTimerState {
  mode: 'pomodoro' | 'stopwatch';
  isRunning: boolean;
  accumulatedSeconds: number;
  lastSavedTimestamp: number;
  targetDuration?: number;
  remainingSeconds?: number;
  initialDuration?: number;
  subjectId?: string;
  isBreak?: boolean;
}

export interface CRSimulationScenario {
  title: string;
  projectedCR: number;
  difference: number;
  description: string;
  type: 'worst_case' | 'target' | 'best_case' | 'current' | 'realistic';
  badgeColor?: string;
}

// ─────────────────────────────────────────────────────────────
// Lumen 3.0: Offline Socratic Tutor & Model Manager
// ─────────────────────────────────────────────────────────────

export type TutorMode = 'socratic' | 'direct';
export type LocalModelTier = 'light' | 'medium' | 'deep';

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  suggestedSteps?: string[];
}

export interface ModelTierInfo {
  tier: LocalModelTier;
  name: string;
  filename: string;
  sizeBytes: number;
  formattedSize: string;
  downloadUrl: string;
  description: string;
  recommendedHardware: string;
  downloadState: LocalModelDownloadState;
  downloadProgress: number;
  downloadedBytes: number;
  localPath?: string;
  errorMessage?: string;
}

// ─────────────────────────────────────────────────────────────
// Lumen 3.1: In-App Auto-Updater & Semantic Versioning
// ─────────────────────────────────────────────────────────────

export type VersionBumpType = 'patch' | 'minor' | 'major';

export interface AppUpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName?: string;
  releaseNotes?: string;
  downloadUrl: string;
  publishedAt?: string;
  isMandatory?: boolean;
}

export interface AppUpdateState {
  lastCheckedAt?: number;
  ignoredVersion?: string;
  lastPromptDismissedAt?: number;
}

// ─────────────────────────────────────────────────────────────
// Lumen 3.5: Google Drive Cloud Sync & Security Hardening
// ─────────────────────────────────────────────────────────────

export interface GoogleDriveTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userEmail?: string;
  tokenType?: string;
  scope?: string;
}

export interface GoogleDriveSyncStatus {
  isConnected: boolean;
  userEmail?: string;
  lastSyncTime?: string;
  cloudFileExists?: boolean;
  cloudFileModifiedTime?: string;
}

export interface GoogleDriveSyncResult {
  success: boolean;
  message?: string;
  timestamp?: string;
  fileId?: string;
  action?: 'upload' | 'download' | 'none';
  details?: {
    eventsCount?: number;
    subjectsCount?: number;
    tasksCount?: number;
  };
}
