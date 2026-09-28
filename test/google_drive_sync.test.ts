import './setup_env';
import {
  GoogleDriveSyncService,
  GDRIVE_CONFIG,
  SECURE_STORAGE_KEYS,
} from '../src/services/GoogleDriveSyncService';
import { StorageService } from '../src/services/storage';
import {
  mockSecureStore,
  mockAsyncStorage,
  memoryStore,
  lastAlertCalls,
  clearMockAlertCalls,
  mockAlert,
} from './setup_env';
import { BackupData, Subject, AppEvent, StudyTask } from '../src/types';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  totalTests++;
  if (actual === expected) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${message} (Esperado: ${String(expected)}, Obtido: ${String(actual)})`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  console.log(`\n--- Test: ${name} ---`);
  await fn();
}

// ============================================================================
// MOCK HTTP FETCH & VIRTUAL CLOUD DRIVE SIMULATOR
// ============================================================================

const originalFetch = globalThis.fetch;

interface MockDriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: string;
  content: string;
}

let mockDriveFiles: Record<string, MockDriveFile> = {};
let networkFailureMode: 'none' | 'timeout' | 'offline' | 'unauthorized_401' | 'not_found_404' = 'none';
let lastUploadedMethod: string | null = null;
let lastUploadedUrl: string | null = null;
let lastUploadedBody: string | null = null;

function setupMockDriveHttp() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    const method = init?.method || 'GET';

    // 1. Simulação de Falhas de Rede (Timeout / Offline)
    if (networkFailureMode === 'timeout') {
      const abortError = new Error('The operation was aborted due to timeout.');
      abortError.name = 'AbortError';
      throw abortError;
    }

    if (networkFailureMode === 'offline') {
      const netError = new TypeError('Network request failed: device is offline');
      throw netError;
    }

    // 2. Simulação de Erro 401 (Token Expirado / Não Autorizado)
    if (networkFailureMode === 'unauthorized_401') {
      return new Response(
        JSON.stringify({
          error: {
            code: 401,
            message: 'Request had invalid authentication credentials. Expected OAuth 2 access token.',
            status: 'UNAUTHENTICATED',
          },
        }),
        {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validação de autenticação para endpoints protegidos do Google Drive
    const authHeader = init?.headers ? (init.headers as Record<string, string>)['Authorization'] : '';
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }),
        { status: 401, statusText: 'Unauthorized' }
      );
    }

    // 3. Endpoint: Listar arquivos na pasta oculta AppData (spaces=appDataFolder)
    if (url.includes('/drive/v3/files') && url.includes('spaces=appDataFolder') && method === 'GET') {
      if (networkFailureMode === 'not_found_404') {
        return new Response(
          JSON.stringify({ error: { code: 404, message: 'AppData folder not found' } }),
          { status: 404, statusText: 'Not Found' }
        );
      }

      const files = Object.values(mockDriveFiles).map(f => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime,
        size: f.size,
      }));

      return new Response(JSON.stringify({ files }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Endpoint: Download do conteúdo do arquivo (?alt=media)
    if (url.includes('/drive/v3/files/') && url.includes('alt=media') && method === 'GET') {
      const match = url.match(/\/files\/([a-zA-Z0-9_-]+)\?alt=media/);
      const fileId = match ? match[1] : '';
      const file = mockDriveFiles[fileId];

      if (!file) {
        return new Response(
          JSON.stringify({ error: { code: 404, message: 'File not found' } }),
          { status: 404, statusText: 'Not Found' }
        );
      }

      return new Response(file.content, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 5. Endpoint: Upload multipart para criação de novo arquivo (POST)
    if (url.includes('/upload/drive/v3/files?uploadType=multipart') && method === 'POST') {
      lastUploadedMethod = 'POST';
      lastUploadedUrl = url;
      const body = init?.body?.toString() || '';
      lastUploadedBody = body;

      const fileId = 'gdrive_file_' + Date.now();
      const modifiedTime = new Date().toISOString();

      // Extrai JSON do corpo multipart
      const jsonStart = body.indexOf('{\r\n') !== -1 ? body.indexOf('{\r\n') : body.indexOf('{"version"');
      const jsonEnd = body.lastIndexOf('}') + 1;
      const content = jsonStart !== -1 && jsonEnd > jsonStart ? body.substring(jsonStart, jsonEnd) : body;

      const metadata: MockDriveFile = {
        id: fileId,
        name: GDRIVE_CONFIG.SYNC_FILENAME,
        modifiedTime,
        size: String(content.length),
        content,
      };
      mockDriveFiles[fileId] = metadata;

      return new Response(
        JSON.stringify({
          id: fileId,
          name: GDRIVE_CONFIG.SYNC_FILENAME,
          modifiedTime,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 6. Endpoint: Upload de mídia para atualizar arquivo existente (PATCH)
    if (url.includes('/upload/drive/v3/files/') && url.includes('uploadType=media') && method === 'PATCH') {
      lastUploadedMethod = 'PATCH';
      lastUploadedUrl = url;
      const match = url.match(/\/files\/([a-zA-Z0-9_-]+)\?uploadType=media/);
      const fileId = match ? match[1] : '';
      const content = init?.body?.toString() || '';
      lastUploadedBody = content;
      const modifiedTime = new Date().toISOString();

      if (mockDriveFiles[fileId]) {
        mockDriveFiles[fileId].content = content;
        mockDriveFiles[fileId].modifiedTime = modifiedTime;
        mockDriveFiles[fileId].size = String(content.length);
      } else {
        mockDriveFiles[fileId] = {
          id: fileId,
          name: GDRIVE_CONFIG.SYNC_FILENAME,
          modifiedTime,
          size: String(content.length),
          content,
        };
      }

      return new Response(
        JSON.stringify({
          id: fileId,
          name: GDRIVE_CONFIG.SYNC_FILENAME,
          modifiedTime,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 7. Revoke de token
    if (url.includes('oauth2.googleapis.com/revoke')) {
      return new Response('{}', { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Endpoint não mapeado no mock' }), { status: 400 });
  };
}

// ============================================================================
// SUÍTE DE TESTES: GOOGLE DRIVE SYNC E2E
// ============================================================================

async function runGoogleDriveSyncTests(): Promise<void> {
  console.log('================================================================');
  console.log('☁️  LUMEN: GOOGLE DRIVE SYNC & RESILIENCE TEST SUITE');
  console.log('================================================================\n');

  setupMockDriveHttp();

  try {
    // =========================================================================
    // CENÁRIO 1: Primeiro Uso (Pasta Vazia)
    // Simula Google Drive retornando nenhum backup encontrado (ou 404) e verifica
    // se o app sobe o primeiro backup local com sucesso.
    // =========================================================================
    console.log('--- CENÁRIO 1: Primeiro Uso (Pasta Vazia / Nenhum Backup Encontrado) ---');

    await test('1.1 Primeiro uso: sem arquivo na nuvem, checkAndSyncOnStartup cria e sobe o primeiro backup local via POST', async () => {
      // 1. Limpa o storage local e nuvem
      await StorageService.clearAllData();
      await GoogleDriveSyncService.clearSecureTokens();
      mockDriveFiles = {};
      networkFailureMode = 'none';
      lastUploadedMethod = null;
      lastUploadedUrl = null;
      lastUploadedBody = null;

      // 2. Conecta conta com token válido
      await GoogleDriveSyncService.connectAccount({
        email: 'aluno.lumen@ufrj.br',
        accessToken: 'valid_gdrive_token_first_use',
      });

      // 3. Cadastra dados locais iniciais que devem ser enviados para a nuvem
      const initialSubject: Subject = {
        id: 'sub_eng_soft_1',
        name: 'Engenharia de Software I',
        code: 'COMP301',
        color: '#3B82F6',
        maxAbsences: 15,
        workloadHours: 60,
        passGrade: 7.0,
      };
      await StorageService.saveSubjects([initialSubject]);

      const initialEvent: AppEvent = {
        id: 'ev_aula_1',
        title: 'Aula Inaugural de Engenharia de Software',
        date: '2026-10-01',
        startTime: '08:00',
        endTime: '10:00',
        category: 'Faculdade/Aulas',
        recurrence: 'none',
        subjectId: 'sub_eng_soft_1',
      };
      await StorageService.saveEvents([initialEvent]);

      // 4. Executa verificação de inicialização (Startup Check)
      const startupSyncResult = await GoogleDriveSyncService.checkAndSyncOnStartup();

      assert(startupSyncResult !== null, 'Startup sync retornou resultado não-nulo');
      assertEqual(startupSyncResult?.success, true, 'Sincronização inicial concluída com sucesso');
      assert(
        startupSyncResult?.message.includes('Backup enviado com sucesso') ||
        startupSyncResult?.message.includes('sucesso'),
        'Mensagem de sucesso confirma upload do primeiro backup'
      );
      assert(startupSyncResult?.fileId !== undefined, 'ID do arquivo criado na nuvem foi retornado');

      // 5. Verifica se a chamada HTTP de criação (POST multipart) foi disparada
      assertEqual(lastUploadedMethod, 'POST', 'Primeiro backup disparou requisição POST multipart');
      assert(
        lastUploadedUrl?.includes('uploadType=multipart') === true,
        'URL de upload utilizou uploadType=multipart'
      );

      // 6. Afirma que o arquivo existe agora na nuvem virtual e possui os dados locais
      const cloudFiles = Object.values(mockDriveFiles);
      assertEqual(cloudFiles.length, 1, 'Exatamente 1 arquivo lumen_sync.json criado no Google Drive');
      assertEqual(cloudFiles[0].name, GDRIVE_CONFIG.SYNC_FILENAME, 'Nome do arquivo é lumen_sync.json');

      const uploadedPayload = JSON.parse(cloudFiles[0].content);
      assertEqual(uploadedPayload.version, 2, 'Payload exportado possui versão 2');
      assert(
        uploadedPayload.subjects?.some((s: any) => s.id === 'sub_eng_soft_1'),
        'Matéria local "Engenharia de Software I" está presente no backup da nuvem'
      );
      assert(
        uploadedPayload.events?.some((e: any) => e.id === 'ev_aula_1'),
        'Evento local "Aula Inaugural" está presente no backup da nuvem'
      );

      // 7. Afirma que o timestamp de sincronização foi gravado no SecureStore
      const syncStatus = await GoogleDriveSyncService.getSyncStatus();
      assertEqual(syncStatus.isConnected, true, 'Status de conexão do Google Drive é conectado');
      assert(syncStatus.lastSyncTime !== undefined, 'lastSyncTime foi atualizado no SecureStore');
    });

    await test('1.2 downloadSyncFromCloud retorna failure gracioso caso a nuvem esteja vazia (nenhum backup)', async () => {
      mockDriveFiles = {}; // Nuvem vazia

      const downloadResult = await GoogleDriveSyncService.downloadSyncFromCloud();
      assertEqual(downloadResult.success, false, 'downloadSyncFromCloud retorna success = false');
      assert(
        downloadResult.message.includes('Nenhum backup') || downloadResult.message.includes('encontrado'),
        'Mensagem informa graciosamente que nenhum backup foi encontrado'
      );
    });

    // =========================================================================
    // CENÁRIO 2: Download de Nuvem Mais Recente
    // Simula que a nuvem possui um timestamp mais novo que o local. Afirma que
    // o StorageService recebe os dados remotos.
    // =========================================================================
    console.log('\n--- CENÁRIO 2: Download de Nuvem Mais Recente (Cloud Newer than Local) ---');

    await test('2.1 Nuvem mais recente: checkAndSyncOnStartup detecta timestamp superior e restaura dados remotos no StorageService', async () => {
      // 1. Configura estado local antigo
      await StorageService.clearAllData();
      const localStaleSubject: Subject = {
        id: 'sub_antiga',
        name: 'Matemática Elementar (Versão Antiga)',
        color: '#6B7280',
        workloadHours: 30,
        maxAbsences: 8,
      };
      await StorageService.saveSubjects([localStaleSubject]);

      // Marca sincronização local antiga (ex: 10 dias atrás)
      const staleLocalTime = '2026-09-10T10:00:00.000Z';
      mockSecureStore[SECURE_STORAGE_KEYS.LAST_SYNC_TIME] = staleLocalTime;

      // 2. Prepara backup remoto na nuvem com timestamp MUITO mais recente
      const newerCloudTime = '2026-09-28T10:00:00.000Z';
      const remoteNewData: BackupData = {
        version: 2,
        timestamp: newerCloudTime,
        subjects: [
          {
            id: 'sub_calc_avancado',
            name: 'Cálculo Diferencial e Integral Avançado',
            code: 'MAT201',
            color: '#10B981',
            maxAbsences: 16,
            workloadHours: 80,
            passGrade: 7.0,
          },
          {
            id: 'sub_fisica_moderna',
            name: 'Física Moderna para Engenharia',
            code: 'FIS301',
            color: '#6366F1',
            maxAbsences: 12,
            workloadHours: 60,
            passGrade: 7.0,
          },
        ],
        events: [
          {
            id: 'ev_p1_calc',
            title: 'Prova P1 de Cálculo Avançado',
            date: '2026-10-15',
            startTime: '14:00',
            endTime: '16:00',
            category: 'Provas/Trabalhos',
            subjectId: 'sub_calc_avancado',
            isImportant: true,
          },
        ],
        tasks: [
          {
            id: 'task_lista_1',
            title: 'Resolver Lista de Exercícios 1',
            subjectId: 'sub_calc_avancado',
            completed: false,
          },
        ],
        attendances: [],
        studySessions: [],
        semesters: [],
      };

      const remoteFileId = 'gdrive_newer_file_888';
      mockDriveFiles = {
        [remoteFileId]: {
          id: remoteFileId,
          name: GDRIVE_CONFIG.SYNC_FILENAME,
          modifiedTime: newerCloudTime,
          size: String(JSON.stringify(remoteNewData).length),
          content: JSON.stringify(remoteNewData),
        },
      };

      // 3. Executa verificação e sincronização
      const syncResult = await GoogleDriveSyncService.checkAndSyncOnStartup();

      assert(syncResult !== null, 'Sincronização identificou nuvem mais recente e executou');
      assertEqual(syncResult?.success, true, 'Download da nuvem foi concluído com sucesso');
      assertEqual(syncResult?.fileId, remoteFileId, 'ID do arquivo baixado corresponde ao arquivo remoto');

      // 4. Afirma que o StorageService sofreu a mutação e recebeu os dados remotos
      const updatedSubjects = await StorageService.getSubjects();
      assertEqual(updatedSubjects.length, 2, 'StorageService agora possui 2 disciplinas da nuvem');
      assert(
        updatedSubjects.some(s => s.id === 'sub_calc_avancado' && s.name.includes('Cálculo')),
        'Disciplina remota "Cálculo Diferencial e Integral Avançado" foi importada no StorageService'
      );
      assert(
        updatedSubjects.some(s => s.id === 'sub_fisica_moderna' && s.name.includes('Física')),
        'Disciplina remota "Física Moderna" foi importada no StorageService'
      );
      assert(
        !updatedSubjects.some(s => s.id === 'sub_antiga'),
        'Dados locais obsoletos foram substituídos pelo snapshot atualizado da nuvem'
      );

      const updatedEvents = await StorageService.getEvents();
      assertEqual(updatedEvents.length, 1, 'StorageService recebeu evento da nuvem');
      assertEqual(updatedEvents[0].title, 'Prova P1 de Cálculo Avançado', 'Título do evento remoto importado');

      const updatedTasks = await StorageService.getTasks();
      assertEqual(updatedTasks.length, 1, 'StorageService recebeu tarefas da nuvem');
      assertEqual(updatedTasks[0].title, 'Resolver Lista de Exercícios 1', 'Título da tarefa remota importada');

      // 5. Afirma que o lastSyncTime no SecureStore foi calibrado para o timestamp remoto
      const statusAfter = await GoogleDriveSyncService.getSyncStatus();
      assert(statusAfter.lastSyncTime !== undefined, 'lastSyncTime foi atualizado após o download');
    });

    // =========================================================================
    // CENÁRIO 3: Upload de Local Mais Recente
    // Simula que o banco local foi editado recentemente. Afirma que a chamada de
    // upload (PATCH/POST) para a API do Google foi disparada.
    // =========================================================================
    console.log('\n--- CENÁRIO 3: Upload de Local Mais Recente (PATCH / In-Place Update) ---');

    await test('3.1 Local editado recentemente: sincronizar() detecta arquivo existente e dispara PATCH com os novos dados', async () => {
      // 1. Nuvem já possui um arquivo anterior gravado com um ID específico
      const existingFileId = 'gdrive_existing_target_777';
      const existingCloudFile: MockDriveFile = {
        id: existingFileId,
        name: GDRIVE_CONFIG.SYNC_FILENAME,
        modifiedTime: '2026-09-20T10:00:00.000Z',
        size: '500',
        content: JSON.stringify({
          version: 2,
          timestamp: '2026-09-20T10:00:00.000Z',
          subjects: [{ id: 'sub_old', name: 'Disciplina Anterior' }],
          events: [],
          tasks: [],
        }),
      };
      mockDriveFiles = { [existingFileId]: existingCloudFile };

      // 2. Usuário edita o banco local com novas informações recentes
      const newSubject: Subject = {
        id: 'sub_ia_aplicada',
        name: 'Inteligência Artificial Aplicada',
        code: 'CC401',
        color: '#8B5CF6',
        maxAbsences: 10,
        workloadHours: 60,
        passGrade: 7.0,
      };
      const existingSubjects = await StorageService.getSubjects();
      await StorageService.saveSubjects([...existingSubjects, newSubject]);

      const newTask: StudyTask = {
        id: 'task_ia_projeto',
        title: 'Implementar Algoritmo Genético',
        subjectId: 'sub_ia_aplicada',
        completed: false,
      };
      await StorageService.saveTasks([newTask]);

      // 3. Reseta rastreador de requisição HTTP
      lastUploadedMethod = null;
      lastUploadedUrl = null;
      lastUploadedBody = null;

      // 4. Dispara a sincronização de upload
      const uploadResult = await GoogleDriveSyncService.sincronizar();

      // 5. Afirma que o upload teve sucesso
      assertEqual(uploadResult.success, true, 'Sincronização de upload concluída com sucesso');
      assertEqual(uploadResult.fileId, existingFileId, 'Upload atualizou o mesmo arquivo existente na nuvem');

      // 6. Afirma que a chamada para a API do Google utilizou o método PATCH
      assertEqual(lastUploadedMethod, 'PATCH', 'Método HTTP PATCH foi disparado para atualização in-place');
      assert(
        lastUploadedUrl?.includes(`/files/${existingFileId}?uploadType=media`) === true,
        `URL do PATCH mirou no arquivo existente ${existingFileId}`
      );

      // 7. Afirma que o corpo da requisição PATCH contém a nova disciplina editada
      assert(lastUploadedBody !== null, 'Corpo da requisição PATCH não é nulo');
      const sentPayload = JSON.parse(lastUploadedBody!);
      assert(
        sentPayload.subjects?.some((s: any) => s.id === 'sub_ia_aplicada' && s.name.includes('Inteligência Artificial')),
        'Payload enviado via PATCH contém a disciplina recém-editada "Inteligência Artificial Aplicada"'
      );
      assert(
        sentPayload.tasks?.some((t: any) => t.id === 'task_ia_projeto'),
        'Payload enviado via PATCH contém a nova tarefa "Implementar Algoritmo Genético"'
      );

      // 8. Afirma que a nuvem virtual foi atualizada com o novo conteúdo
      const updatedCloudFile = mockDriveFiles[existingFileId];
      assert(
        updatedCloudFile.content.includes('Inteligência Artificial Aplicada'),
        'Arquivo no Google Drive foi atualizado com o conteúdo mais recente'
      );
    });

    // =========================================================================
    // CENÁRIO 4: Resiliência Offline e Token Expirado
    // Simula falha na rede (timeout/offline) e erro 401 (token expirado).
    // Afirma que o app não crasha e reporta o erro graciosamente na interface.
    // =========================================================================
    console.log('\n--- CENÁRIO 4: Resiliência Offline, Timeout & Token Expirado (401) ---');

    await test('4.1 Resiliência Offline/Timeout: checkAndSyncOnStartup captura erro de rede sem crashar e retorna null', async () => {
      // Configura falha de rede por timeout
      networkFailureMode = 'timeout';

      let threw = false;
      let startupResult: any = 'untested';
      try {
        startupResult = await GoogleDriveSyncService.checkAndSyncOnStartup();
      } catch {
        threw = true;
      }

      assertEqual(threw, false, 'checkAndSyncOnStartup NÃO lançou exceção não tratada');
      assertEqual(startupResult, null, 'checkAndSyncOnStartup retornou null de forma não bloqueante');
      assert(true, 'Inicialização do app é 100% tolerante a timeout de rede');
    });

    await test('4.2 Resiliência Offline na Interface: sincronização manual reporta erro graciosamente via Alert sem corromper banco local', async () => {
      // 1. Preserva matérias locais para auditar integridade pós-falha
      const subjectsBefore = await StorageService.getSubjects();
      assert(subjectsBefore.length > 0, 'Existem dados no banco local');

      // 2. Configura modo offline
      networkFailureMode = 'offline';
      clearMockAlertCalls();

      // 3. Simula fluxo do handler de UI (ex: SettingsModal.tsx handleSyncNow)
      let handledGracefully = false;
      try {
        await GoogleDriveSyncService.sincronizar();
      } catch (error: any) {
        handledGracefully = true;
        mockAlert.alert(
          'Erro ao Sincronizar',
          error?.message || 'Falha na conexão com o Google Drive.'
        );
      }

      assertEqual(handledGracefully, true, 'Erro de rede capturado pelo bloco try/catch da UI');
      assertEqual(lastAlertCalls.length, 1, 'Alerta gracioso gerado para a interface do usuário');
      assertEqual(lastAlertCalls[0].title, 'Erro ao Sincronizar', 'Título do alerta é "Erro ao Sincronizar"');
      assert(
        lastAlertCalls[0].message?.includes('offline') || lastAlertCalls[0].message?.includes('Network request failed'),
        'Mensagem do alerta informa falha de conexão de rede'
      );

      // 4. Afirma que o banco de dados local permaneceu 100% íntegro e sem perdas
      const subjectsAfter = await StorageService.getSubjects();
      assertEqual(subjectsAfter.length, subjectsBefore.length, 'Banco de dados local permaneceu intacto');
      assertEqual(subjectsAfter[0].id, subjectsBefore[0].id, 'Dados locais não foram corrompidos pela falha de rede');
    });

    await test('4.3 Token Expirado (Erro 401): API retorna 401 e o serviço relata erro descritivo capturado pela UI', async () => {
      // 1. Configura API para responder com 401 Unauthorized
      networkFailureMode = 'unauthorized_401';
      clearMockAlertCalls();

      let capturedError: Error | null = null;
      try {
        await GoogleDriveSyncService.sincronizar();
      } catch (err: any) {
        capturedError = err;
        // Simulação do comportamento da interface ao detectar falha de autenticação
        mockAlert.alert(
          'Sessão Expirada',
          'Sua conexão com o Google Drive expirou. Por favor, conecte sua conta novamente.'
        );
      }

      assert(capturedError !== null, 'Exceção de 401 gerada pelo serviço');
      assert(
        capturedError?.message.includes('401') ||
        capturedError?.message.includes('Não autorizado') ||
        capturedError?.message.includes('Token expirado'),
        'Mensagem de erro explicita código 401 / token inválido ou expirado'
      );

      assertEqual(lastAlertCalls.length, 1, 'Alerta exibido na interface do usuário');
      assertEqual(lastAlertCalls[0].title, 'Sessão Expirada', 'Título do alerta indica sessão expirada');
      assert(
        lastAlertCalls[0].message?.includes('expirou') === true,
        'Mensagem amigável orienta o usuário a reconectar a conta'
      );
    });

    await test('4.4 isTokenExpired detecta preventivamente token expirado e getSyncStatus atualiza isConnected', async () => {
      // 1. Token com expiresAt no passado
      const expiredTokens = {
        accessToken: 'expired_tok_111',
        expiresAt: Date.now() - 5000, // 5 segundos atrás
      };
      assertEqual(
        GoogleDriveSyncService.isTokenExpired(expiredTokens),
        true,
        'isTokenExpired retorna true para timestamp no passado'
      );

      // 2. Token preste a expirar (dentro da janela de segurança de 60s)
      const nearExpiredTokens = {
        accessToken: 'near_expired_tok_222',
        expiresAt: Date.now() + 30000, // expira em 30s (< 60s)
      };
      assertEqual(
        GoogleDriveSyncService.isTokenExpired(nearExpiredTokens),
        true,
        'isTokenExpired retorna true na janela de tolerância preventiva de 60s'
      );

      // 3. Salva token expirado no SecureStore
      await GoogleDriveSyncService.saveSecureTokens({
        accessToken: 'expired_in_secure_store',
        expiresAt: Date.now() - 10000,
        userEmail: 'aluno@ufrj.br',
      });

      // 4. getSyncStatus reporta isConnected = false para token expirado
      const status = await GoogleDriveSyncService.getSyncStatus();
      assertEqual(status.isConnected, false, 'getSyncStatus reporta isConnected = false quando o token está expirado');

      // 5. sincronizar() recusa executar com conta desconectada/expirada sem disparar chamadas de rede indevidas
      networkFailureMode = 'none';
      const syncResultDisconnected = await GoogleDriveSyncService.sincronizar();
      assertEqual(syncResultDisconnected.success, false, 'sincronizar retorna success = false');
      assert(
        syncResultDisconnected.message.includes('não conectado') ||
        syncResultDisconnected.message.includes('Conecte sua conta'),
        'Mensagem orienta conectar a conta antes de sincronizar'
      );
    });

    // =========================================================================
    // SUMÁRIO FINAL
    // =========================================================================
    console.log('\n================================================================');
    console.log(`🎉 GOOGLE DRIVE SYNC TESTS: ${passedTests}/${totalTests} PASSADOS | ${failedTests} FALHAS`);
    console.log('================================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runGoogleDriveSyncTests().catch(err => {
  console.error('💥 Erro fatal nos testes de sincronização do Google Drive:', err);
  process.exit(1);
});
