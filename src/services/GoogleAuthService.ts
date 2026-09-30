/**
 * GoogleAuthService — Lumen v3.7.0
 *
 * Handles Google Sign-In via Firebase Auth.
 * - Mobile (Android/iOS): uses expo-auth-session Google provider.
 * - Desktop (Tauri): uses PKCE loopback flow → Firebase credential.
 */

import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { Linking, Platform } from 'react-native';
import { auth } from '../config/firebase';
import {
  GoogleLoginError, GoogleLoginStage, GoogleOAuthRequest, GoogleOAuthResponse, runGoogleMobileLogin, runGoogleLoginStage,
} from './GoogleMobileAuthFlow';
import { captureGoogleAndroidBrowserReturn } from './GoogleAndroidBrowserReturn';

// maybeCompleteAuthSession must be called at module load for expo-auth-session to work.
// We use a lazy require so Node/test environments (which lack native modules) don't crash.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('expo-web-browser').maybeCompleteAuthSession?.();
} catch {
  // Running in Node/test — no-op
}

// ─── Default Credentials Fallback ─────────────────────────────────────────────
// Public Google OAuth client identifiers (secured via package name + SHA-1 in Google Cloud Console)
const DEFAULT_ANDROID_CLIENT_ID = '505145390874-dsluagocjfj15rjso9nsbgc282d4nvv8.apps.googleusercontent.com';
const DEFAULT_WEB_CLIENT_ID     = '505145390874-jr3d95ph621voepch94fslvas08kqevi.apps.googleusercontent.com';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GoogleAuthConfig {
  /** Client ID for Android (from Firebase Console → Android app) */
  androidClientId?: string;
  /** Client ID for Web / Desktop (from Firebase Console → Web app) */
  webClientId?: string;
  /** Client ID for iOS */
  iosClientId?: string;
  /** Primary Client ID fallback */
  clientId?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class GoogleAuthService {
  /** Return the currently authenticated Firebase user, or null. */
  static getCurrentUser(): User | null {
    if (!auth) return null;
    return auth.currentUser;
  }

  /** Subscribe to auth state changes. Returns unsubscribe function. */
  static onAuthChange(callback: (user: User | null) => void): () => void {
    if (!auth) {
      callback(null);
      return () => {};
    }
    return onAuthStateChanged(auth, callback);
  }

  /** Sign out from Firebase. */
  static async signOut(): Promise<void> {
    if (!auth) return;
    await firebaseSignOut(auth);
  }

  /** Config object to pass to expo-auth-session's Google.useAuthRequest hook. */
  static getGoogleAuthConfig(): GoogleAuthConfig {
    const androidClientId =
      process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || DEFAULT_ANDROID_CLIENT_ID;
    const webClientId =
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || DEFAULT_WEB_CLIENT_ID;

    return {
      androidClientId,
      webClientId,
      iosClientId: webClientId,
      clientId: Platform.OS === 'android' ? androidClientId : webClientId,
    };
  }

  /**
   * Process the OAuth response returned by expo-auth-session's promptAsync().
   * Exchanges the Google tokens for a Firebase credential.
   */
  static async handleAuthResponse(response: any): Promise<User | null> {
    if (response?.type !== 'success') return null;
    if (!auth) return null;

    const { id_token, access_token } = response.params ?? {};
    if (!id_token && !access_token) return null;

    try {
      const credential = GoogleAuthProvider.credential(id_token ?? null, access_token ?? null);
      const result = await signInWithCredential(auth, credential);
      return result.user;
    } catch (error) {
      console.error('[GoogleAuth] Falha ao autenticar no Firebase:', error);
      return null;
    }
  }

  /** Handle each mobile step explicitly, including token exchange failures. */
  static async signInMobile(
    request: GoogleOAuthRequest & { parseReturnUrl?: (url: string) => GoogleOAuthResponse },
    prompt: () => Promise<GoogleOAuthResponse>,
    onStage: (stage: GoogleLoginStage) => void,
  ): Promise<User> {
    const AuthSession: typeof import('expo-auth-session') = require('expo-auth-session');
    const browserReturn = Platform.OS === 'android' && request.parseReturnUrl
      ? captureGoogleAndroidBrowserReturn({
        redirectUri: request.redirectUri,
        prompt,
        parseReturnUrl: url => request.parseReturnUrl!(url),
        subscribe: listener => {
          const subscription = Linking.addEventListener('url', event => listener(event.url));
          return () => subscription.remove();
        },
      }) : undefined;
    try {
      return await runGoogleMobileLogin(request, {
        prompt: browserReturn?.prompt ?? prompt,
        onStage,
        dismiss: () => { browserReturn?.dispose(); AuthSession.dismiss(); },
        exchange: (config) => AuthSession.exchangeCodeAsync({
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          code: config.code,
          extraParams: { code_verifier: config.codeVerifier! },
        }, { tokenEndpoint: 'https://oauth2.googleapis.com/token' }),
        signIn: async ({ idToken, accessToken }) => {
          if (!auth) throw new GoogleLoginError('firebase', 'firebase_not_configured');
          const credential = GoogleAuthProvider.credential(idToken ?? null, accessToken ?? null);
          const result = await signInWithCredential(auth, credential);
          return result.user;
        },
      });
    } finally {
      browserReturn?.dispose();
    }
  }

  /**
   * Web browser login using Firebase's native popup.
   * Uses Firebase's pre-authorized auth handler domain so no redirect_uri mismatch occurs.
   */
  static async signInWeb(): Promise<User | null> {
    if (!auth) return null;
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      return result.user;
    } catch (error: any) {
      if (
        error?.code === 'auth/popup-closed-by-user' ||
        error?.code === 'auth/operation-not-supported-in-this-environment'
      ) {
        return null;
      }
      console.error('[GoogleAuth Web] Falha ao autenticar com popup:', error);
      throw error;
    }
  }


  // ─── Desktop / Tauri PKCE flow ─────────────────────────────────────────

  /**
   * Full PKCE Authorization Code flow for Tauri desktop.
   * 1. Spins up local Rust HTTP server (Tauri command).
   * 2. Opens system browser to Google OAuth URL.
   * 3. Waits for the authorization code callback.
   * 4. Exchanges code for tokens.
   * 5. Signs into Firebase with the id_token.
   */
  static async signInDesktop(onStage?: (stage: GoogleLoginStage) => void): Promise<User | null> {
    const isTauri =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!isTauri) return null;

    let stage: GoogleLoginStage = 'desktop';
    onStage?.(stage);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { open }   = await import('@tauri-apps/plugin-shell');

      const codeVerifier  = GoogleAuthService.generateCodeVerifier();
      const codeChallenge = await GoogleAuthService.generateCodeChallenge(codeVerifier);
      const port          = await GoogleAuthService.invokeDesktopCommand<number>(invoke, 'get_available_port');
      const redirectUri   = `http://127.0.0.1:${port}/oauth2callback`;
      const clientId      = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || DEFAULT_WEB_CLIENT_ID;

      const params = new URLSearchParams({
        client_id:             clientId,
        redirect_uri:          redirectUri,
        response_type:         'code',
        scope:                 'openid email profile',
        code_challenge:        codeChallenge,
        code_challenge_method: 'S256',
        access_type:           'offline',
        prompt:                'consent',
      });

      await GoogleAuthService.invokeDesktopCommand(invoke, 'start_oauth_server', { port });
      stage = 'opening';
      onStage?.(stage);
      await runGoogleLoginStage(stage, () => open(`https://accounts.google.com/o/oauth2/v2/auth?${params}`), 30_000);

      stage = 'browser';
      onStage?.(stage);
      const authCode = await GoogleAuthService.waitForCode(invoke, 90);
      if (!authCode) {
        throw new GoogleLoginError(stage, 'timeout');
      }

      // Exchange code for tokens
      stage = 'tokens';
      onStage?.(stage);
      const tokens = await runGoogleLoginStage(stage, async () => {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    new URLSearchParams({
            code:          authCode,
            client_id:     clientId,
            redirect_uri:  redirectUri,
            grant_type:    'authorization_code',
            code_verifier: codeVerifier,
          }),
        });
        const tokenBody = await tokenRes.json();
        if (tokenBody.error) throw { code: tokenBody.error };
        return tokenBody;
      }, 30_000);
      if (!tokens.id_token) {
        throw new GoogleLoginError(stage, 'missing_tokens');
      }

      // Sign into Firebase
      stage = 'firebase';
      onStage?.(stage);
      return await runGoogleLoginStage(stage, async () => {
        if (!auth) throw new GoogleLoginError('firebase', 'firebase_not_configured');
        const credential = GoogleAuthProvider.credential(tokens.id_token);
        const result = await signInWithCredential(auth, credential);
        return result.user;
      }, 30_000);
    } catch (error) {
      if (error instanceof GoogleLoginError) {
        throw error;
      }
      throw new GoogleLoginError(stage, `${stage}_failed`);
    }
  }

  // ─── PKCE helpers (used by signInDesktop) ──────────────────────────────

  private static invokeDesktopCommand<T>(
    invoke: <R>(command: string, args?: Record<string, unknown>) => Promise<R>,
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    return runGoogleLoginStage('desktop', async () => {
      try {
        return await invoke<T>(command, args);
      } catch (error) {
        if (typeof error === 'string' && /command.*not found/i.test(error)) {
          throw new GoogleLoginError('desktop', 'desktop_command_unavailable');
        }
        throw error;
      }
    }, 30_000);
  }

  private static generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private static async generateCodeChallenge(verifier: string): Promise<string> {
    const data   = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private static async waitForCode(
    invoke: (cmd: string, args?: any) => Promise<any>,
    timeoutSec: number,
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const code = await runGoogleLoginStage('browser', () => invoke('poll_oauth_code'),
        Math.max(1, deadline - Date.now()));
      if (code) return code as string;
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }
}
