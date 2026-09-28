import './setup_env';
import assert from 'assert';
import {
  GoogleDriveSyncService,
  WebSecureVault,
  GDRIVE_CONFIG,
  SECURE_STORAGE_KEYS,
} from '../src/services/GoogleDriveSyncService';
import { StorageService } from '../src/services/storage';
import {
  mockSecureStore,
  mockAsyncStorage,
  mockLocalStorage,
  mockSessionStorage,
  memoryStore,
} from './setup_env';
import { Platform } from 'react-native';
import { BackupData, Subject, AppEvent, StudyTask } from '../src/types';

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

// Mock HTTP responses for Google Drive & UserInfo REST endpoints
let mockDriveFiles: Record<string, { content: string; metadata: any }> = {};
let lastUploadedMethod: string | null = null;
let lastUploadedUrl: string | null = null;
let lastUploadedBody: string | null = null;

function setupMockHttpEndpoints() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    const method = init?.method || 'GET';

    // 1. Google UserInfo endpoint
    if (url.includes('/oauth2/v3/userinfo')) {
      const auth = (init?.headers as any)?.Authorization || '';
      if (!auth.includes('Bearer')) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }
      return new Response(
        JSON.stringify({
          sub: '1092837465',
          email: 'estudante.windows@usp.br',
          email_verified: true,
          name: 'Estudante Lumen Desktop',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2. Google Drive Find in appDataFolder
    if (url.includes('/drive/v3/files') && url.includes('spaces=appDataFolder') && method === 'GET') {
      const auth = (init?.headers as any)?.Authorization || '';
      if (!auth.includes('Bearer')) {
        return new Response(JSON.stringify({ error: { message: 'Invalid Credentials', code: 401 } }), {
          status: 401,
          statusText: 'Unauthorized',
        });
      }
      const files = Object.values(mockDriveFiles).map((f: any) => f.metadata || {
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime,
        size: f.size,
      });
      return new Response(JSON.stringify({ files }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Download file content (?alt=media)
    if (url.includes('/drive/v3/files/') && url.includes('alt=media') && method === 'GET') {
      const match = url.match(/\/files\/([a-zA-Z0-9_-]+)\?alt=media/);
      const fileId = match ? match[1] : '';
      const file = mockDriveFiles[fileId] as any;
      if (!file) {
        return new Response(JSON.stringify({ error: 'File not found' }), { status: 404 });
      }
      const content = file.content !== undefined ? file.content : JSON.stringify(file);
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Upload multipart file (POST)
    if (url.includes('/upload/drive/v3/files?uploadType=multipart') && method === 'POST') {
      lastUploadedMethod = 'POST';
      lastUploadedUrl = url;
      lastUploadedBody = init?.body?.toString() || '';
      const fileId = 'cloud_file_' + Date.now();
      const body = lastUploadedBody;
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

    // 5. Update file (PATCH)
    if (url.includes('/upload/drive/v3/files/') && url.includes('uploadType=media') && method === 'PATCH') {
      lastUploadedMethod = 'PATCH';
      lastUploadedUrl = url;
      lastUploadedBody = init?.body?.toString() || '';
      const match = url.match(/\/files\/([a-zA-Z0-9_-]+)\?uploadType=media/);
      const fileId = match ? match[1] : '';
      const content = lastUploadedBody;
      const metadata = {
        id: fileId,
        name: GDRIVE_CONFIG.SYNC_FILENAME,
        modifiedTime: new Date().toISOString(),
        size: String(content.length),
      };
      mockDriveFiles[fileId] = { content, metadata };
      return new Response(JSON.stringify(metadata), { status: 200 });
    }

    // 6. Revoke endpoint
    if (url.includes('oauth2.googleapis.com/revoke')) {
      return new Response('{}', { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Unhandled mock URL: ' + url }), { status: 400 });
  };
}

async function runWebDesktopOAuthTests() {
  console.log('================================================================');
  console.log('🖥️  LUMEN: GOOGLE DRIVE WEB / DESKTOP (TAURI) & OAUTH2 TESTS');
  console.log('================================================================');

  setupMockHttpEndpoints();

  // ─────────────────────────────────────────────────────────────
  // SUITE 1: WebSecureVault Criptografado no Web/Desktop (Requisito 2)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 1: WebSecureVault (Criptografia AES-GCM no Web/Desktop) ---');

  await test('1.1 WebSecureVault salva credenciais criptografadas sem expor texto plano no localStorage', async () => {
    mockLocalStorage.clear();
    mockSessionStorage.clear();
    GoogleDriveSyncService.resetMemoryCache();

    // Switch platform to web
    (Platform as any).OS = 'web';

    const testTokens = {
      accessToken: 'ya29.a0AfH6SMD_ultra_secret_web_token_123',
      refreshToken: '1//0gSecret_refresh_token_web_456',
      expiresAt: Date.now() + 3600000,
      userEmail: 'engenharia@tauri.desktop',
    };

    const saved = await GoogleDriveSyncService.saveSecureTokens(testTokens);
    assert.strictEqual(saved, true, 'Tokens must be saved successfully');

    // Verify localStorage has the vault key
    const vaultRaw = mockLocalStorage.getItem(WebSecureVault.STORAGE_KEY);
    assert.notStrictEqual(vaultRaw, null, 'Vault key must exist in localStorage');

    // Parse encrypted payload
    const parsedPayload = JSON.parse(vaultRaw!);
    assert(parsedPayload.iv, 'Payload must contain IV (Initialization Vector)');
    assert(parsedPayload.data, 'Payload must contain ciphertext data');

    // Verify ZERO plaintext token leakage in localStorage
    assert.strictEqual(
      vaultRaw!.includes('ya29.a0AfH6SMD_ultra_secret_web_token_123'),
      false,
      'Access token must NOT exist in plaintext in localStorage'
    );
    assert.strictEqual(
      vaultRaw!.includes('1//0gSecret_refresh_token_web_456'),
      false,
      'Refresh token must NOT exist in plaintext in localStorage'
    );
    assert.strictEqual(
      vaultRaw!.includes('engenharia@tauri.desktop'),
      false,
      'User email must NOT exist in plaintext in localStorage'
    );

    pass('WebSecureVault encrypts tokens with AES-GCM; zero plaintext tokens in localStorage');
  });

  await test('1.2 assertNoTokensInPlainStorage valida segurança do localStorage e AsyncStorage no Desktop', async () => {
    const isClean = await GoogleDriveSyncService.assertNoTokensInPlainStorage();
    assert.strictEqual(isClean, true, 'Storage scan confirms zero plaintext credential leakage');

    // Test adversarial leak injection: If an attacker injects plain token in localStorage, it is purged
    mockLocalStorage.setItem('injected_access_token', 'ya29.leaked_credential');
    const wasCleanAfterLeak = await GoogleDriveSyncService.assertNoTokensInPlainStorage();
    assert.strictEqual(wasCleanAfterLeak, false, 'Injected leak correctly detected and reported');
    assert.strictEqual(mockLocalStorage.getItem('injected_access_token'), null, 'Injected token was purged');

    pass('assertNoTokensInPlainStorage proactively protects against plain token leakage');
  });

  await test('1.3 getSecureTokens recupera e decriptografa credenciais no Desktop (Cold Start)', async () => {
    // Simulate app cold restart
    GoogleDriveSyncService.resetMemoryCache();

    const loaded = await GoogleDriveSyncService.getSecureTokens();
    assert.notStrictEqual(loaded, null, 'Loaded tokens must not be null');
    assert.strictEqual(loaded?.accessToken, 'ya29.a0AfH6SMD_ultra_secret_web_token_123');
    assert.strictEqual(loaded?.refreshToken, '1//0gSecret_refresh_token_web_456');
    assert.strictEqual(loaded?.userEmail, 'engenharia@tauri.desktop');

    pass('getSecureTokens decrypts and restores desktop session cleanly across restarts');
  });

  await test('1.4 clearSecureTokens remove completamente o cofre do localStorage e sessionStorage', async () => {
    await GoogleDriveSyncService.clearSecureTokens();

    const inMemory = await GoogleDriveSyncService.getSecureTokens();
    assert.strictEqual(inMemory, null, 'Session must be null after clear');
    assert.strictEqual(mockLocalStorage.getItem(WebSecureVault.STORAGE_KEY), null, 'Vault removed from localStorage');
    assert.strictEqual(mockSessionStorage.getItem('__lumen_web_vault'), null, 'Vault removed from sessionStorage');

    pass('clearSecureTokens purges all encrypted tokens from web/desktop storage');
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 2: Fluxo OAuth Web / Desktop (Requisitos 1 e 2)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 2: Geração e Tratamento do Fluxo OAuth Web / Desktop ---');

  await test('2.1 buildOAuthUrl constrói URL válida com scopes corretos e state CSRF', () => {
    const state = GoogleDriveSyncService.generateRandomHex(16);
    const authUrl = GoogleDriveSyncService.buildOAuthUrl({
      clientId: 'test-client-id.apps.googleusercontent.com',
      redirectUri: 'http://localhost:8081',
      state,
    });

    assert(authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
    assert(authUrl.includes('client_id=test-client-id.apps.googleusercontent.com'));
    assert(authUrl.includes('redirect_uri=http%3A%2F%2Flocalhost%3A8081'));
    assert(authUrl.includes('response_type=token'));
    assert(authUrl.includes(encodeURIComponent(GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE)));
    assert(authUrl.includes('state=' + state));

    pass('buildOAuthUrl creates compliant Google OAuth authorization URL');
  });

  await test('2.2 fetchUserEmail consulta endpoint Google UserInfo e higieniza e-mail', async () => {
    const email = await GoogleDriveSyncService.fetchUserEmail('valid_token_for_userinfo');
    assert.strictEqual(email, 'estudante.windows@usp.br');
    pass('fetchUserEmail retrieves and sanitizes user profile email');
  });

  await test('2.3 checkUrlForOAuthCallback captura token do hash da URL e estabelece sessão segura', async () => {
    (Platform as any).OS = 'web';
    GoogleDriveSyncService.resetMemoryCache();

    // Simulate OAuth redirect landing on http://localhost:8081/#access_token=ya29.web_callback_token&expires_in=3600
    (globalThis as any).window.location = {
      origin: 'http://localhost:8081',
      pathname: '/',
      hash: '#access_token=ya29.web_callback_token&expires_in=3600&token_type=Bearer&state=random_state',
      search: '',
    };

    const handled = await GoogleDriveSyncService.checkUrlForOAuthCallback();
    assert.strictEqual(handled, true, 'OAuth callback was parsed and handled');

    const status = await GoogleDriveSyncService.getSyncStatus();
    assert.strictEqual(status.isConnected, true, 'User is now connected');
    assert.strictEqual(status.userEmail, 'estudante.windows@usp.br', 'User email obtained via UserInfo');

    const tokens = await GoogleDriveSyncService.getSecureTokens();
    assert.strictEqual(tokens?.accessToken, 'ya29.web_callback_token', 'Captured token matches');

    pass('checkUrlForOAuthCallback successfully intercepts OAuth response from URL');
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 3: Sincronização Windows / Desktop (Requisito 3)
  // "após logar no Windows, o botão 'Sincronizar Agora' deve baixar o
  // lumen_sync.json da pasta appDataFolder do Google Drive que o celular enviou!"
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 3: Sincronização Windows (Download de Dados Enviados pelo Celular) ---');

  await test('3.1 Sincronizar Agora no Windows baixa lumen_sync.json da appDataFolder enviado pelo celular', async () => {
    (Platform as any).OS = 'web';

    // 1. Limpa banco de dados local do Windows (simula app recém-instalado no Desktop)
    await StorageService.saveSubjects([]);
    await StorageService.saveEvents([]);
    await StorageService.saveTasks([]);
    await GoogleDriveSyncService.clearSecureTokens();

    // 2. O celular do estudante já havia sincronizado seus dados com a appDataFolder do Google Drive
    const mobileBackupData: BackupData = {
      version: 2,
      timestamp: '2026-09-28T11:30:00.000Z',
      subjects: [
        {
          id: 'sub_calculo_celular',
          name: 'Cálculo Numérico',
          code: 'MAT301',
          color: '#3B82F6',
          workloadHours: 60,
          passGrade: 7.0,
        },
        {
          id: 'sub_sistemas_celular',
          name: 'Sistemas Embarcados',
          code: 'ENG501',
          color: '#10B981',
          workloadHours: 80,
          passGrade: 7.0,
        },
      ],
      events: [
        {
          id: 'evt_projeto_embarcados',
          title: 'Apresentação do Projeto Final de Embarcados',
          date: '2026-10-20',
          startTime: '09:00',
          endTime: '12:00',
          category: 'Provas/Trabalhos',
          subjectId: 'sub_sistemas_celular',
          isImportant: true,
        },
      ],
      tasks: [
        {
          id: 'task_firmware_stm32',
          title: 'Compilar firmware do STM32 com FreeRTOS',
          subjectId: 'sub_sistemas_celular',
          completed: false,
        },
      ],
      attendances: [],
      studySessions: [],
      semesters: [],
    };

    const cloudFileId = 'cloud_mobile_file_999';
    mockDriveFiles = {
      [cloudFileId]: {
        id: cloudFileId,
        name: GDRIVE_CONFIG.SYNC_FILENAME,
        modifiedTime: '2026-09-28T11:30:00.000Z',
        size: String(JSON.stringify(mobileBackupData).length),
        content: JSON.stringify(mobileBackupData),
      },
    };

    // 3. Usuário loga no Windows com sua conta do Google Drive
    await GoogleDriveSyncService.connectAccount({
      email: 'estudante.windows@usp.br',
      accessToken: 'valid_access_token_desktop',
      expiresAt: Date.now() + 3600000,
    });

    const statusInitial = await GoogleDriveSyncService.getSyncStatus();
    assert.strictEqual(statusInitial.isConnected, true, 'Desktop está conectado ao Google Drive');
    assert.strictEqual(statusInitial.lastSyncTime, undefined, 'Desktop ainda não possui sincronização prévia');

    // 4. Usuário clica no botão "Sincronizar Agora" (GoogleDriveSyncService.sincronizar())
    const syncResult = await GoogleDriveSyncService.sincronizar();

    // 5. Validações estritas:
    assert.strictEqual(syncResult.success, true, 'Sincronizar Agora foi concluído com sucesso');
    assert.strictEqual(syncResult.action, 'download', 'Ação executada foi DOWNLOAD da nuvem');
    assert.strictEqual(syncResult.fileId, cloudFileId, 'ID do arquivo baixado corresponde ao arquivo do celular');
    assert.strictEqual(syncResult.details?.subjectsCount, 2, 'Foram importadas 2 matérias enviadas pelo celular');
    assert.strictEqual(syncResult.details?.eventsCount, 1, 'Foi importado 1 evento enviado pelo celular');
    assert.strictEqual(syncResult.details?.tasksCount, 1, 'Foi importada 1 tarefa enviada pelo celular');

    // 6. Confirma que o StorageService local do Windows agora contém todos os dados do celular
    const localSubjects = await StorageService.getSubjects();
    assert.strictEqual(localSubjects.length, 2);
    assert(localSubjects.some(s => s.name === 'Cálculo Numérico'));
    assert(localSubjects.some(s => s.name === 'Sistemas Embarcados'));

    const localEvents = await StorageService.getEvents();
    assert.strictEqual(localEvents.length, 1);
    assert.strictEqual(localEvents[0].title, 'Apresentação do Projeto Final de Embarcados');

    const localTasks = await StorageService.getTasks();
    assert.strictEqual(localTasks.length, 1);
    assert.strictEqual(localTasks[0].title, 'Compilar firmware do STM32 com FreeRTOS');

    // 7. Confirma que o lastSyncTime no Windows foi registrado
    const statusFinal = await GoogleDriveSyncService.getSyncStatus();
    assert(statusFinal.lastSyncTime !== undefined, 'lastSyncTime registrado no Desktop');

    pass('Sincronizar Agora no Windows baixou lumen_sync.json da appDataFolder do celular com 100% de integridade!');
  });

  await test('3.2 Após download, nova edição no Windows e Sincronizar Agora dispara upload PATCH para a nuvem', async () => {
    (Platform as any).OS = 'web';

    // O usuário edita uma matéria no Windows
    const subjects = await StorageService.getSubjects();
    const updatedSubjects = subjects.map(s =>
      s.id === 'sub_sistemas_celular' ? { ...s, name: 'Sistemas Embarcados e IoT Avançado' } : s
    );
    await StorageService.saveSubjects(updatedSubjects);

    lastUploadedMethod = null;
    lastUploadedUrl = null;

    // Usuário clica em "Sincronizar Agora" novamente
    const result = await GoogleDriveSyncService.sincronizar();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.action, 'upload', 'Agora que o local é mais recente, a ação é UPLOAD');
    assert.strictEqual(lastUploadedMethod, 'PATCH', 'Atualização in-place via PATCH');
    assert(lastUploadedBody?.includes('Sistemas Embarcados e IoT Avançado'), 'Nuvem recebeu o nome atualizado');

    pass('Sincronizar Agora alternou inteligentemente para UPLOAD (PATCH) após edição local');
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 4: Autenticação Mobile (Platform.OS !== 'web')
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- SUITE 4: Autenticação Mobile via expo-auth-session ---');

  await test('4.1 connectWithGoogle no mobile utiliza expo-auth-session de forma transparente', async () => {
    (Platform as any).OS = 'android';
    await GoogleDriveSyncService.clearSecureTokens();

    const connected = await GoogleDriveSyncService.connectWithGoogle();
    assert.strictEqual(connected, true, 'Mobile OAuth completed successfully');

    const status = await GoogleDriveSyncService.getSyncStatus();
    assert.strictEqual(status.isConnected, true, 'Mobile connection status is active');

    pass('Mobile OAuth delegates seamlessly to expo-auth-session');
  });

  console.log('\n================================================================');
  console.log(`📊 TEST RESULTS: ${passedAssertions}/${totalAssertions} Passed (0 Failed)`);
  console.log('================================================================');
}

runWebDesktopOAuthTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
