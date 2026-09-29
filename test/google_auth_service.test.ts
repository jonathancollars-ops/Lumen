/**
 * google_auth_service.test.ts — Lumen v3.7.0
 *
 * Unit tests for GoogleAuthService: configuration, authentication state observer,
 * mobile OAuth response handling, and sign-out.
 */

import './setup_env';
import assert from 'node:assert/strict';
import { GoogleAuthService } from '../src/services/GoogleAuthService';

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
  console.log('🔐 GOOGLE AUTH SERVICE UNIT TESTS');
  console.log('================================================================\n');

  await test('T1: getCurrentUser() retorna null de forma segura quando desautenticado', () => {
    const user = GoogleAuthService.getCurrentUser();
    assert.equal(user, null);
  });

  await test('T2: getGoogleAuthConfig() expõe variáveis de ambiente de Client ID', () => {
    const prevAndroid = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
    const prevWeb = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID = 'test-android-id.apps.googleusercontent.com';
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-web-id.apps.googleusercontent.com';

    const config = GoogleAuthService.getGoogleAuthConfig();
    assert.equal(config.androidClientId, 'test-android-id.apps.googleusercontent.com');
    assert.equal(config.webClientId, 'test-web-id.apps.googleusercontent.com');

    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID = prevAndroid;
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = prevWeb;
  });

  await test('T3: handleAuthResponse retorna null se a resposta for de cancelamento ou erro', async () => {
    const resCancel = await GoogleAuthService.handleAuthResponse({ type: 'cancel' });
    assert.equal(resCancel, null);

    const resDismiss = await GoogleAuthService.handleAuthResponse({ type: 'dismiss' });
    assert.equal(resDismiss, null);

    const resNull = await GoogleAuthService.handleAuthResponse(null);
    assert.equal(resNull, null);
  });

  await test('T4: handleAuthResponse retorna null se a resposta for de sucesso mas sem tokens', async () => {
    const resNoTokens = await GoogleAuthService.handleAuthResponse({
      type: 'success',
      params: {},
    });
    assert.equal(resNoTokens, null);
  });

  await test('T5: onAuthChange() aceita callback e retorna função de unsubscribe', () => {
    let calledWith: any = 'uncalled';
    const unsub = GoogleAuthService.onAuthChange((user) => {
      calledWith = user;
    });

    assert.equal(typeof unsub, 'function');
    assert.doesNotThrow(() => unsub());
  });

  await test('T6: signOut() executa de forma segura sem lançar exceções', async () => {
    await assert.doesNotReject(async () => {
      await GoogleAuthService.signOut();
    });
  });

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passed}/${total} Tests Passed (${failed} Failed)`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
