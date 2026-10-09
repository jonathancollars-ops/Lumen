# 📜 Histórico de Versões & Changelog — Lumen

Todas as alterações notáveis deste projeto serão documentadas neste arquivo.
O formato é baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico (SemVer)](https://semver.org/lang/pt-BR/).

---

## 🏷️ Regras de Versionamento Semântico
- **Patch (+0.0.1, ex: 3.1.1)**: Correções de bugs, ajustes de layout/CSS, pequenas melhorias de estabilidade.
- **Minor (+0.1.0, ex: 3.2.0)**: Novos recursos, novas telas, funcionalidades adicionais sem quebra de compatibilidade. (Zera o patch).
- **Major (+1.0.0, ex: 4.0.0)**: Grandes reformulações de arquitetura, redesign completo ou mudanças estruturais profundas. (Zera minor e patch).

## [3.7.7] - 2026-10-08
### Atualização automática no Windows
- Alinha a versão incorporada nos aplicativos Android e Windows em 3.7.7 e incrementa o código de versão do Android.
- Publica os instaladores das duas plataformas na mesma release oficial, com uma tag igual à versão instalada. Bloqueia a republicação de pacotes com o mesmo número de versão e verifica a consistência dos arquivos de configuração.
- Verifica atualizações também ao retomar o app, recuperar a conexão e durante sessões longas. Falhas de rede podem ser tentadas novamente sem esperar três horas.
- Procura um instalador compatível quando a release mais recente ainda tem apenas o pacote da outra plataforma. Prioriza setup/MSI e evita usar o executável portátil como instalador.
- A opção de lembrar depois adia o aviso por 24 horas; uma versão mais nova pode ser anunciada imediatamente.

### Notificações no Android
- Restaura a criação do canal e a solicitação de permissão para notificações.
- Recupera e rearma os lembretes salvos ao abrir ou retomar o app e depois da sincronização. Atualizações, edições e exclusões usam os mesmos identificadores para evitar alertas duplicados.
- Agenda os avisos de aulas em todos os dias selecionados, incluindo lembretes no dia anterior.
- Agenda a confirmação de presença um minuto após a aula e abre a aba de frequência ao tocar na notificação. Prepara as próximas duas semanas e renova esse período ao retomar o app; presenças, faltas e cancelamentos já registrados removem o aviso correspondente.
- Remove alertas de eventos desativados e de matérias arquivadas ou excluídas, preservando o aviso do Pomodoro.

## [3.7.6] - 2026-09-30
### Sincronização Android/Windows e interface adaptável
- Envia e recebe alterações automaticamente pelo Firebase usando a mesma conta Google nos dois dispositivos.
- Mescla a rotina existente por registro, preserva edições durante envios e propaga exclusões. Inclui AACC, projetos em grupo e histórico/CR.
- Mantém as alterações locais sem internet, tenta novamente ao reconectar e mostra o estado da sincronização nas configurações.
- Corrige o espaço duplicado do menu lateral e adapta as colunas, a rolagem e os formulários ao tamanho da janela.
- Preserva a cor do tema nas laterais dos formulários centralizados de configurações e matérias.

## [3.7.5] - 2026-09-30
### Sincronização automática e interface desktop
- Corrige a leitura dos backups antigos do Firebase e sincroniza automaticamente Android e Windows pela mesma conta Google.
- Mescla alterações por registro e campo em transações, preserva edições durante envios e propaga exclusões sem recriar registros antigos.
- Mantém alterações locais enquanto não há conexão e tenta sincronizar novamente. Exibe falhas de acesso ou rede nas configurações.
- Inclui AACC, projetos em grupo e histórico/CR; as credenciais de IA continuam locais.
- Faz o botão “Sincronizar Agora” enviar e receber dados de verdade.
- Corrige o espaço duplicado do menu lateral, adapta as colunas à largura útil, permite rolar o menu em janelas baixas e limita a largura dos formulários no desktop.
- Adiciona testes de sincronização entre dois dispositivos, migração, conflitos, exclusões e proteção contra falhas de armazenamento.

## [3.7.4] - 2026-09-30
### Login Google nativo no Windows
- Implementa e registra o servidor local de retorno da autenticação no aplicativo Windows e a abertura do navegador padrão pelo componente nativo.
- Usa um cliente OAuth específico para desktop, PKCE e validação do estado de cada tentativa. A troca de tokens ocorre em Rust e a conta é autenticada no Firebase para a sincronização existente.
- Encerra o listener após sucesso, erro ou tempo limite, permitindo uma nova tentativa sem aproveitar respostas antigas.
- Adiciona testes do fluxo desktop e testes nativos com conexões HTTP reais ao servidor local.
- Configura o cliente OAuth de desktop no instalador distribuído pelo GitHub. O login com uma conta Google real deve ser confirmado após a instalação.
- Preserva o fluxo de login Android da 3.7.3, já confirmado em aparelho pelo usuário.

## [3.7.3] - 2026-09-30
### Retorno do Google no Android e diagnóstico no Windows
- Captura o endereço de retorno do Google antes de abrir o navegador e aguarda brevemente o deep link quando o Android sinaliza retorno ao app antes de entregar a resposta da autenticação.
- Compara o esquema do endereço sem diferenciar maiúsculas e minúsculas, mantendo a validação do caminho e do estado OAuth pela requisição original.
- Diferencia retorno sem resposta de cancelamento manual e remove os listeners após sucesso, falha ou tempo limite.
- Mostra a etapa e o código de falha diretamente na tela do Windows, inclusive quando os comandos nativos necessários ao login estão indisponíveis. O login nativo do Windows ainda depende da implementação desses comandos e da configuração OAuth adequada.
- O ajuste do retorno Android foi validado em testes automatizados; a confirmação de login em um aparelho real continua pendente.

## [3.7.2] - 2026-09-30
### Diagnóstico do login Google no Android
- Mostra a etapa atual da conexão e diferencia falhas no retorno do navegador, na validação da resposta do Google e na autenticação no Firebase.
- Encerra a espera após 90 segundos no navegador e 30 segundos nas etapas de validação e autenticação, com mensagem e código da etapa.
- Trata explicitamente erros na troca do código de autorização, cancelamentos e sessões de login já abertas. Permite uma nova tentativa sem manter o botão preso em carregamento.
- Confirma o sucesso do login e mantém o estado da conta atualizado. Os diagnósticos não incluem tokens, senhas ou dados pessoais.
- Esta versão ajuda a identificar a causa do login que não conclui; não confirma a correção da configuração OAuth do Google.

## [3.7.1] - 2026-09-30
### 🔑 Correção de Autenticação Google no Android & Página de Releases Limpa
- **Redirecionamento OAuth no Android:** Registro dos esquemas de URI `com.jothacsf.organiza` (minúsculo) e `com.jothacsf.Organiza` no `AndroidManifest.xml` via Config Plugin (`withAppActions`), eliminando o redirecionamento indevido para a busca do Google e capturando o token com sucesso.
- **Fechamento Automático de Janela:** Ativação de `WebBrowser.maybeCompleteAuthSession()` na raiz da aplicação (`App.tsx`), fechando a aba de autenticação assim que o login for aprovado.
- **Página de Releases Otimizada:** As notas de atualização agora exibem apenas as novidades da versão instalada, com os arquivos de download logo abaixo do resumo sem necessidade de rolagem excessiva.

---

## [3.7.0] - 2026-09-29
### ☁️ Sincronização em Nuvem Oficial via Firebase Firestore & Resiliência
- **Sincronização com Firebase Firestore:** Substituição do Google Drive pelo Firestore (`users/{uid}/backup/latest`), com Last-Write-Wins, debouncing de 5 segundos e sincronização offline-first contínua.
- **Multi-plataforma Unificada:** Autenticação Google via `expo-auth-session` no Android e PKCE loopback server com `tauri-plugin-shell` no Windows Desktop.
- **Correção de Cold Start:** Adicionados IDs de cliente Google de fallback no `GoogleAuthService`, impedindo crashes em inicializações a frio.

---

## [3.6.1] - 2026-09-28
### 🖥️ Lumen Desktop para Windows (.exe) & Correção de OAuth Google
- **Lumen para Windows:** Suporte oficial a desktop nativo via Tauri v2 (`src-tauri`), com janela dedicada de 1200x800, suporte a temas e instaladores `.exe` e `.msi`.
- **Layout Responsivo:** Barra lateral (Sidebar) elegante em telas largas (monitores e notebooks > 1024px) e redimensionamento proporcional do cronômetro de estudo e agenda.
- **Autenticação Real OAuth2 (Fim do erro 401):** Implementado fluxo real via `expo-auth-session` no mobile e OAuth Web/Desktop via popup/redirect, com campo para inserção opcional de Google Client ID personalizado nas configurações.
- **CI/CD para Windows:** Novo workflow do GitHub Actions (`build-windows.yml`) que compila e empacota automaticamente o instalador `.exe` e `.msi` para Windows.

---

## [3.6.0] - 2026-09-28
### ☁️ Sincronização em Nuvem (Google Drive - Fase 1)
- **Google Drive Sync:** Integração com a Google Drive REST API v3 utilizando a pasta isolada `appDataFolder` do próprio usuário, sem custos e sem necessidade de banco de dados centralizado.
- **Autenticação Segura:** Fluxo OAuth2 com escopo estrito (`drive.appdata`) e armazenamento criptografado de tokens via `expo-secure-store`.
- **Sincronização com Debounce:** Motor de sincronização automático que detecta alterações locais (matérias, eventos, notas, faltas) e envia para a nuvem de forma silenciosa e resiliente com debounce de 5s.
- **Interface de Ajustes:** Nova seção no `SettingsModal` com status visual da última sincronização, conexão/desconexão e sincronização manual.

---

## [3.5.2] - 2026-09-27
### 🐛 Correções e Melhorias na Agenda
- **Tratamento de Erros:** Adicionado alerta visual quando ocorre uma falha ao salvar um evento.
- **Data Locked:** Melhorada a lógica de edição de eventos para não travar a data quando o usuário está editando um evento existente.
- **Ordenação:** Corrigida a ordenação cronológica de eventos (utilizando minutos) e a lógica de duração de blocos que cruzam a meia-noite no schedule planner.
- **Testes e Gamificação:** Suporte a novos campos de estado no AppContext (semestre atual, streaks, achievements) e adição de testes robustos (agenda edit regressions e mocks aprimorados de UI).

---

## [3.5.1] - 2026-09-14
### 🐛 Correções e Melhorias
- **Cronômetro e Pomodoro:** Corrigido o problema onde o tempo de estudo era perdido ao fechar o aplicativo ou deixá-lo em segundo plano. Implementada arquitetura de persistência (*Timestamp Diff*) e sincronização com o ciclo de vida do app.
- **Testes Automatizados:** Adicionadas suítes completas de testes para cobrir o ciclo de vida e garantir que contadores de tempo nunca regridam.

---

## [3.5.0] - 2026-09-13
### ✨ Integração Nativa com App Oficial do Gemini (App Actions)
- **Controle por Voz via Gemini:** Integração com Android App Actions e Deep Links. Agora o aplicativo oficial do Gemini pode controlar o Lumen de fora do app.
- **Registro Simplificado:** Comandos como "Lumen, marcar falta em Cálculo" são interceptados silenciosamente via URL e registrados automaticamente no banco de dados.
- **Camada de Segurança Fortalecida:** Novo serviço e validações (Zod/Sanitization) para garantir que comandos executados externamente sejam 100% seguros.

---

## [3.4.2] - 2026-09-12
### 🤖 Migração para Google Gemini 3.6 Flash
- **Suporte ao Gemini 3.6 Flash:** Atualização do motor de IA para `gemini-3.6-flash`, solucionando o erro de descontinuação do `gemini-2.5-flash` para novas contas da API Google AI Studio.
- **Auto-migração Dupla:** Migração automática de configurações antigas com modelos `1.5` ou `2.5` para `gemini-3.6-flash` na inicialização do app.
- **Fallback Resiliente Atualizado:** Sistema de retry inteligente aponta para `gemini-3.6-flash` como modelo de último recurso em todos os fluxos de PDF e parsing de mensagem.

---

## [3.4.1] - 2026-09-12
### 🤖 Migração para Google Gemini 2.5 Flash
- **Suporte ao Gemini 2.5 Flash:** Atualização do motor de IA para o novo modelo padrão multiraciocínio `gemini-2.5-flash` na API v1beta do Google AI Studio, solucionando o erro 404 de descontinuação do `gemini-1.5-flash`.
- **Auto-migração de Configurações:** Migração automática e transparente de chaves e configurações antigas de usuários salvos em storage local do `1.5` para o `2.5`.
- **Fallback Resiliente:** Sistema de retry inteligente caso um endpoint de modelo retorne indisponibilidade ou modelo não encontrado.

### 🔄 Motor de Atualizações & Download Direto do Instalador
- **Detecção de Builds SemVer:** Atualização de versão para 3.4.1 garantindo detecção imediata de novas versões no GitHub Releases para usuários na 3.4.0.
- **Botão Direto de Download do APK:** Novo atalho em Configurações (`🌐 Baixar APK via GitHub`) para download direto no navegador, garantindo fail-safe absoluto contra problemas de rede ou assinaturas.
- **Hermes Universal AbortSignal:** Resolução completa do erro de timeout com `getTimeoutSignal` em leitura pesada de PDFs acadêmicos.

---

## [3.4.0] - 2026-09-09
### 🏆 Gamificação Avançada & Coleta de XP (Novo Recurso)
- **Expansão para 50 Níveis Acadêmicos:** Progressão curricular com novas patentes de honra (de Calouro a Lenda Acadêmica Suprema).
- **Coleta Interativa de Experiência:** Botões táteis `✨ Coletar +{ach.xp} XP` em medalhas desbloqueadas e botão `🎁 Resgatar Tudo` no topo da lista.

### ⏱️ Pomodoro e Cronômetro Resilientes (Segundo Plano & Abas)
- **Arquitetura Baseada em Timers Unix:** Timers continuam rodando sem perda de contagem ao navegar entre abas ou minimizar o app (`AppState = background`).
- **Notificações Nativas de Conclusão:** Agendamento local automático para alertar o estudante exatamente no término do Pomodoro.

### 🌊 Gestos Fluidos & Navegação 120 Hz (`SwipeableTabContainer`)
- **Swipe Lateral com Driver Nativo:** Transição horizontal suave entre as 5 abas principais (`Agenda ↔ Estudos ↔ Desempenho ↔ Faltas ↔ Notas`) executada a 120 Hz na RenderThread do Android.

### 🛡️ Transição de Chave Oficial & Proteção Contra Conflito de Pacotes
- **Card de Orientação e Exportação de Dados (`AppUpdateModal`):** Instruções claras sobre a assinatura de produção oficial (30 anos) com botão direto de `💾 Exportar Backup dos Meus Dados` para evitar conflito de pacotes no Android.

### 🧹 Reconciliação da Matriz Curricular no Desempenho
- **Purga de Matérias Excluídas:** Sincronização automática e botão de limpeza que elimina disciplinas apagadas da grade curricular ativa.

---

## [3.3.1] - 2026-09-03
### 🕒 Relógio Interativo & Recorrência Avançada (Novos Recursos)
- **Relógio Interativo Radial & Digital (`ClockTimePickerModal`):** Substituição completa dos sliders imprecisos de hora por um mostrador touch de relógio com alternador de horas (12/24h) e minutos, presets rápidos (`08:00`, `10:00`, `14:00`, etc.) e resposta háptica.
- **Recorrência em Intervalos Maiores:** Agora é possível agendar eventos que se repetem a cada quantidade customizada de tempo (ex: a cada 6 meses todo dia 10, bimestral todo dia 15, trimestral), com projeção e marcação precisa na Agenda e no Calendário.

### 🏖️ Planejador Estratégico de Faltas (Novo Recurso)
- **Simulador Preditivo "Posso Faltar?":** Novo botão no cabeçalho da aba de Faltas que projeta o impacto futuro de ausências antes de você faltar.
- **Simulação por Data com Mapeamento Completo:** Escolha uma data (ex: próxima Sexta-feira) e veja o impacto em todas as matérias daquele dia, com taxas projetadas de presença (%) e veredito inteligente (🟢 Seguro, 🟡 Atenção, 🔴 Perigo).
- **Detecção de Provas na Mesma Semana:** Alerta inteligente avisando caso você esteja simulando faltar em uma semana que possui prova marcada na mesma disciplina.
- **Simulador Interativo por Matéria:** Ajuste faltas adicionais (`+1`, `+2`, `+3`) com barra de progresso colorida e feedback tátil em tempo real.

### 🩹 Correções & Melhorias de Estabilidade (Fixes)
- **Instalação Real de Atualizações no Android:** Inclusão da flag obrigatória `FLAG_ACTIVITY_NEW_TASK` (`268435456`) no `IntentLauncher`, permitindo que o instalador nativo do sistema execute e substitua o aplicativo sem fechar sozinho.
- **Controle de Alertas de Atualização:** Adicionado cooldown inteligente de 24h para que o modal de nova versão não interrompa o usuário a cada abertura do aplicativo se já foi visualizado hoje.
- **Exclusão de Matérias em Cascata:** Agora ao excluir uma disciplina ela é removida imediatamente das telas de Faltas e Notas, e seus eventos e registros de presença vinculados são limpos atomicamente do banco local.
- **Filtro de Disciplinas Ativas:** As telas de Faltas e Notas agora filtram estritamente matérias ativas, ocultando disciplinas arquivadas.
- **Contraste e Visibilidade Visual (A11y):** Correção de caixas de texto e chips de categorias com texto invisível, garantindo contraste WCAG AA (`getContrastTextColor`) em todos os temas (Light, Dark e AMOLED).
- **Detecção Inteligente de Releases do GitHub:** O comparador de versões foi aprimorado para suportar tags com sufixo de build (`-build-XX`), garantindo que o atualizador in-app detecte imediatamente novas versões publicadas.

## [3.3.0] - 2026-08-28
### 🚀 Atualizador In-App & Instalador Direto de APK (Features)
- **Download Direto pelo Aplicativo:** Agora o Lumen baixa as novas versões de APK diretamente dentro do app via `expo-file-system`, sem necessidade de abrir navegadores externos ou páginas do GitHub.
- **Barra de Progresso e Métricas em Tempo Real:** Visualização ao vivo da porcentagem (`0%` a `100%`) e tamanho baixado (ex: `18.5 MB / 28.2 MB`) com opção de cancelamento.
- **Acionamento do Instalador Nativo:** Ao término do download, o aplicativo aciona o instalador de pacotes do Android automaticamente (`ACTION_VIEW` com permissão segura de URI via `expo-intent-launcher`), permitindo atualizar o app com apenas um toque.
- **Compilação Release Standalone:** Correção do pipeline de CI/CD para gerar APKs standalone autocontidos (`assembleRelease`), incluindo o bundle JavaScript empacotado para execução offline sem Metro.

### 🎮 Novo Recurso de Gamificação (Features)
- **Motor de XP e Níveis:** Sistema inteligente de gamificação integrado! Estudar (Pomodoro) e marcar presença nas aulas agora rendem experiência (XP).
- **Sistema de Conquistas:** Desbloqueie badges alcançando marcos acadêmicos.
- **Painel de Conquistas:** Nova interface (`AchievementsModal`) para acompanhar o nível, o progresso até o próximo nível e todas as medalhas desbloqueadas.
- **Notificações em Tempo Real:** Animações e *Toasts* com feedback (Haptics) toda vez que você ganhar XP.

---

## [3.2.0] - 2026-08-27
### ✨ Novo Recurso (Features)
- **Extração de Dados via PDF e Imagens com IA:** Agora a tela de Desempenho & Curso permite carregar históricos escolares e fluxogramas diretamente em PDF ou Imagens (`expo-document-picker`). A IA do Gemini mapeia os documentos e cria a grade curricular e matérias cursadas magicamente.

---

## [3.1.3] - 2026-08-26
### 🛡️ Blindagem de Inicialização & Deserialização no AsyncStorage (Cold Start Firewall)
- **Firewall de Deserialização Segura (`safeParseArray` & `safeParseObject`):** Blindagem completa de todos os métodos do `StorageService` contra payloads corrompidos, strings literais `"null"`, `"undefined"`, números ou JSON malformado.
- **Eliminação Definitiva de Null-Pointers na Montagem:** Garantia de retorno de arrays e objetos tipados não-nulos em todos os 11 repositórios de dados (`getEvents`, `getSubjects`, `getAttendances`, `getTasks`, `getStudySessions`, `getSemesters`, `getSettings`, `getStreak`, `getAACCActivities`, `getGroupProjects`, `getGamificationData`), eliminando erros de `TypeError: Cannot read properties of null (reading 'filter')` no `App.tsx` e `AttendanceService`.

### 🔒 Blindagem de Ciclo de Vida & Tolerância a Falhas de Permissão do SO
- **Resiliência a Negação de Notificações no Android 13+:** Tratamento gracioso de recusas de permissão (`POST_NOTIFICATIONS`), alarmes exatos (`SCHEDULE_EXACT_ALARM`) e canais de notificação no `NotificationService.requestPermissions()` e `scheduleEventNotifications()`, garantindo que o app nunca dispare exceções não tratadas ao agendar alertas.
- **Cofre Seguro de Dois Níveis (SecureStore & In-Memory Vault):** Proteção de credenciais confidenciais com fallback automático para cofre seguro em memória (`inMemorySecureVault`) caso o hardware Keystore do dispositivo falhe ou esteja indisponível.
- **Migração Automática de Chaves Legadas:** Migração transparente de chaves de API do Google Gemini armazenadas em texto plano no `@organiza_ai_config` para o `expo-secure-store`, higienizando o armazenamento não criptografado.

### 🌟 Elegância em Primeira Instalação (Zero Data Bootstrap)
- **Inicialização Limpa Sem Exceções:** Telas de Agenda, Desempenho Acadêmico, Faltas, Notas e Estudos inicializam com estados visuais elegantes e cards informativos na ausência total de dados prévios.
- **Auto-Provisionamento de Semestre Ativo:** Criação automática do semestre corrente (ex: `2026.2`) e matriz curricular padrão de graduação no `CourseCRService` em boots de primeira instalação.

### 🧪 Bateria de Testes Automatizados & Cobertura Adversarial Expandida
- **Nova Suíte de Testes Dedicada (`test/lifecycle_and_permissions.test.ts`):** 64 novas asserções cobrindo cenários adversos de negação de permissões do SO, falha de hardware Keystore, simulação de boot limpo com dados zerados, migração de esquema legado e timeout com abort controller no `AppUpdateService`.
- **100% de Aprovação em 27 Suítes de Testes:** Mais de 900 asserções executadas com 0 falhas e verificação estrita de tipos com `npx tsc --noEmit` (0 erros).

---

## [3.1.2] - 2026-08-25
### 🛡️ Corrigido (Bug Fixes & Inicialização)
- **Correção de Crash na Inicialização:** Removida chamada de hook de Safe Area fora do escopo do provedor e encapsulado o componente raiz no `<SafeAreaProvider>`.
- **ErrorBoundary Global:** Implementado componente de captura de exceções em tempo de execução para garantir que qualquer erro pontual exiba uma tela de recuperação com botão de "Reiniciar Lumen", impedindo que o aplicativo feche abruptamente.

---

## [3.1.1] - 2026-08-25
### 🛡️ Corrigido (Bug Fixes)
- **Crash na Aba de Desempenho:** Corrigido erro de carregamento no CourseCRService e AcademicPerformanceScreen ao processar esquemas antigos ou incompletos do AsyncStorage sem a matriz de semestres.
- **Botão Flutuante (+):** Restrito para ser exibido exclusivamente na aba Agenda, permanecendo oculto nas demais abas (Estudos, Lumen AI, Faltas e Notas).

### 🎨 Melhorias de UI / UX
- **Adaptação para Câmeras Frontais & Notches:** Header superior redesenhado em formato Dual-Zone assimétrico com useSafeAreaInsets. O canal central superior foi desobstruído para evitar sobreposição de elementos em celulares com câmera punch-hole central/lateral ou ilhas dinâmicas.

### ✨ Inteligência Artificial
- **Simplificação da Configuração:** Removidos downloads pesados de modelos locais offline (340 MB, 1.18 GB e 2.45 GB) da tela de configurações, focando na integração direta e gratuita com a API do Google Gemini via Google AI Studio.

---

## [3.1.0] - 2026-08-25
### ✨ Novos Recursos (Features)
- **Atualizador Automático In-App (AppUpdateService):** Sistema que consulta automaticamente novas versões publicadas no GitHub Releases a cada inicialização do app.
- **Modal Nativo de Atualização (AppUpdateModal):** Interface nativa exibindo o número da versão mais recente, notas de atualização (changelog) e botão com link direto para download do APK.
- **Núcleo de Versionamento Semântico (version.ts):** Parser e comparador rigoroso de versões SemVer com suporte a incremento de Patch, Minor e Major.

---

## [3.0.0] - 2026-08-25
### 🚀 Grande Evolução (Major Release)
- **Novo Rebranding Lumen:** Transição completa para a identidade visual Lumen, novo ícone sutil e discreto em prisma de cetim sobre obsidiana fosca.
- **Rastreador de CR Ponderado & Simulador What-If:** Cálculo de Coeficiente de Rendimento ponderado por créditos e simulações dinâmicas de notas necessárias para atingir metas acadêmicas.
- **Fluxograma & Matriz Curricular:** Visualização semestre a semestre do progresso da graduação com barras de porcentagem de conclusão.
- **Motor Automático de Semestres:** Identificação inteligente do período letivo atual baseado na data do dispositivo.

---

## [2.5.0] - 2026-08-18
### ✨ Novos Recursos (Features)
- **Integração com Microsoft Teams:** Importação de mensagens e comunicados acadêmicos.
- **Parser de Mensagens com IA:** Reconhecimento automático de cancelamentos de aulas, prazos de trabalhos e datas de provas.
- **Notificações em Alta Prioridade:** Ícone transparente em silhueta para Android, eliminando o quadrado branco nas notificações.
