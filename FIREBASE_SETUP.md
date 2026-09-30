# Configuração Firebase — Lumen v3.7.0

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
- Para Android: clique em **"Adicionar app"** → Android → preencha `com.lumen.app`
  - Copie o **Android Client ID** → `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- O **Web Client ID** já aparece na aba Authentication → Google → expandir → "ID do cliente Web"
  - Copie → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

## 7. Configurar o cliente Google para Windows

1. Abra [Google Auth Platform → Clientes](https://console.cloud.google.com/auth/clients?project=lumen-app-academico) no mesmo projeto usado pelo Firebase.
2. Clique em **Criar cliente** e escolha **App para computador / Desktop app**. Nomeie como **Lumen Windows**.
3. Copie o **ID do cliente** para `EXPO_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID` no `.env` local.
4. Para os instaladores do GitHub, salve esse ID na variável de repositório `GOOGLE_DESKTOP_CLIENT_ID` em **Settings → Secrets and variables → Actions → Variables**.
5. Gere um novo instalador depois de configurar a variável: o Expo incorpora as variáveis `EXPO_PUBLIC_*` durante a compilação.

Se a configuração desse cliente incluir um `client_secret` necessário à troca de tokens, use o secret de Actions `GOOGLE_DESKTOP_CLIENT_SECRET`. Ele é lido apenas pelo componente Rust durante a compilação; não o coloque em variáveis `EXPO_PUBLIC_*` nem em arquivos versionados. Para compilar localmente, disponibilize `GOOGLE_DESKTOP_CLIENT_SECRET` no ambiente do processo Cargo/Tauri.

O cliente de desktop permite o retorno por `http://127.0.0.1:<porta>/oauth2callback`; a porta é escolhida pelo aplicativo a cada tentativa. Não há um campo de URIs autorizadas para editar nesse tipo de cliente. O cliente Web continua sendo usado somente pelo site. Não altere o cliente Android que já funciona.

A implementação Windows inicia o listener antes de abrir o navegador, valida o estado OAuth e usa PKCE. A troca de tokens ocorre no processo Rust; o Firebase recebe a credencial Google e continua responsável pela sessão e pela sincronização. O listener é encerrado após cada tentativa, inclusive em caso de erro ou tempo limite.

Referência: [OAuth do Google para aplicativos desktop](https://developers.google.com/identity/protocols/oauth2/native-app#loopback-ip-address).

## 8. Verificar

Após configurar o `.env`, rode:
```bash
npx tsc --noEmit
node --import tsx test/run_all.ts
```
