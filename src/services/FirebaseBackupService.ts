/**
 * FirebaseBackupService — Lumen v3.7.0
 *
 * Replaces GoogleDriveSyncService. Stores a single "latest" snapshot document
 * per user in Firestore (users/{uid}/backup/latest). Strategy: Last-Write-Wins
 * by ISO updatedAt timestamp.
 */

import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

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
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class FirebaseBackupService {
  private readonly userId: string;
  private readonly deps: {
    db: any;
    doc: (firestore: any, ...pathSegments: string[]) => any;
    setDoc: (documentRef: any, data: any) => Promise<void>;
    getDoc: (documentRef: any) => Promise<any>;
  };

  constructor(userId: string, deps?: FirestoreDeps) {
    this.userId = userId;
    this.deps = {
      db: deps?.db ?? db,
      doc: deps?.doc ?? doc,
      setDoc: deps?.setDoc ?? setDoc,
      getDoc: deps?.getDoc ?? getDoc,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Firestore document reference for this user's backup. */
  private backupRef() {
    return this.deps.doc(this.deps.db, 'users', this.userId, 'backup', 'latest');
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Upload a full data snapshot to Firestore (overwrites previous backup).
   * Throws on network/permission errors so callers can show an alert.
   */
  async uploadBackup(data: LumenBackupUpload): Promise<void> {
    const payload: LumenBackupData = {
      ...data,
      updatedAt: new Date().toISOString(),
    };
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
