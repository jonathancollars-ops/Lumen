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
import { Platform } from 'react-native';
import { auth } from '../config/firebase';

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
  static async signInDesktop(): Promise<User | null> {
    const isTauri =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!isTauri) return null;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { open }   = await import('@tauri-apps/plugin-shell');

      const codeVerifier  = GoogleAuthService.generateCodeVerifier();
      const codeChallenge = await GoogleAuthService.generateCodeChallenge(codeVerifier);
      const port          = await invoke<number>('get_available_port');
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

      await invoke('start_oauth_server', { port });
      await open(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);

      const authCode = await GoogleAuthService.waitForCode(invoke, 90);
      if (!authCode) {
        console.warn('[GoogleAuth Desktop] Timeout aguardando código OAuth');
        return null;
      }

      // Exchange code for tokens
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

      const tokens = await tokenRes.json();
      if (!tokens.id_token) {
        console.error('[GoogleAuth Desktop] id_token ausente na resposta:', tokens);
        return null;
      }

      // Sign into Firebase
      const credential = GoogleAuthProvider.credential(tokens.id_token);
      const result     = await signInWithCredential(auth, credential);
      return result.user;
    } catch (error) {
      console.error('[GoogleAuth Desktop] Erro:', error);
      return null;
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

  private static async waitForCode(
    invoke: (cmd: string, args?: any) => Promise<any>,
    timeoutSec: number,
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const code = await invoke('poll_oauth_code');
      if (code) return code as string;
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }
}
