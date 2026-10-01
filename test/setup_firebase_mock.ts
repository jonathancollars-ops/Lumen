/**
 * test/setup_firebase_mock.ts
 *
 * Global Firebase mock for tests that don't exercise Firebase directly.
 * Import this file at the TOP of any test that indirectly imports AppContext,
 * FirebaseBackupService, or GoogleAuthService, but doesn't need real Firebase.
 *
 * Usage (top of test file):
 *   import './setup_firebase_mock';
 */

// Mock firebase/app — prevent real initializeApp from running
const mockApp = { name: '[DEFAULT]', options: {}, automaticDataCollectionEnabled: false };
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(() => mockApp),
  getApps:       jest.fn(() => []),
  getApp:        jest.fn(() => mockApp),
}));

// Mock firebase/firestore
jest.mock('firebase/firestore', () => ({
  getFirestore:  jest.fn(() => ({})),
  doc:           jest.fn(() => ({ id: 'latest' })),
  setDoc:        jest.fn(async () => undefined),
  getDoc:        jest.fn(async () => ({ exists: () => false, data: () => null })),
  collection:    jest.fn(() => ({})),
}));

// Mock firebase/auth — prevent auth/invalid-api-key
jest.mock('firebase/auth', () => ({
  getAuth:                    jest.fn(() => ({})),
  initializeAuth:             jest.fn(() => ({})),
  getReactNativePersistence:   jest.fn(() => ({})),
  signInWithCredential:       jest.fn(async () => ({ user: { uid: 'mock-uid', email: 'test@lumen.app', displayName: 'Usuário Teste' } })),
  signOut:                    jest.fn(async () => undefined),
  onAuthStateChanged:         jest.fn((_auth: any, cb: any) => { cb(null); return jest.fn(); }),
  GoogleAuthProvider:         { credential: jest.fn(() => ({ providerId: 'google.com' })) },
}));

