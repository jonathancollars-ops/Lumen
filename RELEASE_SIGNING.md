# Assinatura e avisos de instalação

## Android

As publicações de main/master e tags v* exigem os segredos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD`. Configure também a variável `ANDROID_CERT_SHA256` com o SHA-256 do **certificado do APK já distribuído**, não com o hash do arquivo APK.

Obtenha esse valor com `apksigner verify --print-certs caminho/do/apk-atual.apk` e copie `Signer #1 certificate SHA-256 digest`. Use a mesma chave existente. Não gere outra chave para tentar remover avisos: uma assinatura diferente pode impedir a atualização sobre a instalação atual. Faça backup da chave em local seguro; não a coloque no repositório nem envie senhas pelo chat.

O fluxo agora falha se faltam credenciais ou se a assinatura não corresponde ao certificado definido. PRs continuam gerando artefatos de teste sem usar as credenciais de publicação. O script de assinatura é destinado ao runner Linux do workflow Android.

Isso preserva a identidade do aplicativo; não concede aprovação do Play Protect. A autorização para instalar de uma fonte costuma ser mantida pelo Android, mas a confirmação de instalação e as verificações do Play Protect são controles do sistema e podem reaparecer. Distribuição pela Play Store e atualizações de JavaScript/assets por Expo Updates são alternativas distintas, que exigem configuração própria. Mudanças nativas continuam exigindo um novo pacote.

## Windows

O workflow suporta Azure Artifact Signing com autenticação OIDC, sem guardar chave privada de certificado no GitHub. A conta precisa ser elegível, passar pela validação de identidade e ter um perfil de certificado **Public Trust**. A criação dessa conta pode ter custo e não foi realizada por esta alteração.

Configure as variáveis de repositório:

| Variável | Valor |
| --- | --- |
| `WINDOWS_SIGNING_ENABLED` | `true` após concluir a configuração abaixo |
| `AZURE_CLIENT_ID` | Identificador do aplicativo/identidade no Azure |
| `AZURE_TENANT_ID` | Identificador do tenant |
| `AZURE_SUBSCRIPTION_ID` | Identificador da assinatura Azure |
| `WINDOWS_SIGNING_ENDPOINT` | Endpoint regional da conta de assinatura |
| `WINDOWS_SIGNING_ACCOUNT` | Nome da conta de Artifact Signing |
| `WINDOWS_CERTIFICATE_PROFILE` | Nome do perfil Public Trust validado |

Configure uma credencial federada OIDC restrita ao repositório e às branches/tags autorizadas e atribua à identidade o papel **Artifact Signing Certificate Profile Signer** no perfil. PRs não usam essa identidade nem solicitam assinatura.

O fluxo compila o executável, assina e verifica sua origem e timestamp, empacota sem modificar o executável já assinado, assina os instaladores e verifica as assinaturas antes de calcular os checksums e publicar. Uma falha de assinatura bloqueia a publicação quando a opção está ativada. Com a opção ausente ou `false`, a distribuição atual continua sem assinatura e o workflow emite um aviso explícito.

Authenticode comprova o editor, mas não garante que o SmartScreen desapareça imediatamente. Reputação do arquivo/editor e políticas do Windows continuam valendo. A assinatura de atualizações do plugin Tauri Updater é outra coisa e não substitui Authenticode.

## Referências

- [Assinatura Android](https://developer.android.com/studio/publish/app-signing)
- [Google Play Protect](https://support.google.com/googleplay/answer/2812853)
- [Reputação SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [Azure Artifact Signing no GitHub Actions](https://github.com/Azure/artifact-signing-action)
- [Assinatura Windows no Tauri](https://v2.tauri.app/distribute/sign/windows/)
