/**
 * Firestore transport for the per-user routine. synchronize() merges changes
 * transactionally against a persisted device baseline; subscribe() wakes the
 * sync engine when another device saves. Legacy backup helpers remain available.
 */

import { doc, setDoc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db } from '../config/firebase';
import { validateBackupSchema } from './storage';
import { cleanSyncData, mergeSyncBackups, sameData, syncContent, SyncBackup } from './SyncBackupModel';
import { APP_VERSION } from '../utils/version';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LumenBackupData {
  tasks:           any[];
  events:          any[];
  studySessions:   any[];
  subjects:        any[];
  attendances:     any[];
  semesters:       any[];
  gamification:    Record<string, any> | null;
  streak:          Record<string, any> | null;
  settings:        Record<string, any>;
  aiConfig:        Record<string, any> | null;
  updatedAt:       string;   // ISO 8601
  appVersion:      string;
  devicePlatform:  'android' | 'windows' | 'web';
}

export type LumenBackupUpload = Omit<LumenBackupData, 'updatedAt'>;

export interface FirestoreDeps {
  db?: any;
  doc?: (firestore: any, ...pathSegments: string[]) => any;
  setDoc?: (documentRef: any, data: any) => Promise<void>;
  getDoc?: (documentRef: any) => Promise<any>;
  onSnapshot?: typeof onSnapshot;
  runTransaction?: typeof runTransaction;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class FirebaseBackupService {
  private readonly userId: string;
  private readonly deps: {
    db: any;
    doc: (firestore: any, ...pathSegments: string[]) => any;
    setDoc: (documentRef: any, data: any) => Promise<void>;
    getDoc: (documentRef: any) => Promise<any>;
    onSnapshot: typeof onSnapshot;
    runTransaction: typeof runTransaction;
  };

  constructor(userId: string, deps?: FirestoreDeps) {
    this.userId = userId;
    this.deps = {
      db: deps?.db ?? db,
      doc: deps?.doc ?? doc,
      setDoc: deps?.setDoc ?? setDoc,
      getDoc: deps?.getDoc ?? getDoc,
      onSnapshot: deps?.onSnapshot ?? onSnapshot,
      runTransaction: deps?.runTransaction ?? runTransaction,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Firestore document reference for this user's backup. */
  private backupRef() {
    return this.deps.doc(this.deps.db, 'users', this.userId, 'backup', 'latest');
  }

  private normalize(raw: any): SyncBackup {
    if (!raw || !['events', 'subjects', 'attendances', 'tasks', 'studySessions', 'semesters'].every(key => Array.isArray(raw[key]))) {
      throw new Error('O backup do Firebase está incompleto. A rotina local foi preservada.');
    }
    const candidate = cleanSyncData({ ...raw, version: raw.version ?? 2, timestamp: raw.timestamp ?? raw.updatedAt ?? new Date().toISOString() });
    const validation = validateBackupSchema(candidate);
    if (!validation.isValid || !validation.data) throw new Error('O backup do Firebase tem dados inválidos. A rotina local foi preservada.');
    return cleanSyncData({ ...validation.data, deletedRecords: candidate.deletedRecords ?? {}, updatedAt: candidate.updatedAt });
  }

  /** Notifications only wake the serialized sync loop. Cached snapshots never
   * replace local data; the transaction reads the current server document. */
  subscribe(onChange: () => void, onError: (error: Error) => void): () => void {
    return this.deps.onSnapshot(this.backupRef(), () => onChange(), onError);
  }

  async synchronize(base: SyncBackup | null, local: SyncBackup, platform: string): Promise<SyncBackup> {
    return this.deps.runTransaction(this.deps.db, async transaction => {
      const snapshot = await transaction.get(this.backupRef());
      const remote = snapshot.exists() ? this.normalize(snapshot.data()) : null;
      const merged = mergeSyncBackups(base, local, remote);
      if (!sameData(syncContent(merged), syncContent(remote))) {
        const now = new Date().toISOString();
        const payload = cleanSyncData({ ...merged, version: 2, timestamp: now, updatedAt: now, appVersion: APP_VERSION, devicePlatform: platform });
        transaction.set(this.backupRef(), payload);
        return payload;
      }
      return remote!;
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Upload a full data snapshot to Firestore (overwrites previous backup).
   * Throws on network/permission errors so callers can show an alert.
   */
  async uploadBackup(data: LumenBackupUpload): Promise<void> {
    const payload = cleanSyncData({
      ...data,
      version: 2,
      timestamp: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await this.deps.setDoc(this.backupRef(), payload);
    console.log('[FirebaseBackup] Upload concluído:', payload.updatedAt);
  }

  /**
   * Download the latest backup snapshot from Firestore.
   * Returns null if no backup exists or on any network error.
   */
  async downloadBackup(): Promise<LumenBackupData | null> {
    try {
      const snapshot = await this.deps.getDoc(this.backupRef());
      if (!snapshot.exists()) {
        console.log('[FirebaseBackup] Nenhum backup encontrado no Firestore');
        return null;
      }
      return snapshot.data() as LumenBackupData;
    } catch (error) {
      console.error('[FirebaseBackup] Erro ao baixar backup:', error);
      return null;
    }
  }

  /**
   * Merge remote backup with local data.
   * Uses Last-Write-Wins: whichever has the newer `updatedAt` wins.
   * When local wins, the remote fields are used as the base and local fields
   * overwrite them (so any fields missing locally keep the remote value).
   */
  mergeWithLocal(
    remote: LumenBackupData,
    local: Partial<LumenBackupData>,
  ): LumenBackupData {
    const remoteTs = new Date(remote.updatedAt).getTime();
    const localTs  = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;

    if (remoteTs > localTs) {
      console.log('[FirebaseBackup] Dados remotos são mais recentes — usando remoto');
      return remote;
    }

    console.log('[FirebaseBackup] Dados locais são mais recentes — mesclando com prioridade local');
    return { ...remote, ...local } as LumenBackupData;
  }
}
