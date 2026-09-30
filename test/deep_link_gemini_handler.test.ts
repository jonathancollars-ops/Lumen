import './setup_env';
import fs from 'fs';
import path from 'path';
import {
  handleGeminiDeepLink,
  extractStringParam
} from '../src/hooks/useDeepLinkHandler';
import { StorageService } from '../src/services/storage';
import { Subject } from '../src/types';
import { lastAlertCalls } from './setup_env';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ' -> ' + detail : ''}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🔗 LUMEN: DEEP LINK & ANDROID APP ACTIONS HANDLER TESTS');
  console.log('================================================================\n');

  // 1. Limpa Storage e Alertas
  await StorageService.clearAllData();
  lastAlertCalls.length = 0;

  const mockSubjects: Subject[] = [
    {
      id: 'sub_calc_1',
      name: 'Cálculo Diferencial e Integral I',
      code: 'MAT101',
      color: '#3B82F6',
      maxAbsences: 15,
      workloadHours: 60,
      passGrade: 7.0,
      gradeGroups: []
    },
    {
      id: 'sub_fis_1',
      name: 'Física Experimental I',
      code: 'FIS101',
      color: '#10B981',
      maxAbsences: 10,
      workloadHours: 45,
      passGrade: 6.0,
      gradeGroups: []
    }
  ];
  await StorageService.saveSubjects(mockSubjects);

  console.log('--- 1. Testes de Extração e Normalização de Parâmetros ---');
  const params = {
    title: '  Prova Final de Álgebra  ',
    type: 'EXAM',
    date: '2026-11-20'
  };
  assert(
    extractStringParam(params, ['titulo', 'title', 'nome']) === 'Prova Final de Álgebra',
    'Extrai alias em inglês e remove espaços em branco'
  );
  assert(
    extractStringParam(params, ['inexistente', 'outra']) === '',
    'Retorna string vazia para chaves ausentes'
  );

  console.log('\n--- 2. Rota de Criação de Evento (actions.intent.CREATE_EVENT) ---');
  lastAlertCalls.length = 0;
  let actionCallbackFired = false;

  const eventResult = await handleGeminiDeepLink(
    'lumen://gemini/adicionar_evento?titulo=P1%20de%20C%C3%A1lculo&tipo=prova&data=2026-10-15',
    {
      onActionExecuted: () => {
        actionCallbackFired = true;
      }
    }
  );

  assert(eventResult.handled === true, 'Deep link adicionar_evento manipulado com sucesso');
  assert(eventResult.action === 'adicionar_evento', 'Identifica ação adicionar_evento');
  assert(eventResult.result?.success === true, 'Ação do GeminiIntegrationService executou com sucesso');
  assert(actionCallbackFired === true, 'Callback onActionExecuted disparado');
  assert(lastAlertCalls.length > 0, 'Alerta nativo exibido ao usuário');
  assert(
    lastAlertCalls[lastAlertCalls.length - 1].title === 'Gemini App Action',
    'Título do alerta é Gemini App Action'
  );

  const storedEvents = await StorageService.getEvents();
  assert(
    storedEvents.some(e => e.title.includes('Cálculo') && e.category === 'Provas/Trabalhos'),
    'Evento persistido corretamente no banco local com categoria Provas/Trabalhos'
  );

  // Teste de criação de trabalho com alias em inglês
  const workResult = await handleGeminiDeepLink(
    'lumen://gemini/create_event?title=Relat%C3%B3rio%20de%20F%C3%ADsica&type=assignment'
  );
  assert(workResult.handled === true, 'Deep link com alias create_event manipulado');
  const updatedEvents = await StorageService.getEvents();
  assert(
    updatedEvents.some(e => e.title.includes('Relatório') && e.category === 'Provas/Trabalhos'),
    'Trabalho cadastrado via alias com categoria correta'
  );

  console.log('\n--- 3. Rota de Faltas e Presenças (custom.actions.intent.RECORD_ATTENDANCE) ---');
  lastAlertCalls.length = 0;
  const absenceResult = await handleGeminiDeepLink(
    'lumen://gemini/marcar_falta?materia=C%C3%A1lculo&tipo=falta&data=2026-10-10'
  );
  assert(absenceResult.handled === true, 'Deep link marcar_falta manipulado');
  assert(absenceResult.result?.success === true, 'Falta registrada com sucesso na matéria fuzzy');

  const attendances = await StorageService.getAttendances();
  assert(
    attendances.some(a => a.subjectId === 'sub_calc_1' && a.status === 'absent'),
    'Registro de falta persistido no StorageService com status absent'
  );

  // Presença via rota direta
  const presenceResult = await handleGeminiDeepLink(
    'lumen://gemini/registrar_presenca?materia=F%C3%ADsica'
  );
  assert(presenceResult.handled === true, 'Deep link registrar_presenca manipulado');
  const attendancesAfterPres = await StorageService.getAttendances();
  assert(
    attendancesAfterPres.some(a => a.subjectId === 'sub_fis_1' && a.status === 'present'),
    'Registro de presença persistido com status present'
  );

  console.log('\n--- 4. Rota de Consulta de Agenda & Status ---');
  lastAlertCalls.length = 0;
  const agendaResult = await handleGeminiDeepLink('lumen://gemini/consultar_agenda');
  assert(agendaResult.handled === true, 'Deep link consultar_agenda manipulado');
  assert(
    lastAlertCalls.some(c => c.title.includes('Agenda')),
    'Alerta de agenda exibido'
  );

  const statusResult = await handleGeminiDeepLink('lumen://gemini/status_geral');
  assert(statusResult.handled === true, 'Deep link status_geral manipulado');
  assert(
    lastAlertCalls.some(c => c.title.includes('Status')),
    'Alerta de status exibido'
  );

  console.log('\n--- 5. Tratamento de Erros, Validação de Esquema e Fallbacks ---');
  // Esquema incorreto
  const invalidSchemeResult = await handleGeminiDeepLink('https://example.com/gemini/adicionar_evento');
  assert(invalidSchemeResult.handled === false, 'Ignora esquemas que não sejam lumen://');

  // Ação desconhecida
  lastAlertCalls.length = 0;
  const unknownActionResult = await handleGeminiDeepLink('lumen://gemini/acao_fantasma');
  assert(unknownActionResult.handled === false, 'Retorna handled: false para ações desconhecidas');

  // showAlert: false não exibe alerta
  lastAlertCalls.length = 0;
  await handleGeminiDeepLink('lumen://gemini/consultar_agenda', { showAlert: false });
  assert(lastAlertCalls.length === 0, 'Opção showAlert: false suprime alertas na tela');

  console.log('\n--- 6. Verificação de Arquivos Nativos do Android e Configurações ---');
  const projectRoot = path.resolve(__dirname, '..');

  // 1. Verifica Config Plugin do Expo
  const pluginPath = path.join(projectRoot, 'plugins/withAppActions.js');
  assert(fs.existsSync(pluginPath), 'Expo Config Plugin (withAppActions.js) foi criado para injetar shortcuts');
  const pluginContent = fs.readFileSync(pluginPath, 'utf8');
  assert(pluginContent.includes('actions.intent.CREATE_EVENT'), 'Plugin injeta BII CREATE_EVENT');
  assert(pluginContent.includes('custom.actions.intent.RECORD_ATTENDANCE'), 'Plugin injeta BII RECORD_ATTENDANCE');

  // 2. Verifica app.json 
  const appJsonPath = path.join(projectRoot, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const hasLumenScheme =
    appJson.expo.scheme === 'lumen' ||
    (Array.isArray(appJson.expo.scheme) && appJson.expo.scheme.includes('lumen'));
  assert(hasLumenScheme, 'app.json possui expo.scheme contendo "lumen"');

  console.log('\n================================================================');
  console.log(`🎉 TESTES CONCLUÍDOS: ${passed} PASSADOS | ${failed} FALHAS`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('💥 Erro fatal no executor de testes:', err);
  process.exit(1);
});
