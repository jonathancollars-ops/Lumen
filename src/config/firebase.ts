import { initializeApp, getApps, getApp } from 'firebase/app';

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
let _auth: ReturnType<typeof import('firebase/auth')['getAuth']> | null = null;

export function getDb() {
  if (!_db) {
    const { getFirestore } = require('firebase/firestore');
    _db = getFirestore(app);
  }
  return _db!;
}

export function getFirebaseAuth() {
  if (!_auth) {
    const { getAuth } = require('firebase/auth');
    _auth = getAuth(app);
  }
  return _auth!;
}

// Backwards-compatible named exports for direct imports
// These are safe to import — they return null when credentials are missing.
export const db   = hasCredentials ? (() => { const { getFirestore } = require('firebase/firestore'); return getFirestore(app); })() : null as any;
export const auth = hasCredentials ? (() => { const { getAuth } = require('firebase/auth'); return getAuth(app); })() : null as any;
export default app;

