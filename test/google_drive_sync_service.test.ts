import './setup_env';
import assert from 'assert';
import {
  GoogleDriveSyncService,
  GDRIVE_CONFIG,
  SECURE_STORAGE_KEYS,
  FORBIDDEN_DRIVE_SCOPES,
} from '../src/services/GoogleDriveSyncService';
import { StorageService } from '../src/services/storage';
import { mockSecureStore, mockAsyncStorage, memoryStore } from './setup_env';
import { BackupData, Subject, AppEvent } from '../src/types';

let passedAssertions = 0;
let totalAssertions = 0;

function pass(msg: string) {
  passedAssertions++;
  totalAssertions++;
  console.log(`  ✅ [PASS] ${msg}`);
}

function fail(msg: string, error?: unknown) {
  totalAssertions++;
  console.error(`  ❌ [FAIL] ${msg}`, error || '');
  throw error || new Error(msg);
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
const originalFetch = globalThis.fetch;
let mockDriveFiles: Record<string, { content: string; metadata: any }> = {};

function setupMockDriveEndpoints() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();

    // 1. Find file in appDataFolder
    if (url.includes('/drive/v3/files?spaces=appDataFolder')) {
      const authHeader = init?.headers ? (init.headers as any)['Authorization'] : '';
      if (!authHeader || !authHeader.includes('Bearer valid_access_token')) {
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
      // Extract JSON content from multipart
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
      const metadata = {
        id: fileId,
        name: GDRIVE_CONFIG.SYNC_FILENAME,
        modifiedTime: new Date().toISOString(),
        size: String(content.length),
      };
      mockDriveFiles[fileId] = { content, metadata };
      return new Response(JSON.stringify(metadata), { status: 200 });
    }

    // 5. Revoke endpoint
    if (url.includes('oauth2.googleapis.com/revoke')) {
      return new Response('{}', { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Unhandled mock URL' }), { status: 400 });
  };
}

async function runGoogleDriveSyncServiceTests() {
  console.log('================================================================');
  console.log('🛡️  LUMEN: GOOGLE DRIVE SYNC SERVICE SECURITY & INTEGRITY TESTS');
  console.log('================================================================');

  setupMockDriveEndpoints();

  // ─────────────────────────────────────────────────────────────
  // SUITE 1: Armazenamento Seguro de Credenciais (Requisito 1)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 1: Armazenamento Seguro de Credenciais (expo-secure-store) ---');

  await test('1.1 saveSecureTokens grava tokens exclusivamente no SecureStore', async () => {
    // Clean stores
    await GoogleDriveSyncService.clearSecureTokens();
    await mockAsyncStorage.clear();

    const tokens = {
      accessToken: 'valid_access_token_12345',
      refreshToken: 'valid_refresh_token_67890',
      expiresAt: Date.now() + 3600000,
      userEmail: 'aluno@engenharia.ufrj.br',
    };

    const saved = await GoogleDriveSyncService.saveSecureTokens(tokens);
    assert.strictEqual(saved, true, 'Tokens saved successfully');

    // Verify SecureStore has the tokens
    assert.strictEqual(
      mockSecureStore[SECURE_STORAGE_KEYS.ACCESS_TOKEN],
      'valid_access_token_12345',
      'Access token stored in SecureStore'
    );
    assert.strictEqual(
      mockSecureStore[SECURE_STORAGE_KEYS.REFRESH_TOKEN],
      'valid_refresh_token_67890',
      'Refresh token stored in SecureStore'
    );
    assert.strictEqual(
      mockSecureStore[SECURE_STORAGE_KEYS.USER_EMAIL],
      'aluno@engenharia.ufrj.br',
      'User email stored in SecureStore'
    );

    pass('saveSecureTokens writes tokens to hardware-backed SecureStore');
  });

  await test('1.2 Tokens NUNCA são salvos no AsyncStorage em texto plano', async () => {
    const asyncStorageKeys = await mockAsyncStorage.getAllKeys();
    for (const key of asyncStorageKeys) {
      assert.strictEqual(
        key.includes('token') || key.includes('gdrive'),
        false,
        `Forbidden plain token key found in AsyncStorage: ${key}`
      );
      const val = await mockAsyncStorage.getItem(key);
      if (val) {
        assert.strictEqual(
          val.includes('valid_access_token') || val.includes('valid_refresh_token'),
          false,
          `Raw token leaked in AsyncStorage value for key: ${key}`
        );
      }
    }

    const noLeak = await GoogleDriveSyncService.assertNoTokensInPlainStorage();
    assert.strictEqual(noLeak, true, 'assertNoTokensInPlainStorage verifies zero token leakage');
    pass('AsyncStorage is 100% free of plaintext tokens');
  });

  await test('1.3 getSecureTokens recupera tokens do SecureStore com suporte a cold-start', async () => {
    // Reset in-memory cache to simulate cold app launch
    GoogleDriveSyncService.resetMemoryCache();

    const loaded = await GoogleDriveSyncService.getSecureTokens();
    assert.notStrictEqual(loaded, null, 'Loaded tokens must not be null');
    assert.strictEqual(loaded?.accessToken, 'valid_access_token_12345');
    assert.strictEqual(loaded?.refreshToken, 'valid_refresh_token_67890');
    assert.strictEqual(loaded?.userEmail, 'aluno@engenharia.ufrj.br');
    pass('getSecureTokens correctly reconstructs session after cold-start');
  });

  await test('1.4 clearSecureTokens remove completamente todos os segredos do SecureStore', async () => {
    await GoogleDriveSyncService.clearSecureTokens();

    assert.strictEqual(mockSecureStore[SECURE_STORAGE_KEYS.ACCESS_TOKEN], undefined);
    assert.strictEqual(mockSecureStore[SECURE_STORAGE_KEYS.REFRESH_TOKEN], undefined);
    assert.strictEqual(mockSecureStore[SECURE_STORAGE_KEYS.USER_EMAIL], undefined);

    const loaded = await GoogleDriveSyncService.getSecureTokens();
    assert.strictEqual(loaded, null, 'Tokens must be null after clearSecureTokens');
    pass('clearSecureTokens purges all tokens from SecureStore and memory cache');
  });

  await test('1.5 saveSecureTokens rejeita tokens inválidos ou vazios', async () => {
    const resEmpty = await GoogleDriveSyncService.saveSecureTokens({ accessToken: '   ' } as any);
    assert.strictEqual(resEmpty, false, 'Returns false for whitespace token');

    let threw = false;
    try {
      await GoogleDriveSyncService.saveSecureTokens(null as any);
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, true, 'Throws on null token object');
    pass('Empty or null tokens are rejected safely');
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 2: Sanitização e Isolamento de Escopos (Requisito 2)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 2: Sanitização de Escopos & drive.appdata (Requisito 2) ---');

  await test('2.1 Permite exclusivamente drive.appdata e escopos de identidade', () => {
    const validScopes = [
      'https://www.googleapis.com/auth/drive.appdata',
      'https://www.googleapis.com/auth/userinfo.email',
    ];
    const sanitized = GoogleDriveSyncService.validateAndSanitizeScopes(validScopes);
    assert.deepStrictEqual(sanitized, [
      'https://www.googleapis.com/auth/drive.appdata',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
    pass('Valid drive.appdata and userinfo scopes are accepted');
  });

  await test('2.2 Rejeita escopo amplo e perigoso drive com erro de segurança', () => {
    let threw = false;
    let errorMsg = '';
    try {
      GoogleDriveSyncService.validateAndSanitizeScopes(['https://www.googleapis.com/auth/drive']);
    } catch (e: any) {
      threw = true;
      errorMsg = e.message;
    }
    assert.strictEqual(threw, true, 'Must throw error on dangerous drive scope');
    assert(errorMsg.includes('Violação de segurança'), 'Error mentions security violation');
    pass('Dangerous scope "drive" rejected with security violation error');
  });

  await test('2.3 Rejeita escopo perigoso drive.file com erro de segurança', () => {
    let threw = false;
    let errorMsg = '';
    try {
      GoogleDriveSyncService.validateAndSanitizeScopes(['https://www.googleapis.com/auth/drive.file']);
    } catch (e: any) {
      threw = true;
      errorMsg = e.message;
    }
    assert.strictEqual(threw, true, 'Must throw error on dangerous drive.file scope');
    assert(errorMsg.includes('drive.file') || errorMsg.includes('Violação de segurança'), 'Error mentions drive.file');
    pass('Dangerous scope "drive.file" rejected with security violation error');
  });

  await test('2.4 Rejeita escopos proibidos adicionais (readonly, metadata, photos, scripts)', () => {
    for (const forbidden of FORBIDDEN_DRIVE_SCOPES) {
      let threw = false;
      try {
        GoogleDriveSyncService.validateAndSanitizeScopes([forbidden]);
      } catch {
        threw = true;
      }
      assert.strictEqual(threw, true, `Must throw on forbidden scope: ${forbidden}`);
    }
    pass('All forbidden Drive scopes in blacklist are strictly rejected');
  });

  await test('2.5 getDefaultAuthScopes sempre inclui estritamente drive.appdata', () => {
    const scopes = GoogleDriveSyncService.getDefaultAuthScopes();
    assert(scopes.includes(GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE), 'Includes drive.appdata');
    assert(!scopes.some(s => s.includes('drive.file')), 'Does NOT include drive.file');
    assert(!scopes.some(s => s === 'https://www.googleapis.com/auth/drive'), 'Does NOT include broad drive');
    pass('getDefaultAuthScopes enforces minimum-privilege drive.appdata isolation');
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 3: Validação de Integridade do JSON (Requisito 3)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 3: Validação Estrutural e Integridade do JSON (Requisito 3) ---');

  await test('3.1 validateSyncPayload rejeita payloads nulos ou vazios', () => {
    const nullRes = GoogleDriveSyncService.validateSyncPayload(null);
    assert.strictEqual(nullRes.isValid, false, 'Null payload must be invalid');

    const emptyRes = GoogleDriveSyncService.validateSyncPayload('   ');
    assert.strictEqual(emptyRes.isValid, false, 'Empty payload must be invalid');
    pass('Null and empty payloads are rejected safely');
  });

  await test('3.2 validateSyncPayload rejeita JSON quebrado ou corrompido sem crashar', () => {
    const brokenJson = '{"version": 2, "timestamp": "2026-09-28", "events": [ { broken json';
    const res = GoogleDriveSyncService.validateSyncPayload(brokenJson);
    assert.strictEqual(res.isValid, false);
    assert(res.errors[0].includes('JSON inválido'), 'Error describes invalid JSON format');
    pass('Corrupt/truncated JSON is detected and rejected without unhandled exceptions');
  });

  await test('3.3 validateSyncPayload detecta e bloqueia tentativas de Prototype Pollution', () => {
    const maliciousPayloadStr = '{"version": 2, "timestamp": "2026-09-28", "__proto__": {"admin": true}, "events": []}';

    const resStr = GoogleDriveSyncService.validateSyncPayload(maliciousPayloadStr);
    assert.strictEqual(resStr.isValid, false);
    assert(resStr.errors[0].includes('Prototype Pollution'), 'Blocks Prototype Pollution in string');

    const maliciousObj: any = { version: 2, timestamp: '2026-09-28', events: [] };
    Object.defineProperty(maliciousObj, '__proto__', {
      value: { admin: true },
      enumerable: true,
      configurable: true,
    });
    const resObj = GoogleDriveSyncService.validateSyncPayload(maliciousObj);
    assert.strictEqual(resObj.isValid, false);
    assert(resObj.errors[0].includes('Prototype Pollution'), 'Blocks Prototype Pollution in object');

    pass('Prototype pollution attack vectors are blocked');
  });

  await test('3.4 validateSyncPayload rejeita arquivos com tamanho superior ao limite seguro (25MB)', () => {
    // Generate a simulated oversized string
    const largeDummy = 'x'.repeat(26 * 1024 * 1024);
    const res = GoogleDriveSyncService.validateSyncPayload(largeDummy);
    assert.strictEqual(res.isValid, false);
    assert(res.errors[0].includes('excede o limite'), 'Rejects oversized file');
    pass('Memory DoS through oversized cloud files is prevented');
  });

  await test('3.5 validateSyncPayload rejeita schema corrompido (versão ausente, timestamp inválido)', () => {
    const invalidSchema = JSON.stringify({
      events: [],
      subjects: [],
    });
    const res = GoogleDriveSyncService.validateSyncPayload(invalidSchema);
    assert.strictEqual(res.isValid, false);
    assert(res.errors.some(e => e.includes('version')), 'Version error flagged');
    assert(res.errors.some(e => e.includes('timestamp')), 'Timestamp error flagged');
    pass('Corrupt schema with missing required metadata is rejected');
  });

  await test('3.6 validateSyncPayload higieniza strings maliciosas com tags <script>', () => {
    const xssPayload: BackupData = {
      version: 2,
      timestamp: new Date().toISOString(),
      events: [
        {
          id: 'ev_xss',
          title: 'Aula de Cálculo <script>alert("hack")</script>',
          date: '2026-09-28',
          time: '08:00',
          category: 'Faculdade/Aulas',
          notificationEnabled: true,
        },
      ],
      subjects: [
        {
          id: 'sub_xss',
          name: 'Física II <iframe src="evil.com"></iframe>',
          color: '#3b82f6',
          workloadHours: 60,
          maxAbsences: 15,
        },
      ],
      attendances: [],
      tasks: [],
      studySessions: [],
      semesters: [],
    };

    const res = GoogleDriveSyncService.validateSyncPayload(xssPayload);
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.data?.events?.[0].title, 'Aula de Cálculo');
    assert.strictEqual(res.data?.subjects?.[0].name, 'Física II');
    pass('XSS tags and malicious script payloads in entities are stripped cleanly');
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 4: Isolamento do Banco Local contra Arquivos Corrompidos na Nuvem
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 4: Isolamento do Banco Local & Resiliência a Falhas de Nuvem ---');

  await test('4.1 downloadSyncFromCloud rejeita download de arquivo corrompido mantendo banco local 100% intacto', async () => {
    // 1. Seed healthy local data
    const localSubjects: Subject[] = [
      { id: 'sub_precious', name: 'Engenharia de Software', color: '#10b981', workloadHours: 60, maxAbsences: 15 },
    ];
    await StorageService.saveSubjects(localSubjects);

    // 2. Put corrupt file in mock cloud
    mockDriveFiles = {
      corrupt_cloud_file: {
        content: '{"corrupted": true, "version": -1', // syntax error and negative version
        metadata: { id: 'corrupt_cloud_file', name: GDRIVE_CONFIG.SYNC_FILENAME },
      },
    };

    // Set valid token
    await GoogleDriveSyncService.saveSecureTokens({
      accessToken: 'valid_access_token_12345',
      userEmail: 'aluno@ufrj.br',
    });

    // 3. Attempt download
    let threw = false;
    let errorMsg = '';
    try {
      await GoogleDriveSyncService.downloadSyncFromCloud();
    } catch (e: any) {
      threw = true;
      errorMsg = e.message;
    }

    assert.strictEqual(threw, true, 'Download must abort on corrupt cloud file');
    assert(errorMsg.includes('Falha na validação de integridade'), 'Error describes integrity validation failure');

    // 4. Verify local database was NOT touched or corrupted
    const preservedSubjects = await StorageService.getSubjects();
    assert.strictEqual(preservedSubjects.length, 1);
    assert.strictEqual(preservedSubjects[0].id, 'sub_precious');
    assert.strictEqual(preservedSubjects[0].name, 'Engenharia de Software');
    pass('Local database remains 100% untouched when cloud file is corrupt');
  });

  await test('4.2 downloadSyncFromCloud sincroniza com sucesso arquivo válido da nuvem', async () => {
    const validCloudData: BackupData = {
      version: 2,
      timestamp: new Date().toISOString(),
      subjects: [
        { id: 'sub_cloud_1', name: 'Cálculo Numérico', color: '#6366f1', workloadHours: 60, maxAbsences: 15 },
      ],
      events: [
        {
          id: 'ev_cloud_1',
          title: 'Prova de Cálculo Numérico',
          date: '2026-10-15',
          time: '10:00',
          category: 'Provas/Trabalhos',
          subjectId: 'sub_cloud_1',
          notificationEnabled: true,
        },
      ],
      attendances: [],
      tasks: [],
      studySessions: [],
      semesters: [],
    };

    mockDriveFiles = {
      valid_cloud_file: {
        content: JSON.stringify(validCloudData),
        metadata: { id: 'valid_cloud_file', name: GDRIVE_CONFIG.SYNC_FILENAME },
      },
    };

    const result = await GoogleDriveSyncService.downloadSyncFromCloud();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.details?.subjectsCount, 1);
    assert.strictEqual(result.details?.eventsCount, 1);

    // Verify imported in StorageService
    const restoredSubjects = await StorageService.getSubjects();
    assert.strictEqual(restoredSubjects.some(s => s.id === 'sub_cloud_1'), true);

    const status = await GoogleDriveSyncService.getSyncStatus();
    assert.strictEqual(status.isConnected, true);
    assert.notStrictEqual(status.lastSyncTime, undefined);
    pass('Valid cloud backup restores cleanly with full integrity validation');
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 5: Upload e Ciclo de Vida da Conexão
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 5: Upload e Desconexão Segura ---');

  await test('5.1 uploadSyncToCloud exporta e envia dados estruturados para a nuvem', async () => {
    mockDriveFiles = {}; // Clear cloud
    const uploadResult = await GoogleDriveSyncService.uploadSyncToCloud();
    assert.strictEqual(uploadResult.success, true);
    assert.notStrictEqual(uploadResult.fileId, undefined);

    // Verify file created in mock drive
    const files = Object.values(mockDriveFiles);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].metadata.name, GDRIVE_CONFIG.SYNC_FILENAME);

    pass('uploadSyncToCloud exports and writes to cloud AppData folder');
  });

  await test('5.2 disconnect revoga tokens e limpa completamente SecureStore', async () => {
    await GoogleDriveSyncService.disconnect();

    const status = await GoogleDriveSyncService.getSyncStatus();
    assert.strictEqual(status.isConnected, false);
    assert.strictEqual(status.userEmail, undefined);

    const tokens = await GoogleDriveSyncService.getSecureTokens();
    assert.strictEqual(tokens, null);

    pass('disconnect cleanly clears credentials and resets connection state');
  });

  // Restore fetch
  globalThis.fetch = originalFetch;

  console.log('\n================================================================');
  console.log(`GOOGLE DRIVE SYNC SERVICE TEST SUMMARY: ${passedAssertions}/${totalAssertions} Passed (0 Failed)`);
  console.log('================================================================\n');
}

runGoogleDriveSyncServiceTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
