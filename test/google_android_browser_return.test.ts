import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureGoogleAndroidBrowserReturn } from '../src/services/GoogleAndroidBrowserReturn';
import { GoogleOAuthResponse, GoogleLoginError, runGoogleMobileLogin } from '../src/services/GoogleMobileAuthFlow';

const redirectUri = 'com.example.App:/oauthredirect';
const success: GoogleOAuthResponse = { type: 'success', params: { code: 'test-code' } };
function capture(prompt: () => Promise<GoogleOAuthResponse>, parseReturnUrl = (_url: string) => success) {
  let listener: ((url: string) => void) | undefined;
  let removed = false;
  const browser = captureGoogleAndroidBrowserReturn({
    redirectUri, prompt, parseReturnUrl, graceMs: 25,
    subscribe: callback => { listener = callback; return () => { removed = true; listener = undefined; }; },
  });
  return { browser, emit: (url: string) => listener?.(url), removed: () => removed };
}

test('a callback arriving after Android reports dismiss still completes login', async () => {
  const session = capture(async () => ({ type: 'dismiss' }));
  const pending = session.browser.prompt();
  await new Promise(resolve => setImmediate(resolve));
  session.emit(`${redirectUri}?code=test-code&state=expected-state`);
  assert.deepEqual(await pending, success);
  assert.equal(session.removed(), true);
});

test('captures the callback before the browser promise resolves, including scheme case changes', async () => {
  let received = '';
  const session = capture(() => new Promise(() => {}), url => { received = url; return success; });
  const pending = session.browser.prompt();
  const url = 'com.example.app:/oauthredirect?code=test-code&state=expected-state';
  session.emit(url);
  assert.deepEqual(await pending, success);
  assert.equal(received, url);
  assert.equal(session.removed(), true);
});

test('unrelated schemes, paths, authorities and prefix lookalikes cannot complete login', async () => {
  let parsed = false;
  const session = capture(async () => ({ type: 'dismiss' }), () => { parsed = true; return success; });
  const pending = session.browser.prompt();
  for (const url of [
    'lumen:/oauthredirect?code=wrong', 'com.example.App:/oauthredirect-extra?code=wrong',
    'com.example.App://attacker/oauthredirect?code=wrong', 'com.example.App:/other?code=wrong',
    'com.example.App:/oauthredirect/../other?code=wrong',
  ]) session.emit(url);
  assert.equal((await pending).type, 'dismiss');
  assert.equal(parsed, false);
  assert.equal(session.removed(), true);
});

test('OAuth state errors from AuthRequest are preserved instead of turning into success', async () => {
  const session = capture(() => new Promise(() => {}), () => ({
    type: 'error', error: { code: 'state_mismatch' },
  }));
  const pending = session.browser.prompt();
  session.emit(`${redirectUri}?code=test-code&state=wrong-state`);
  assert.equal((await pending).error?.code, 'state_mismatch');
  assert.equal(session.removed(), true);
});

test('browser errors and cancellations are preserved and listeners are removed', async () => {
  for (const result of [{ type: 'cancel' }, { type: 'error', error: { code: 'invalid_request' } }]) {
    const session = capture(async () => result);
    assert.deepEqual(await session.browser.prompt(), result);
    assert.equal(session.removed(), true);
  }
  const session = capture(async () => { throw new Error('browser failed'); });
  await assert.rejects(session.browser.prompt(), /browser failed/);
  assert.equal(session.removed(), true);
});

test('timeout disposes the listener and a late callback cannot sign into Firebase', async () => {
  let signedIn = false;
  const session = capture(() => new Promise(() => {}));
  await assert.rejects(runGoogleMobileLogin({ clientId: 'test', redirectUri, codeVerifier: 'test' }, {
    prompt: session.browser.prompt,
    dismiss: session.browser.dispose,
    exchange: async () => ({ idToken: 'late-token' }),
    signIn: async () => { signedIn = true; return {}; },
    timeouts: { browser: 5 },
  }), error => error instanceof GoogleLoginError && error.code === 'timeout');
  session.emit(`${redirectUri}?code=late-code`);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.removed(), true);
  assert.equal(signedIn, false);
});
