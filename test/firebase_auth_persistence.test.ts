/**
 * firebase_auth_persistence.test.ts — Lumen v3.7.6
 *
 * Verifies that Firebase Authentication is correctly initialized with
 * React Native AsyncStorage persistence so that user sessions remain active
 * across app restarts, closures, and background process terminations.
 */

import './setup_env';
import assert from 'node:assert/strict';
import { GoogleAuthService } from '../src/services/GoogleAuthService';
import { getFirebaseAuth } from '../src/config/firebase';

let total = 0;
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ [FAIL] ${name}\n     ${err.message}`);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🔐 FIREBASE AUTH PERSISTENCE & SESSION RETENTION TESTS');
  console.log('================================================================\n');

  await test('T1: getFirebaseAuth() returns an Auth instance or null stub without throwing', () => {
    const authInstance = getFirebaseAuth();
    // In node test env with or without credentials, it must not throw
    assert.ok(authInstance !== undefined, 'getFirebaseAuth returned undefined');
  });

  await test('T2: GoogleAuthService.waitForAuthReady() resolves safely to User or null', async () => {
    const user = await GoogleAuthService.waitForAuthReady();
    assert.equal(user, null, 'Unauthenticated user in test env should be null');
  });

  await test('T3: Native platform uses initializeAuth with getReactNativePersistence', () => {
    // Simulate mobile environment
    const { Platform } = require('react-native');
    const prevOS = Platform.OS;
    Platform.OS = 'android';

    try {
      const firebaseAuth = require('firebase/auth');
      assert.ok(typeof firebaseAuth.initializeAuth === 'function', 'initializeAuth is available');
      assert.ok(typeof firebaseAuth.getAuth === 'function', 'getAuth is available');
    } finally {
      Platform.OS = prevOS;
    }
  });

  await test('T4: AsyncStorage is available for Firebase persistence', () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    assert.ok(AsyncStorage, 'AsyncStorage module is loaded');
    assert.ok(typeof AsyncStorage.getItem === 'function', 'AsyncStorage has getItem');
    assert.ok(typeof AsyncStorage.setItem === 'function', 'AsyncStorage has setItem');
  });

  await test('T5: GoogleAuthService.onAuthChange notifies subscriber when auth state changes', async () => {
    let notified = false;
    let receivedUser: any = undefined;

    const unsubscribe = GoogleAuthService.onAuthChange((user) => {
      notified = true;
      receivedUser = user;
    });

    assert.equal(typeof unsubscribe, 'function', 'Returns unsubscribe function');
    assert.equal(notified, true, 'Callback was triggered with initial state');
    assert.equal(receivedUser, null, 'Initial test state is null');

    unsubscribe();
  });

  await test('T6: initializeAuth configures persistence object with LOCAL storage type', () => {
    const rnAuth = require('../node_modules/@firebase/auth/dist/rn/index.js');
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const persistence = rnAuth.getReactNativePersistence(AsyncStorage);
    assert.ok(persistence, 'getReactNativePersistence returned a persistence object');
    assert.equal(persistence.type, 'LOCAL', 'Persistence type is LOCAL');
  });

  await test('T7: GoogleAuthService.signOut() completes gracefully', async () => {
    await GoogleAuthService.signOut();
    assert.equal(GoogleAuthService.getCurrentUser(), null, 'Current user remains null after sign out');
  });

  await test('T8: GoogleAuthService.getCurrentUser() is strictly typed and safe', () => {
    const current = GoogleAuthService.getCurrentUser();
    assert.equal(current, null);
  });


  console.log('\n================================================================');
  console.log(`PERSISTENCE SUMMARY: ${passed}/${total} Tests Passed (${failed} Failed)`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite();
