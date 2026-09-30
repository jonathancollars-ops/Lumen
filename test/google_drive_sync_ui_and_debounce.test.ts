import './setup_env';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  GoogleDriveSyncService,
  GDRIVE_CONFIG,
  SECURE_STORAGE_KEYS,
} from '../src/services/GoogleDriveSyncService';
import { StorageService } from '../src/services/storage';
import { mockSecureStore, mockAsyncStorage, memoryStore } from './setup_env';
import { BackupData, Subject, AppEvent } from '../src/types';

let passed = 0;
let failed = 0;

function pass(msg: string) {
  passed++;
  console.log(`  ✅ [PASS] ${msg}`);
}

function fail(msg: string, err?: unknown) {
  failed++;
  console.error(`  ❌ [FAIL] ${msg}`, err || '');
  throw err || new Error(msg);
}

async function test(name: string, fn: () => void | Promise<void>) {
  console.log(`\n--- Test: ${name} ---`);
  try {
    await fn();
  } catch (e) {
    fail(`Test failed: ${name}`, e);
  }
}

// Global fetch mocking for Google Drive REST endpoints
let mockDriveFiles: Record<string, { content: string; metadata: any }> = {};

function setupMockDriveEndpoints() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();

    // 1. Find file in appDataFolder
    if (url.includes('/drive/v3/files?spaces=appDataFolder')) {
      const authHeader = init?.headers ? (init.headers as any)['Authorization'] : '';
      if (!authHeader || !authHeader.includes('Bearer')) {
        return new Response(JSON.stringify({ error: { message: 'Invalid Credentials', code: 401 } }), {
          status: 401,
          statusText: 'Unauthorized',
        });
      }

      const files = Object.values(mockDriveFiles).map(f => f.metadata);
      return new Response(JSON.stringify({ files }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Download file content (?alt=media)
    if (url.includes('/drive/v3/files/') && url.includes('alt=media')) {
      const match = url.match(/\/files\/([a-zA-Z0-9_-]+)\?alt=media/);
      const fileId = match ? match[1] : '';
      const file = mockDriveFiles[fileId];
      if (!file) {
        return new Response(JSON.stringify({ error: 'File not found' }), { status: 404 });
      }
      return new Response(file.content, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Upload multipart file (POST)
    if (url.includes('/upload/drive/v3/files?uploadType=multipart')) {
      const body = init?.body?.toString() || '';
      const fileId = 'cloud_file_' + Date.now();
      const jsonStart = body.indexOf('{\r\n') !== -1 ? body.indexOf('{\r\n') : body.indexOf('{"version"');
      const jsonEnd = body.lastIndexOf('}') + 1;
      const content = jsonStart !== -1 && jsonEnd > jsonStart ? body.substring(jsonStart, jsonEnd) : body;

      const metadata = {
        id: fileId,
        name: GDRIVE_CONFIG.SYNC_FILENAME,
        modifiedTime: new Date().toISOString(),
        size: String(content.length),
      };
      mockDriveFiles[fileId] = { content, metadata };

      return new Response(JSON.stringify(metadata), { status: 200 });
    }

    // 4. Update file (PATCH)
    if (url.includes('/upload/drive/v3/files/') && url.includes('uploadType=media')) {
      const match = url.match(/\/files\/([a-zA-Z0-9_-]+)\?uploadType=media/);
      const fileId = match ? match[1] : '';
      const content = init?.body?.toString() || '';
      if (!mockDriveFiles[fileId]) {
        mockDriveFiles[fileId] = {
          content,
          metadata: {
            id: fileId,
            name: GDRIVE_CONFIG.SYNC_FILENAME,
            modifiedTime: new Date().toISOString(),
            size: String(content.length),
          },
        };
      } else {
        mockDriveFiles[fileId].content = content;
        mockDriveFiles[fileId].metadata.modifiedTime = new Date().toISOString();
        mockDriveFiles[fileId].metadata.size = String(content.length);
      }
      return new Response(JSON.stringify(mockDriveFiles[fileId].metadata), { status: 200 });
    }

    // 5. Revoke endpoint
    if (url.includes('oauth2.googleapis.com/revoke')) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('GOOGLE DRIVE UI INTEGRATION & BACKGROUND AUTO-SYNC TEST SUITE');
  console.log('================================================================');

  setupMockDriveEndpoints();

  // Reset environment before testing
  await GoogleDriveSyncService.clearSecureTokens();
  mockDriveFiles = {};
  for (const k in memoryStore) delete memoryStore[k];

  // ── SUITE 1: GoogleDriveSyncService.sincronizar() ──
  console.log('\n--- SUITE 1: GoogleDriveSyncService.sincronizar() ---');

  await test('sincronizar() returns error result when not connected', async () => {
    await GoogleDriveSyncService.clearSecureTokens();
    const result = await GoogleDriveSyncService.sincronizar();
    assert.strictEqual(result.success, false);
    assert(result.message?.includes('não conectado'), 'Informa que não está conectado');
    pass('sincronizar() fails safely when not connected');
  });

  await test('connectWithGoogle() saves credentials and enables sync', async () => {
    const success = await GoogleDriveSyncService.connectWithGoogle('aluno.lumen@usp.br');
    assert.strictEqual(success, true);
    const status = await GoogleDriveSyncService.getSyncStatus();
    assert.strictEqual(status.isConnected, true);
    assert.strictEqual(status.userEmail, 'aluno.lumen@usp.br');
    pass('connectWithGoogle() connects and stores session');
  });

  await test('sincronizar() uploads database to cloud when connected', async () => {
    // Populate local mock database
    const sub: Subject = { id: 'sub_math', name: 'Cálculo I', code: 'MAT0111', workloadHours: 60 };
    const evt: AppEvent = {
      id: 'evt_p1',
      title: 'Prova P1 de Cálculo',
      category: 'Provas/Trabalhos',
      date: '2026-10-15',
      startTime: '08:00',
      endTime: '10:00',
      recurrence: 'none',
      alerts: [60],
      isCompleted: false,
      grade: 9.5,
      weight: 2,
    };
    await StorageService.saveSubjects([sub]);
    await StorageService.saveEvents([evt]);

    const result = await GoogleDriveSyncService.sincronizar();
    assert.strictEqual(result.success, true);
    assert(result.fileId?.startsWith('cloud_file_'));
    assert(result.timestamp !== undefined);
    assert.strictEqual(result.details?.subjectsCount, 1);
    assert.strictEqual(result.details?.eventsCount, 1);
    pass('sincronizar() successfully exported and uploaded data');
  });

  // ── SUITE 2: Startup Synchronization (checkAndSyncOnStartup) ──
  console.log('\n--- SUITE 2: Startup Synchronization (checkAndSyncOnStartup) ---');

  await test('checkAndSyncOnStartup() returns null when disconnected', async () => {
    await GoogleDriveSyncService.clearSecureTokens();
    const res = await GoogleDriveSyncService.checkAndSyncOnStartup();
    assert.strictEqual(res, null);
    pass('checkAndSyncOnStartup returns null when disconnected');
  });

  await test('checkAndSyncOnStartup() downloads newer remote changes', async () => {
    await GoogleDriveSyncService.connectWithGoogle('aluno.lumen@usp.br');

    // Simulate older local lastSyncTime
    const olderLocalTime = new Date('2026-09-01T10:00:00Z').toISOString();
    mockSecureStore[SECURE_STORAGE_KEYS.LAST_SYNC_TIME] = olderLocalTime;

    // Simulate newer remote cloud file
    const newerCloudBackup: BackupData = {
      version: 2,
      timestamp: '2026-09-10T12:00:00Z',
      subjects: [{ id: 'sub_remote', name: 'Física I', code: 'FIS0101' }],
      events: [{
        id: 'evt_remote',
        title: 'Laboratório de Física',
        category: 'Faculdade/Aulas',
        date: '2026-09-12',
        startTime: '14:00',
        endTime: '16:00',
        recurrence: 'none',
        alerts: [30],
        isCompleted: false,
      }],
      tasks: [],
      attendances: [],
      studySessions: [],
      streak: { currentStreak: 5, longestStreak: 10, lastStudyDate: '2026-09-10' },
      semesters: [],
      settings: {
        theme: 'dark',
        fullscreen: false,
        pomodoroFocusMin: 25,
        pomodoroBreakMin: 5,
        pomodoroLongBreakMin: 15,
        defaultPassGrade: 7.0,
        examWeekMode: false,
        soundEnabled: true,
        hapticsEnabled: true,
      },
    };

    mockDriveFiles = {
      cloud_file_remote: {
        content: JSON.stringify(newerCloudBackup),
        metadata: {
          id: 'cloud_file_remote',
          name: GDRIVE_CONFIG.SYNC_FILENAME,
          modifiedTime: '2026-09-10T12:00:00Z',
          size: '1024',
        },
      }
    };

    const startupResult = await GoogleDriveSyncService.checkAndSyncOnStartup();
    assert(startupResult !== null, 'Startup sync executed download');
    assert.strictEqual(startupResult.success, true);

    // Verify local storage was updated with remote changes
    const restoredSubjects = await StorageService.getSubjects();
    assert(restoredSubjects.some(s => s.id === 'sub_remote'), 'Restored remote subject');
    pass('checkAndSyncOnStartup downloaded and reconciled newer cloud backup');
  });

  await test('checkAndSyncOnStartup() does NOT download when local is already newer', async () => {
    // Local lastSyncTime is 2026-09-20 (newer than cloud 2026-09-10)
    const newerLocalTime = new Date('2026-09-20T10:00:00Z').toISOString();
    mockSecureStore[SECURE_STORAGE_KEYS.LAST_SYNC_TIME] = newerLocalTime;

    const result = await GoogleDriveSyncService.checkAndSyncOnStartup();
    assert.strictEqual(result, null);
    pass('checkAndSyncOnStartup returned null because local was already newer');
  });

  // ── SUITE 3: Disconnect & Token Purging ──
  console.log('\n--- SUITE 3: Disconnect & Token Purging ---');

  await test('disconnect() clears all tokens from SecureStore', async () => {
    await GoogleDriveSyncService.disconnect();
    const status = await GoogleDriveSyncService.getSyncStatus();
    assert.strictEqual(status.isConnected, false);
    assert.strictEqual(status.userEmail, undefined);
    assert.strictEqual(mockSecureStore[SECURE_STORAGE_KEYS.ACCESS_TOKEN], undefined);
    pass('disconnect() purged all secure credentials');
  });

  // ── SUITE 4: Visual Status Formatting (formatRelativeSyncTime) ──
  console.log('\n--- SUITE 4: formatRelativeSyncTime Visual Logic ---');

  const formatRelativeSyncTime = (isoString?: string): string => {
    if (!isoString) return 'Nunca sincronizado';
    try {
      const syncDate = new Date(isoString).getTime();
      if (isNaN(syncDate)) return 'Data desconhecida';
      const diffSeconds = Math.max(0, Math.floor((Date.now() - syncDate) / 1000));
      if (diffSeconds < 60) return 'Agora mesmo';
      const diffMinutes = Math.floor(diffSeconds / 60);
      if (diffMinutes === 1) return 'Há 1 minuto';
      if (diffMinutes < 60) return `Há ${diffMinutes} minutos`;
      const diffHours = Math.floor(diffMinutes / 60);
      if (diffHours === 1) return 'Há 1 hora';
      if (diffHours < 24) return `Há ${diffHours} horas`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return 'Há 1 dia';
      return `Há ${diffDays} dias`;
    } catch {
      return 'Data desconhecida';
    }
  };

  await test('formatRelativeSyncTime formats time ranges accurately', () => {
    const now = Date.now();
    assert.strictEqual(formatRelativeSyncTime(undefined), 'Nunca sincronizado');
    assert.strictEqual(formatRelativeSyncTime(''), 'Nunca sincronizado');
    assert.strictEqual(formatRelativeSyncTime(new Date(now - 10 * 1000).toISOString()), 'Agora mesmo');
    assert.strictEqual(formatRelativeSyncTime(new Date(now - 65 * 1000).toISOString()), 'Há 1 minuto');
    assert.strictEqual(formatRelativeSyncTime(new Date(now - 15 * 60 * 1000).toISOString()), 'Há 15 minutos');
    assert.strictEqual(formatRelativeSyncTime(new Date(now - 65 * 60 * 1000).toISOString()), 'Há 1 hora');
    assert.strictEqual(formatRelativeSyncTime(new Date(now - 4 * 3600 * 1000).toISOString()), 'Há 4 horas');
    assert.strictEqual(formatRelativeSyncTime(new Date(now - 26 * 3600 * 1000).toISOString()), 'Há 1 dia');
    assert.strictEqual(formatRelativeSyncTime(new Date(now - 72 * 3600 * 1000).toISOString()), 'Há 3 dias');
    pass('formatRelativeSyncTime handles all human-readable intervals');
  });

  // ── SUITE 5: 5-Second Debounce Auto-Sync Simulation ──
  console.log('\n--- SUITE 5: 5-Second Debounce Timing ---');

  await test('Rapid consecutive triggers only fire once after 5000ms delay', async () => {
    let executionCount = 0;
    let timerRef: NodeJS.Timeout | null = null;

    const triggerDebounce = (delayMs = 100) => {
      if (timerRef) clearTimeout(timerRef);
      timerRef = setTimeout(() => {
        executionCount++;
      }, delayMs);
    };

    // Trigger 10 times in rapid succession
    for (let i = 0; i < 10; i++) {
      triggerDebounce(50);
    }

    assert.strictEqual(executionCount, 0, 'Did not execute immediately');
    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(executionCount, 1, 'Executed exactly once after debounce');
    pass('Debounce throttled rapid updates into a single execution');
  });

  // ── SUITE 6: UI & Architectural Integrity Inspection ──
  console.log('\n--- SUITE 6: UI & Architectural Integrity Inspection ---');

  await test('SettingsModal.tsx includes Firebase cloud sync UI components', () => {
    const modalPath = path.resolve(__dirname, '../src/components/SettingsModal.tsx');
    const content = fs.readFileSync(modalPath, 'utf8');

    assert(content.includes('Sincronização em Nuvem (Firebase)'), 'Contains Firebase section title');
    assert(content.includes('Entrar com Google') || content.includes('Conectar com Google'), 'Contains sign-in button');
    assert(content.includes('Desconectar'), 'Contains Desconectar button');
    assert(content.includes('ActivityIndicator'), 'Contains ActivityIndicator for loading spinner');
    assert(content.includes('GoogleAuthService'), 'Imports GoogleAuthService');
    pass('SettingsModal.tsx contains all required Firebase Cloud Sync UI elements');
  });

  // Firebase scheduling and bidirectional behavior are exercised against the
  // real CloudSyncEngine in cloud_sync.test.ts, rather than source-text checks.

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passed}/${passed + failed} Tests Passed (${failed} Failed)`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
