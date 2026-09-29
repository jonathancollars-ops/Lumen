/**
 * firebase_backup_service.test.ts — Lumen v3.7.0
 *
 * Unit tests for FirebaseBackupService: upload, download, error handling,
 * and Last-Write-Wins merge strategy.
 */

import './setup_env';
import assert from 'node:assert/strict';

// ─── Setup Mock Firestore via require.cache ───────────────────────────────────

let capturedSetDoc: { ref: any; data: any }[] = [];
let mockGetDocResult: any = {
  exists: () => true,
  data: () => ({
    tasks:         [{ id: 't1', title: 'Tarefa mock', isCompleted: false }],
    events:        [],
    studySessions: [],
    subjects:      [],
    attendances:   [],
    semesters:     [],
    gamification:  null,
    streak:        { currentStreak: 0, longestStreak: 0, lastStudyDate: '' },
    settings:      {},
    aiConfig:      null,
    updatedAt:     '2026-09-28T22:00:00Z',
    appVersion:    '3.7.0',
    devicePlatform: 'android',
  }),
};
let mockSetDocError: Error | null = null;
let mockGetDocError: Error | null = null;

const firestoreId = require.resolve('firebase/firestore');
require.cache[firestoreId] = {
  id: firestoreId,
  filename: firestoreId,
  loaded: true,
  exports: {
    doc: (db: any, ...pathSegments: string[]) => ({
      path: pathSegments.join('/'),
      id: pathSegments[pathSegments.length - 1],
    }),
    setDoc: async (ref: any, data: any) => {
      if (mockSetDocError) throw mockSetDocError;
      capturedSetDoc.push({ ref, data });
    },
    getDoc: async (ref: any) => {
      if (mockGetDocError) throw mockGetDocError;
      return mockGetDocResult;
    },
    getFirestore: () => ({}),
  }
} as any;

// ─── Import subject after mock injection ──────────────────────────────────────

import { FirebaseBackupService, LumenBackupData } from '../src/services/FirebaseBackupService';

// ─── Test Harness ─────────────────────────────────────────────────────────────

