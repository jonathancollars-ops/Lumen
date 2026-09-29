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

## 7. (Desktop) Registrar URI de redirecionamento

Para que o login funcione no Windows (Tauri):
1. Acesse https://console.cloud.google.com/apis/credentials
2. Encontre o **OAuth 2.0 Client ID** do tipo "Desktop App"
3. Em **"Authorized redirect URIs"** adicione: `http://127.0.0.1`
4. Salve

## 8. Verificar

Após configurar o `.env`, rode:
```bash
npx tsc --noEmit
node --import tsx test/run_all.ts
```
