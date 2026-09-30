/** Mobile OAuth orchestration. Never include credentials in diagnostic messages. */
export type GoogleLoginStage = 'browser' | 'tokens' | 'firebase';

export const GOOGLE_LOGIN_STAGE_LABELS: Record<GoogleLoginStage, string> = {
  browser: 'Retorno do Google',
  tokens: 'Validação da resposta do Google',
  firebase: 'Autenticação no Firebase',
};

export interface GoogleOAuthResponse {
  type: string;
  params?: Record<string, string>;
  error?: { code?: string; message?: string } | null;
}

export interface GoogleOAuthRequest {
  clientId: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface GoogleLoginTokens {
  idToken?: string | null;
  accessToken?: string | null;
}

export interface GoogleMobileAuthDependencies<T> {
  prompt: () => Promise<GoogleOAuthResponse>;
  exchange: (config: GoogleOAuthRequest & { code: string }) => Promise<GoogleLoginTokens>;
  signIn: (tokens: GoogleLoginTokens) => Promise<T>;
  dismiss?: () => void;
  onStage?: (stage: GoogleLoginStage) => void;
  timeouts?: Partial<Record<GoogleLoginStage, number>>;
}

export class GoogleLoginError extends Error {
  constructor(public readonly stage: GoogleLoginStage, public readonly code: string) {
    super(`Etapa: ${GOOGLE_LOGIN_STAGE_LABELS[stage]}\nCódigo: ${code}`);
    this.name = 'GoogleLoginError';
  }
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || !error) return fallback;
  const code = 'code' in error ? error.code : 'error' in error ? error.error : undefined;
  // OAuth/Firebase codes only; discard raw messages, URLs, tokens and personal data.
  return typeof code === 'string' && /^[a-zA-Z][a-zA-Z0-9_./-]{0,79}$/.test(code)
    ? code : fallback;
}

async function runStage<T>(
  stage: GoogleLoginStage,
  operation: () => Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new GoogleLoginError(stage, 'timeout'));
          try { onTimeout?.(); } catch { /* Dismiss is unavailable on some platforms. */ }
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof GoogleLoginError) throw error;
    throw new GoogleLoginError(stage, safeErrorCode(error, `${stage}_failed`));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runGoogleMobileLogin<T>(
  request: GoogleOAuthRequest,
  deps: GoogleMobileAuthDependencies<T>,
): Promise<T> {
  deps.onStage?.('browser');
  const response = await runStage('browser', deps.prompt, deps.timeouts?.browser ?? 90_000, deps.dismiss);
  if (response.type === 'cancel' || response.type === 'dismiss') {
    throw new GoogleLoginError('browser', response.type);
  }
  if (response.type !== 'success') {
    throw new GoogleLoginError('browser', safeErrorCode(response.error,
      safeErrorCode({ code: response.params?.error }, response.type === 'locked' ? 'session_locked' : 'oauth_failed')));
  }

  deps.onStage?.('tokens');
  const params = response.params ?? {};
  let tokens: GoogleLoginTokens = { idToken: params.id_token, accessToken: params.access_token };
  if (!tokens.idToken && !tokens.accessToken && params.code) {
    if (!request.codeVerifier) throw new GoogleLoginError('tokens', 'missing_pkce_verifier');
    tokens = await runStage('tokens', () => deps.exchange({ ...request, code: params.code }),
      deps.timeouts?.tokens ?? 30_000);
  }
  if (!tokens.idToken && !tokens.accessToken) throw new GoogleLoginError('tokens', 'missing_tokens');

  deps.onStage?.('firebase');
  return runStage('firebase', () => deps.signIn(tokens), deps.timeouts?.firebase ?? 30_000);
}

export function describeGoogleLoginError(error: unknown): string {
  if (!(error instanceof GoogleLoginError)) return 'Não foi possível iniciar a conexão. Tente novamente.';
  const explanation = error.code === 'timeout'
    ? error.stage === 'browser'
      ? 'O Google não devolveu o resultado ao aplicativo em 90 segundos. Feche a aba de login antes de tentar novamente.'
      : 'A conexão demorou mais de 30 segundos e a espera foi encerrada. Verifique sua internet.'
    : error.code === 'cancel' || error.code === 'dismiss'
      ? 'A aba de login foi fechada sem concluir a conexão.'
      : error.code === 'session_locked'
        ? 'Ainda existe uma tentativa de login aberta. Feche a aba anterior antes de tentar novamente.'
        : 'A conexão não foi concluída. Os detalhes abaixo identificam a etapa que falhou.';
  return `${explanation}\n\n${error.message}`;
}