let total = 0;
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ [FAIL] ${name}\n     ${err.message}`);
  }
}

async function runTestSuite() {
  const mockDeps = {
    db: { app: { name: 'test-app' } },
    doc: (_db: any, ...pathSegments: string[]) => ({
      path: pathSegments.join('/'),
      id: pathSegments[pathSegments.length - 1],
    }),
    setDoc: async (ref: any, data: any) => {
      if (mockSetDocError) throw mockSetDocError;
      capturedSetDoc.push({ ref, data });
    },
    getDoc: async (_ref: any) => {
      if (mockGetDocError) throw mockGetDocError;
      return mockGetDocResult;
    },
  };

  const svc = new FirebaseBackupService('user_abc_123', mockDeps);


  const basePayload = {
    tasks:         [{ id: '1', title: 'Tarefa', isCompleted: false }],
    events:        [],
    studySessions: [],
    subjects:      [],
    attendances:   [],
    semesters:     [],
    gamification:  null,
    streak:        { currentStreak: 3, longestStreak: 5, lastStudyDate: '2026-09-28' } as any,
    settings:      {} as any,
    aiConfig:      {} as any,
    appVersion:    '3.7.0',
    devicePlatform: 'android' as const,
  };

  await test('T1: uploadBackup salva na rota do Firestore correta (users/{uid}/backup/latest)', async () => {
    capturedSetDoc = [];
    mockSetDocError = null;
    await svc.uploadBackup(basePayload);
    assert.equal(capturedSetDoc.length, 1);
    assert.equal(capturedSetDoc[0].ref.path, 'users/user_abc_123/backup/latest');
  });

  await test('T2: uploadBackup anexa carimbo de data/hora updatedAt em formato ISO 8601', async () => {
    capturedSetDoc = [];
    mockSetDocError = null;
    await svc.uploadBackup(basePayload);
    const data = capturedSetDoc[0].data;
    assert.equal(typeof data.updatedAt, 'string');
    const parsed = new Date(data.updatedAt).getTime();
    assert.equal(isNaN(parsed), false);
  });

  await test('T3: uploadBackup preserva todos os campos de dados e a versão do app', async () => {
    capturedSetDoc = [];
    mockSetDocError = null;
    await svc.uploadBackup(basePayload);
    const data = capturedSetDoc[0].data;
    assert.equal(data.appVersion, '3.7.0');
    assert.equal(data.tasks.length, 1);
    assert.equal(data.tasks[0].title, 'Tarefa');
  });

  await test('T4: uploadBackup lança exceção em falha do Firestore para que a UI avise o usuário', async () => {
    capturedSetDoc = [];
    mockSetDocError = new Error('Permission Denied (Firebase Security Rules)');
    await assert.rejects(
      async () => { await svc.uploadBackup(basePayload); },
      /Permission Denied/
    );
    mockSetDocError = null;
  });

  await test('T5: downloadBackup retorna dados tipados quando documento existe', async () => {
    mockGetDocError = null;
    mockGetDocResult = {
      exists: () => true,
      data: () => ({
        ...basePayload,
        updatedAt: '2026-09-28T23:30:00Z',
      }),
    };
    const result = await svc.downloadBackup();
    assert.notEqual(result, null);
    assert.equal(result?.updatedAt, '2026-09-28T23:30:00Z');
    assert.equal(result?.appVersion, '3.7.0');
  });

  await test('T6: downloadBackup retorna null quando documento não existe no Firestore', async () => {
    mockGetDocError = null;
    mockGetDocResult = {
      exists: () => false,
      data: () => null,
    };
    const result = await svc.downloadBackup();
    assert.equal(result, null);
  });

  await test('T7: downloadBackup captura erros de rede e retorna null sem quebrar o app', async () => {
    mockGetDocError = new Error('Unavailable / Offline');
    const result = await svc.downloadBackup();
    assert.equal(result, null);
    mockGetDocError = null;
  });

  await test('T8: mergeWithLocal — remoto mais recente substitui dados locais (Last-Write-Wins)', () => {
    const remote: LumenBackupData = {
      ...basePayload,
      updatedAt: '2026-09-28T23:00:00Z',
      tasks: [{ id: 'remote_task', title: 'Remoto Venceu', isCompleted: false }],
    };
    const local: Partial<LumenBackupData> = {
      updatedAt: '2026-09-28T21:00:00Z',
      tasks: [{ id: 'local_task', title: 'Local Antigo', isCompleted: false }],
    };
    const merged = svc.mergeWithLocal(remote, local);
    assert.equal(merged.tasks[0].id, 'remote_task');
  });

  await test('T9: mergeWithLocal — local mais recente preserva alterações locais', () => {
    const remote: LumenBackupData = {
      ...basePayload,
      updatedAt: '2026-09-28T20:00:00Z',
      tasks: [{ id: 'remote_task', title: 'Remoto Antigo', isCompleted: false }],
    };
    const local: Partial<LumenBackupData> = {
      updatedAt: '2026-09-28T22:00:00Z',
      tasks: [{ id: 'local_task', title: 'Local Mais Novo', isCompleted: false }],
    };
    const merged = svc.mergeWithLocal(remote, local);
    assert.equal(merged.tasks[0].id, 'local_task');
  });

  await test('T10: mergeWithLocal — local sem updatedAt assume backup remoto', () => {
    const remote: LumenBackupData = {
      ...basePayload,
      updatedAt: '2026-09-28T23:00:00Z',
      tasks: [{ id: 'remote_fallback', title: 'Remoto Fallback', isCompleted: false }],
    };
    const local: Partial<LumenBackupData> = {
      tasks: [{ id: 'local_no_timestamp', title: 'Sem timestamp', isCompleted: false }],
    };
    const merged = svc.mergeWithLocal(remote, local);
    assert.equal(merged.tasks[0].id, 'remote_fallback');
  });

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passed}/${total} Tests Passed (${failed} Failed)`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
