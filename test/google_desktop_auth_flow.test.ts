import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DesktopAuthDependencies, runGoogleDesktopLogin } from '../src/services/GoogleDesktopAuthFlow';
import { GoogleLoginError, GoogleLoginStage } from '../src/services/GoogleMobileAuthFlow';

const request = { clientId: 'desktop.apps.googleusercontent.com', state: 'test-state', codeVerifier: 'test-verifier', codeChallenge: 'test-challenge' };
function dependencies(overrides: Partial<DesktopAuthDependencies<string>> = {}): DesktopAuthDependencies<string> {
  return {
    start: async () => ({ port: 43210 }), open: async () => {},
    poll: async () => ({ state: request.state, code: 'test-code' }), stop: async () => {},
    exchange: async () => ({ accessToken: 'test-access-token' }), signIn: async () => 'user',
    pollIntervalMs: 1, ...overrides,
  };
}
function failure(stage: GoogleLoginStage, code: string) {
  return (error: unknown) => error instanceof GoogleLoginError && error.stage === stage && error.code === code;
}

test('desktop opens the native browser, validates the callback, exchanges with PKCE, signs in and closes its listener', async () => {
  const calls: string[] = [];
  const result = await runGoogleDesktopLogin(request, dependencies({
    onStage: stage => calls.push(stage),
    start: async state => { assert.equal(state, request.state); return { port: 43210 }; },
    open: async config => { assert.deepEqual(config, { state: request.state, clientId: request.clientId, codeChallenge: request.codeChallenge }); },
    exchange: async config => { assert.deepEqual(config, { state: request.state, code: 'test-code', codeVerifier: request.codeVerifier }); return { accessToken: 'test-token' }; },
    signIn: async tokens => { assert.equal(tokens.accessToken, 'test-token'); return 'user'; },
    stop: async state => { assert.equal(state, request.state); calls.push('stop'); },
  }));
  assert.equal(result, 'user');
  assert.deepEqual(calls, ['desktop', 'opening', 'browser', 'tokens', 'firebase', 'stop']);
});

test('missing desktop configuration does not fall back to the web client or open a browser', async () => {
  await assert.rejects(runGoogleDesktopLogin({ ...request, clientId: '' }, dependencies({
    start: async () => { assert.fail('must not start without a Desktop client'); },
  })), failure('desktop', 'desktop_client_not_configured'));
});

test('state mismatch, Google denial, missing code and invalid ports never exchange tokens', async () => {
  for (const [reply, code] of [
    [{ state: 'wrong', code: 'test-code' }, 'state_mismatch'],
    [{ state: request.state, error: 'access_denied' }, 'access_denied'],
    [{ state: request.state }, 'missing_code'],
  ] as const) {
    let stopped = false;
    await assert.rejects(runGoogleDesktopLogin(request, dependencies({
      poll: async () => reply,
      exchange: async () => { assert.fail('must not exchange rejected callbacks'); },
      stop: async () => { stopped = true; },
    })), failure('browser', code));
    assert.equal(stopped, true);
  }
  await assert.rejects(runGoogleDesktopLogin(request, dependencies({ start: async () => ({ port: 0 }) })),
    failure('desktop', 'invalid_loopback_port'));
});

test('browser-opening, token-exchange and Firebase failures close the listener and report their stage', async () => {
  for (const [stage, overrides] of [
    ['opening', { open: async () => { throw { code: 'browser_open_failed' }; } }],
    ['tokens', { exchange: async () => { throw { code: 'invalid_grant' }; } }],
    ['firebase', { signIn: async () => { throw { code: 'auth/invalid-credential' }; } }],
  ] as const) {
    let stopped = false;
    await assert.rejects(runGoogleDesktopLogin(request, dependencies({ ...overrides,
      stop: async () => { stopped = true; },
    })), error => error instanceof GoogleLoginError && error.stage === stage);
    assert.equal(stopped, true);
  }
});

test('browser timeout stops the native server and a late callback cannot exchange tokens', async () => {
  let finish!: (reply: { state: string; code: string }) => void;
  const pending = new Promise<{ state: string; code: string }>(resolve => { finish = resolve; });
  let stopped = false;
  let exchanged = false;
  await assert.rejects(runGoogleDesktopLogin(request, dependencies({
    poll: () => pending, timeouts: { browser: 5 },
    stop: async () => { stopped = true; },
    exchange: async () => { exchanged = true; return { accessToken: 'late' }; },
  })), failure('browser', 'timeout'));
  finish({ state: request.state, code: 'late-code' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, true);
  assert.equal(exchanged, false);
});

test('a late token reply after timeout cannot sign in and empty tokens fail before Firebase', async () => {
  let finish!: (tokens: { accessToken: string }) => void;
  const pending = new Promise<{ accessToken: string }>(resolve => { finish = resolve; });
  let signedIn = false;
  await assert.rejects(runGoogleDesktopLogin(request, dependencies({
    exchange: () => pending, timeouts: { tokens: 5 },
    signIn: async () => { signedIn = true; return 'user'; },
  })), failure('tokens', 'timeout'));
  finish({ accessToken: 'late' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signedIn, false);
  await assert.rejects(runGoogleDesktopLogin(request, dependencies({ exchange: async () => ({}) })), failure('tokens', 'missing_tokens'));
});
