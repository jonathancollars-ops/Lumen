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
  GoogleLoginError, GoogleLoginStage, GoogleOAuthRequest, GoogleOAuthResponse, runGoogleMobileLogin,
} from './GoogleMobileAuthFlow';
import { captureGoogleAndroidBrowserReturn } from './GoogleAndroidBrowserReturn';
import { DesktopOAuthReply, runGoogleDesktopLogin } from './GoogleDesktopAuthFlow';

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

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const native = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
        try { return await invoke<T>(command, args); }
        catch (error) {
          if (typeof error === 'string' && /command.*not found/i.test(error)) {
            throw new GoogleLoginError('desktop', 'desktop_command_unavailable');
          }
          throw error;
        }
      };
      const codeVerifier = GoogleAuthService.generateCodeVerifier();
      const user = await runGoogleDesktopLogin({
        clientId: process.env.EXPO_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID ?? '',
        state: GoogleAuthService.generateCodeVerifier(),
        codeVerifier,
        codeChallenge: await GoogleAuthService.generateCodeChallenge(codeVerifier),
      }, {
        onStage,
        start: state => native<{ port: number }>('start_google_oauth', { state }),
        open: config => native<void>('open_google_oauth', config),
        poll: state => native<DesktopOAuthReply | null>('poll_google_oauth', { state }),
        stop: state => native<void>('stop_google_oauth', { state }),
        exchange: config => native('exchange_google_oauth', config),
        signIn: async ({ idToken, accessToken }) => {
          if (!auth) throw new GoogleLoginError('firebase', 'firebase_not_configured');
          // Desktop OAuth has its own audience. Firebase also supports a Google access token.
          const credential = GoogleAuthProvider.credential(accessToken ? null : idToken ?? null, accessToken ?? null);
          return (await signInWithCredential(auth, credential)).user;
        },
      });
      void native<void>('focus_lumen_window').catch(() => {});
      return user;
    } catch (error) {
      if (error instanceof GoogleLoginError) {
        throw error;
      }
      throw new GoogleLoginError('desktop', 'desktop_failed');
    }
  }

  // ─── PKCE helpers (used by signInDesktop) ──────────────────────────────

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

}
