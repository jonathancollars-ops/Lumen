import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateBackupSchema } from './storage';
import { withStorageWrite } from './StorageChanges';
import { cleanSyncData, mergeSyncBackups, sameData, syncContent, SyncBackup } from './SyncBackupModel';

export const SYNC_STORAGE_KEYS = {
  events: '@organiza_events', subjects: '@organiza_subjects',
  attendances: '@organiza_attendances', tasks: '@organiza_tasks',
  studySessions: '@organiza_studysessions', semesters: '@organiza_semesters',
  aaccActivities: '@organiza_aacc', groupProjects: '@organiza_group_projects',
  settings: '@organiza_settings', streak: '@organiza_streak', gamification: '@organiza_gamification',
  courseProgress: '@lumen_course_progress',
} as const;
const baselineKey = (uid: string) => `@lumen_sync_base_${uid}`;

async function readLocal(): Promise<SyncBackup> {
  // Strict reads: a disk/read/JSON error must never be uploaded as an empty list.
  const entries = await AsyncStorage.multiGet(Object.values(SYNC_STORAGE_KEYS));
  const stored = new Map(entries);
  const raw: any = { version: 2, timestamp: new Date().toISOString() };
  for (const [field, key] of Object.entries(SYNC_STORAGE_KEYS)) {
    const value = stored.get(key);
    if (value != null) raw[field] = JSON.parse(value);
  }
  const validated = validateBackupSchema(raw);
  if (!validated.isValid || !validated.data) throw new Error('Dados locais inválidos; sincronização interrompida para preservar a rotina.');
  return cleanSyncData(validated.data);
}

export const CloudSyncStorage = {
  async read(uid: string): Promise<{ local: SyncBackup; base: SyncBackup | null }> {
    return withStorageWrite(async () => {
      const encoded = await AsyncStorage.getItem(baselineKey(uid));
      return { local: await readLocal(), base: encoded ? JSON.parse(encoded) : null };
    });
  },
  async apply(uid: string, captured: SyncBackup, remote: SyncBackup): Promise<{ pending: boolean; changed: boolean }> {
    return withStorageWrite(async () => {
      // Re-read inside the write queue to retain edits saved during the upload.
      const current = await readLocal();
      const merged = mergeSyncBackups(captured, current, remote);
      const validated = validateBackupSchema(merged);
      if (!validated.isValid || !validated.data) throw new Error('Backup da nuvem inválido. Os dados locais foram preservados.');
      const data = cleanSyncData(validated.data);
      const writes: [string, string][] = [];
      for (const [field, key] of Object.entries(SYNC_STORAGE_KEYS)) {
        const value = (data as any)[field];
        if (value !== undefined && !sameData(value, (current as any)[field])) writes.push([key, JSON.stringify(value)]);
      }
      if (data.settings?.theme && data.settings.theme !== current.settings?.theme) writes.push(['@organiza_theme', data.settings.theme]);
      const changed = writes.length > 0;
      writes.push([baselineKey(uid), JSON.stringify(remote)]);
      await AsyncStorage.multiSet(writes);
      return { pending: !sameData(syncContent({ ...data, deletedRecords: merged.deletedRecords }), syncContent(remote)), changed };
    });
  },
};
