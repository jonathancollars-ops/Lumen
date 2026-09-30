import { GoogleOAuthResponse } from './GoogleMobileAuthFlow';

interface BrowserReturnDependencies {
  redirectUri: string;
  prompt: () => Promise<GoogleOAuthResponse>;
  parseReturnUrl: (url: string) => GoogleOAuthResponse;
  subscribe: (listener: (url: string) => void) => () => void;
  graceMs?: number;
}

function matchesRedirect(url: string, expected: string): boolean {
  // React Native's URL implementation does not parse custom-scheme paths reliably.
  const actual = /^([a-z][a-z\d+.-]*):([^?#]*)(?:[?#].*)?$/i.exec(url);
  const redirect = /^([a-z][a-z\d+.-]*):([^?#]*)(?:[?#].*)?$/i.exec(expected);
  // URI schemes are case insensitive; the complete authority/path must match.
  return !!actual && !!redirect && actual[1].toLowerCase() === redirect[1].toLowerCase() &&
    actual[2] === redirect[2];
}

/** Capture Android's link before AppState can make the browser report dismissal. */
export function captureGoogleAndroidBrowserReturn(deps: BrowserReturnDependencies) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveReturn!: (result: GoogleOAuthResponse) => void;
  let rejectReturn!: (error: unknown) => void;
  const returned = new Promise<GoogleOAuthResponse>((resolve, reject) => {
    resolveReturn = resolve;
    rejectReturn = reject;
  });
  const unsubscribe = deps.subscribe(url => {
    if (disposed || !matchesRedirect(url, deps.redirectUri)) return;
    try {
      // AuthRequest.parseReturnUrl validates OAuth state before accepting the code.
      resolveReturn(deps.parseReturnUrl(url));
    } catch (error) {
      rejectReturn(error);
    }
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe();
    resolveReturn({ type: 'dismiss' });
  };
  return {
    dispose,
    prompt: async (): Promise<GoogleOAuthResponse> => {
      if (disposed) return { type: 'dismiss' };
      try {
        const result = await Promise.race([deps.prompt(), returned]);
        if (result.type !== 'dismiss' || disposed) return result;
        // Android may deliver its active event just before the OAuth deep link.
        return await Promise.race([
          returned,
          new Promise<GoogleOAuthResponse>(resolve => {
            timer = setTimeout(() => resolve(result), deps.graceMs ?? 1_500);
          }),
        ]);
      } finally {
        dispose();
      }
    },
  };
}
