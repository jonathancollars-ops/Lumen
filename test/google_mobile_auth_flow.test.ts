import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeGoogleLoginError, GoogleLoginError, GoogleLoginStage,
  GoogleMobileAuthDependencies, runGoogleMobileLogin,
} from '../src/services/GoogleMobileAuthFlow';

const request = { clientId: 'android-client', redirectUri: 'com.example.app:/oauthredirect', codeVerifier: 'pkce-verifier' };
const user = { uid: 'test-user' };
function dependencies(overrides: Partial<GoogleMobileAuthDependencies<typeof user>> = {}) {
  return {
    prompt: async () => ({ type: 'success', params: { code: 'test-authorization-code' } }),
    exchange: async () => ({ idToken: 'test-id-token' }),
    signIn: async () => user,
    ...overrides,
  };
}
function isFailure(stage: GoogleLoginStage, code: string) {
  return (error: unknown) => error instanceof GoogleLoginError && error.stage === stage && error.code === code;
}

test('authorization code is exchanged using the same redirect URI and PKCE before Firebase login', async () => {
  const stages: string[] = [];
  const result = await runGoogleMobileLogin(request, dependencies({
    onStage: stage => { stages.push(stage); },
    exchange: async config => {
      assert.deepEqual(config, { ...request, code: 'test-authorization-code' });
      return { idToken: 'test-id-token', accessToken: 'test-access-token' };
    },
    signIn: async tokens => {
      assert.deepEqual(tokens, { idToken: 'test-id-token', accessToken: 'test-access-token' });
      return user;
    },
  }));
  assert.equal(result, user);
  assert.deepEqual(stages, ['browser', 'tokens', 'firebase']);
});

test('a response with tokens does not exchange the code a second time', async () => {
  await runGoogleMobileLogin(request, dependencies({
    prompt: async () => ({ type: 'success', params: { id_token: 'existing-token', code: 'unused-code' } }),
    exchange: async () => { throw new Error('unexpected exchange'); },
    signIn: async tokens => { assert.equal(tokens.idToken, 'existing-token'); return user; },
  }));
});

test('cancellation, dismissal, locked session and OAuth errors have distinct diagnostics and never call Firebase', async () => {
  for (const [type, code] of [['cancel', 'cancel'], ['dismiss', 'dismiss'], ['locked', 'session_locked']]) {
    await assert.rejects(runGoogleMobileLogin(request, dependencies({
      prompt: async () => ({ type }),
      signIn: async () => { assert.fail('Firebase must not be called'); },
    })), isFailure('browser', code));
  }
  await assert.rejects(runGoogleMobileLogin(request, dependencies({
    prompt: async () => ({ type: 'error', params: { error: 'invalid_request' } }),
  })), isFailure('browser', 'invalid_request'));
});

test('token exchange rejection reaches the caller instead of silently losing the OAuth result', async () => {
  await assert.rejects(runGoogleMobileLogin(request, dependencies({
    exchange: async () => { throw { code: 'invalid_grant', message: 'secret-token-and-email' }; },
    signIn: async () => { assert.fail('Firebase must not be called'); },
  })), error => {
    assert.ok(isFailure('tokens', 'invalid_grant')(error));
    const message = describeGoogleLoginError(error);
    assert.ok(message.includes('invalid_grant'));
    assert.ok(!message.includes('secret-token-and-email'));
    return true;
  });
});

test('missing PKCE verifier and empty token responses fail before Firebase', async () => {
  await assert.rejects(runGoogleMobileLogin({ ...request, codeVerifier: undefined }, dependencies()),
    isFailure('tokens', 'missing_pkce_verifier'));
  await assert.rejects(runGoogleMobileLogin(request, dependencies({ exchange: async () => ({}) })),
    isFailure('tokens', 'missing_tokens'));
  await assert.rejects(runGoogleMobileLogin(request, dependencies({ prompt: async () => ({ type: 'success' }) })),
    isFailure('tokens', 'missing_tokens'));
});

test('Firebase rejection reports its stage and code without printing credentials', async () => {
  await assert.rejects(runGoogleMobileLogin(request, dependencies({
    signIn: async () => { throw { code: 'auth/invalid-credential', message: 'credential-secret' }; },
  })), isFailure('firebase', 'auth/invalid-credential'));
  await assert.rejects(runGoogleMobileLogin(request, dependencies({
    exchange: async () => { throw { code: 'https://example.test/?token=secret', message: 'secret' }; },
  })), isFailure('tokens', 'tokens_failed'));
});

test('browser timeout dismisses the session; a late return cannot exchange tokens or sign in', async () => {
  let finish!: (value: { type: string; params: { code: string } }) => void;
  const pending = new Promise<{ type: string; params: { code: string } }>(resolve => { finish = resolve; });
  let dismissed = false;
  let exchanged = false;
  await assert.rejects(runGoogleMobileLogin(request, dependencies({
    prompt: () => pending,
    dismiss: () => { dismissed = true; },
    exchange: async () => { exchanged = true; return { idToken: 'late-token' }; },
    timeouts: { browser: 5 },
  })), isFailure('browser', 'timeout'));
  finish({ type: 'success', params: { code: 'late-code' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dismissed, true);
  assert.equal(exchanged, false);
});

test('token timeout prevents late tokens from being sent to Firebase', async () => {
  let finish!: (value: { idToken: string }) => void;
  const pending = new Promise<{ idToken: string }>(resolve => { finish = resolve; });
  let signedIn = false;
  await assert.rejects(runGoogleMobileLogin(request, dependencies({
    exchange: () => pending,
    signIn: async () => { signedIn = true; return user; },
    timeouts: { tokens: 5 },
  })), isFailure('tokens', 'timeout'));
  finish({ idToken: 'late-token' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signedIn, false);
});

test('Firebase timeout releases the caller even when the SDK request stays pending', async () => {
  await assert.rejects(runGoogleMobileLogin(request, dependencies({
    signIn: () => new Promise(() => {}), timeouts: { firebase: 5 },
  })), isFailure('firebase', 'timeout'));
});
