# Configuração Firebase — Lumen

## 1. Criar projeto Firebase
1. Acesse https://console.firebase.google.com
2. Clique em **"Adicionar projeto"** → nomeie "Lumen"
3. Desative Google Analytics (opcional) → **Criar projeto**

## 2. Ativar Authentication
1. No menu lateral: **Authentication → Método de login**
2. Ative **"Google"** como provedor
3. Preencha o e-mail de suporte e salve

## 3. Criar banco Firestore
1. No menu lateral: **Firestore Database → Criar banco de dados**
2. Selecione **Modo de produção**
3. Escolha a região `us-east1` (ou a mais próxima de você)

## 4. Configurar regras de segurança

No console **Firestore → Regras**, cole e publique:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 5. Registrar o app e obter credenciais

1. **Configurações do projeto** (⚙️) → **Geral**
2. Role até **"Seus apps"** → clique no ícone Web (`</>`)
3. Nomeie como "Lumen Web" e registre
4. Copie o objeto `firebaseConfig` e preencha o arquivo `.env`:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=AIza...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=lumen-xxxxx.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=lumen-xxxxx
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=lumen-xxxxx.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
EXPO_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
```

## 6. Obter os Client IDs do Google OAuth

Ainda em **Configurações → Geral**:
- Para Android: clique em **"Adicionar app"** → Android → preencha `com.jothacsf.Organiza` (o pacote definido em `app.json`).
  - Copie o **Android Client ID** → `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- O **Web Client ID** já aparece na aba Authentication → Google → expandir → "ID do cliente Web"
  - Copie → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

## 7. Configurar o cliente Google para Windows

1. Abra [Google Auth Platform → Clientes](https://console.cloud.google.com/auth/clients?project=lumen-app-academico) no mesmo projeto usado pelo Firebase.
2. Abra o cliente existente do tipo **App para computador / Desktop app**. Se ainda não houver um, crie **Lumen Windows** com esse tipo.
3. Copie o **ID do cliente** para `EXPO_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID` no `.env` local.
4. Para os instaladores do GitHub, salve esse ID na variável de repositório `GOOGLE_DESKTOP_CLIENT_ID` em **Settings → Secrets and variables → Actions → Variables**.
5. Gere um novo instalador depois de configurar a variável: o Expo incorpora as variáveis `EXPO_PUBLIC_*` durante a compilação.

O cliente Windows configurado exige também seu `client_secret` na troca de tokens, confirmado pela resposta `client_secret is missing` do Google. Salve esse valor no secret de Actions `GOOGLE_DESKTOP_CLIENT_SECRET`, em **Settings → Secrets and variables → Actions → New repository secret**. Ele é lido apenas pelo componente Rust durante a compilação; não o coloque em variáveis `EXPO_PUBLIC_*` nem em arquivos versionados. Para compilar localmente, disponibilize `GOOGLE_DESKTOP_CLIENT_SECRET` no ambiente do processo Cargo/Tauri. Sem esse secret, a publicação de instaladores Windows é interrompida.

O cliente de desktop permite o retorno por `http://127.0.0.1:<porta>/oauth2callback`; a porta é escolhida pelo aplicativo a cada tentativa. Não há um campo de URIs autorizadas para editar nesse tipo de cliente. O cliente Web continua sendo usado somente pelo site. Não altere o cliente Android que já funciona.

A implementação Windows inicia o listener antes de abrir o navegador, valida o estado OAuth e usa PKCE. A troca de tokens ocorre no processo Rust; o Firebase recebe a credencial Google e continua responsável pela sessão e pela sincronização. O listener é encerrado após cada tentativa, inclusive em caso de erro ou tempo limite.

Referência: [OAuth do Google para aplicativos desktop](https://developers.google.com/identity/protocols/oauth2/native-app#loopback-ip-address).

### Cliente de desktop criado em outro projeto

O cliente Windows fornecido está no projeto Google Cloud `lumen-510016`, enquanto o Android e o Windows distribuídos usam o Firebase `lumen-app-academico`. Um cliente externo precisa ser autorizado no provedor Google do Firebase usado pelo aplicativo. O sucesso da troca de tokens no Google não confirma essa autorização no Firebase.

1. Abra [Authentication → Provedores no Firebase do app](https://console.firebase.google.com/project/lumen-app-academico/authentication/providers).
2. Em **Método de login**, abra o provedor **Google**.
3. Expanda **Adicionar IDs de cliente à lista de permissões a partir de projetos externos**.
4. Adicione `42411396434-9usdgo1vck957t1dra98otrl0a8fgf2f.apps.googleusercontent.com` e salve.
5. Tente conectar novamente no Windows 3.7.4. Esse ajuste é feito no servidor e não exige um novo instalador.

Não substitua o ID Web ou seu segredo por credenciais de desktop: a lista de permissões é uma configuração separada. Mantenha o projeto Firebase usado pelo Android para que ambos acessem os mesmos usuários e dados.

Se ocorrer `auth/invalid-credential` na etapa **Autenticação no Firebase**, confira essa autorização e a configuração do provedor antes de gerar outra versão. O código genérico, isoladamente, não identifica a causa da rejeição.

Referência: [Firebase: permitir clientes de projetos externos](https://support.google.com/firebase/answer/6401008?hl=pt-BR).

## 8. Verificar

### Sincronizar a rotina entre Android e Windows (3.7.6)

1. Atualize os dois aplicativos antes de editar a rotina. Instale as atualizações sobre a instalação existente para preservar os dados locais.
2. Abra primeiro o Android, que contém a rotina, e conecte a conta Google. Em **Configurações → Backup & Nuvem**, aguarde a mensagem **Dados sincronizados**.
3. Abra o Windows e conecte a mesma conta Google. Os dois builds devem usar o mesmo projeto Firebase. A rotina é identificada pelo UID do Firebase e armazenada em `users/{uid}/backup/latest`.
4. As alterações salvas são enviadas automaticamente; o outro aplicativo recebe as mudanças enquanto está aberto, ou na próxima abertura. **Sincronizar Agora** executa o envio e o recebimento imediatamente.

O motor mescla coleções por ID e campos alterados em transações. Após a primeira conexão, usa uma referência local persistida por conta para distinguir alterações locais, remotas e exclusões. Em conflitos no mesmo campo, a alteração local que chega na transação vence. Na primeira conexão, registros locais exclusivos são preservados e duplicatas existentes na nuvem têm prioridade. Exclusões registradas na nuvem não são recriadas por dados antigos de um dispositivo que está conectando pela primeira vez.

Eventos, matérias, faltas, tarefas, sessões de estudo, semestres, AACC, projetos, histórico/CR, configurações e progresso são sincronizados. Credenciais de IA e o temporizador em andamento permanecem no dispositivo. Backups antigos do Firebase são convertidos para o formato validado antes de aplicar dados.

Sem internet, as alterações ficam no armazenamento local e são comparadas novamente com a referência ao reconectar. Falhas de leitura não são transformadas em listas vazias. A interface mostra erros de acesso/rede; `permission-denied` exige conferir as regras do Firestore da seção 4, sem tornar os dados públicos.

Os testes de `test/cloud_sync.test.ts` simulam dois dispositivos, migração de backup, edições concorrentes, exclusões, alterações durante envio, perda de conexão e logout. A confirmação com dados reais deve ser feita nos dois aplicativos instalados.

Após configurar o `.env`, rode:
```bash
npx tsc --noEmit
node --import tsx test/run_all.ts
```
