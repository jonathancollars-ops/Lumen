import type { BackupData } from '../types';

export const SYNC_COLLECTIONS = [
  'events', 'subjects', 'attendances', 'tasks', 'studySessions',
  'semesters', 'aaccActivities', 'groupProjects',
] as const;
type Collection = typeof SYNC_COLLECTIONS[number];

export type SyncBackup = BackupData & {
  deletedRecords?: Partial<Record<Collection, string[]>>;
  updatedAt?: string;
  appVersion?: string;
  devicePlatform?: string;
};

export function sameData(a: unknown, b: unknown): boolean {
  const ordered = (value: any): any => {
    if (Array.isArray(value)) return value.map(ordered);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, ordered(value[key])]));
  };
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}

// Firestore rejects undefined values; credentials and AI configuration stay on
// their original device, even when migrating an older cloud backup.
export function cleanSyncData(value: unknown): any {
  if (Array.isArray(value)) return value.map(item => cleanSyncData(item) ?? null);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || /apikey|api_key|token|secret|password|^aiConfig$/i.test(key)) continue;
    result[key] = cleanSyncData(item);
  }
  return result;
}

// Three-way field merge: only fields actually edited locally override remote
// fields. Unrelated edits on two devices therefore survive a transaction retry.
function mergeFields(base: any, local: any, remote: any): any {
  if (sameData(base, local)) return remote;
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const identity = (item: any) => item?.id ?? item?.semesterNumber;
    if ([...base, ...local, ...remote].every(item => identity(item) !== undefined)) {
      const before = new Map(base.map(item => [identity(item), item]));
      const here = new Map(local.map(item => [identity(item), item]));
      const there = new Map(remote.map(item => [identity(item), item]));
      for (const [id, previous] of before) {
        if (!here.has(id)) there.delete(id);
        else if (!sameData(previous, here.get(id))) there.set(id, mergeFields(previous, here.get(id), there.get(id)));
      }
      for (const [id, item] of here) if (!before.has(id)) there.set(id, item);
      return [...there.values()];
    }
  }
  if (!base || !local || !remote || typeof local !== 'object' ||
      Array.isArray(local) || Array.isArray(remote)) return local;
  const result = { ...remote };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (!sameData(base[key], local[key])) {
      if (local[key] === undefined) delete result[key];
      else result[key] = mergeFields(base[key], local[key], remote[key]);
    }
  }
  return result;
}

export function mergeSyncBackups(base: SyncBackup | null, local: SyncBackup, remote: SyncBackup | null): SyncBackup {
  if (!remote) return cleanSyncData(local);
  const result: any = { ...remote, version: 2, timestamp: new Date().toISOString() };
  result.deletedRecords = { ...remote.deletedRecords };
  for (const key of SYNC_COLLECTIONS) {
    const before = new Map<string, any>((base?.[key] ?? []).map(item => [item.id, item]));
    const here = new Map<string, any>((local[key] ?? []).map(item => [item.id, item]));
    const there = new Map<string, any>((remote[key] ?? []).map(item => [item.id, item]));
    const deleted = new Set(remote.deletedRecords?.[key] ?? []);
    for (const [id, previous] of before) {
      if (!here.has(id)) { there.delete(id); deleted.add(id); }
      else if (!sameData(previous, here.get(id))) {
        there.set(id, mergeFields(previous, here.get(id), there.get(id)));
        deleted.delete(id);
      }
    }
    for (const [id, item] of here) {
      if (before.has(id)) continue;
      // Without a baseline, merge existing collections by ID, favoring remote
      // duplicates. Do not resurrect records deleted by another device.
      if (!deleted.has(id) || base) {
        if (base || !there.has(id)) there.set(id, item);
        deleted.delete(id);
      }
    }
    result[key] = [...there.values()];
    result.deletedRecords[key] = [...deleted].sort();
  }
  for (const key of ['settings', 'streak', 'gamification', 'courseProgress'] as const) {
    result[key] = base ? mergeFields(base[key], local[key], remote[key]) : (remote[key] ?? local[key]);
  }
  return cleanSyncData(result);
}

export function syncContent(backup: SyncBackup | null): unknown {
  if (!backup) return null;
  const { timestamp, updatedAt, appVersion, devicePlatform, ...content } = backup;
  return content;
}
