import { GoogleLoginError, GoogleLoginStage, GoogleLoginTokens, runGoogleLoginStage } from './GoogleMobileAuthFlow';

interface DesktopRequest {
  clientId: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}
export interface DesktopOAuthReply { state: string; code?: string | null; error?: string | null }
export interface DesktopAuthDependencies<T> {
  start: (state: string) => Promise<{ port: number }>;
  open: (request: { state: string; clientId: string; codeChallenge: string }) => Promise<void>;
  poll: (state: string) => Promise<DesktopOAuthReply | null>;
  stop: (state: string) => Promise<void>;
  exchange: (request: { state: string; code: string; codeVerifier: string }) => Promise<GoogleLoginTokens>;
  signIn: (tokens: GoogleLoginTokens) => Promise<T>;
  onStage?: (stage: GoogleLoginStage) => void;
  timeouts?: Partial<Record<GoogleLoginStage, number>>;
  pollIntervalMs?: number;
}

export async function runGoogleDesktopLogin<T>(request: DesktopRequest, deps: DesktopAuthDependencies<T>): Promise<T> {
  const stage = <R>(name: GoogleLoginStage, operation: () => Promise<R>) => {
    deps.onStage?.(name);
    return runGoogleLoginStage(name, operation, deps.timeouts?.[name] ?? (name === 'browser' ? 90_000 : 30_000));
  };
  if (!request.clientId) throw new GoogleLoginError('desktop', 'desktop_client_not_configured');
  try {
    const session = await stage('desktop', () => deps.start(request.state));
    if (!Number.isInteger(session.port) || session.port < 1 || session.port > 65535) {
      throw new GoogleLoginError('desktop', 'invalid_loopback_port');
    }
    await stage('opening', () => deps.open({ state: request.state, clientId: request.clientId, codeChallenge: request.codeChallenge }));
    let waiting = true;
    let reply: DesktopOAuthReply;
    try {
      reply = await stage('browser', async () => {
        while (waiting) {
          const result = await deps.poll(request.state);
          if (!waiting) break;
          if (result) return result;
          await new Promise(resolve => setTimeout(resolve, deps.pollIntervalMs ?? 300));
        }
        throw new GoogleLoginError('browser', 'timeout');
      });
    } finally { waiting = false; }
    if (reply.state !== request.state) throw new GoogleLoginError('browser', 'state_mismatch');
    if (reply.error) throw new GoogleLoginError('browser', /^[a-zA-Z0-9_]{1,79}$/.test(reply.error) ? reply.error : 'oauth_failed');
    if (!reply.code) throw new GoogleLoginError('browser', 'missing_code');
    const tokens = await stage('tokens', () => deps.exchange({ state: request.state, code: reply.code!, codeVerifier: request.codeVerifier }));
    if (!tokens.idToken && !tokens.accessToken) throw new GoogleLoginError('tokens', 'missing_tokens');
    return await stage('firebase', () => deps.signIn(tokens));
  } finally {
    // Always close this attempt's listener, including after browser or token failures.
    await runGoogleLoginStage('desktop', () => deps.stop(request.state), 3_000).catch(() => {});
  }
}
