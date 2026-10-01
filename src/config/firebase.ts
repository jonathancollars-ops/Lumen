import { initializeApp, getApps, getApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import { Platform } from 'react-native';

/**
 * Firebase configuration — values come from EXPO_PUBLIC_* env vars.
 * Copy .env.example → .env and fill in your Firebase project credentials.
 * See FIREBASE_SETUP.md for step-by-step instructions.
 */
const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY            ?? '',
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN        ?? '',
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID         ?? '',
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET     ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID             ?? '',
};

/**
 * In test environments (Node, without real credentials), Firebase Auth will throw
 * `auth/invalid-api-key`. We detect this and export null-safe stubs so that tests
 * that don't exercise Firebase directly aren't broken by the import side-effect.
 */
const hasCredentials = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

// Avoid duplicate initialization in hot-reload scenarios
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();


// Lazy import to avoid auth initializing before the guard check
let _db: ReturnType<typeof import('firebase/firestore')['getFirestore']> | null = null;
let _auth: Auth | null = null;

function createFirebaseAuth(): Auth | null {
  if (!hasCredentials) return null;

  try {
    const firebaseAuth = require('firebase/auth');
    const { initializeAuth, getAuth } = firebaseAuth;

    // On native mobile (Android / iOS), initialize Auth with AsyncStorage persistence.
    // This ensures the authenticated session persists when the user exits/closes the app.
    if (Platform.OS !== 'web') {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const getReactNativePersistence =
          firebaseAuth.getReactNativePersistence ??
          (() => {
            try {
              return require('@firebase/auth/dist/rn/index.js')?.getReactNativePersistence;
            } catch {
              return null;
            }
          })();

        if (typeof getReactNativePersistence === 'function' && AsyncStorage && typeof initializeAuth === 'function') {
          return initializeAuth(app, {
            persistence: getReactNativePersistence(AsyncStorage),
          });
        }
      } catch {
        // If initializeAuth throws (e.g. already initialized in hot-reload), fallback below
      }
    }

    // Web / Desktop (Tauri) / Node fallback
    return getAuth(app);
  } catch {
    return null;
  }
}

export function getDb() {
  if (!_db) {
    const { getFirestore } = require('firebase/firestore');
    _db = getFirestore(app);
  }
  return _db!;
}

export function getFirebaseAuth(): Auth | null {
  if (!hasCredentials) return null;
  if (!_auth) {
    _auth = createFirebaseAuth();
  }
  return _auth;
}

// Backwards-compatible named exports for direct imports
// These are safe to import — they return null when credentials are missing.
export const db   = hasCredentials ? (() => { const { getFirestore } = require('firebase/firestore'); return getFirestore(app); })() : null as any;
export const auth = hasCredentials ? getFirebaseAuth() : null as any;
export default app;



