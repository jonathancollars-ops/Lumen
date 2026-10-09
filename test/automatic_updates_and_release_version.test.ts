import './setup_env';
import assert from 'node:assert/strict';
import React from 'react';
import { AppUpdateService } from '../src/services/AppUpdateService';
import { useAutomaticAppUpdates } from '../src/hooks/useAutomaticAppUpdates';
import { APP_VERSION, bumpVersion, isNewerVersion } from '../src/utils/version';
import { mockAsyncStorage, mockReactNative, triggerAppStateChange } from './setup_env';
import type { AppUpdateInfo } from '../src/types';
const { verifyMetadata, verifyPublishedRelease } = require('../scripts/verify_release_version');

const realFetch = globalThis.fetch;
const RealDate = Date;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const originalWindow = (globalThis as any).window;
const newVersion = bumpVersion(APP_VERSION, 'patch');
const release = (version: string, names: string[]) => ({
  tag_name: `v${version}`, name: `Lumen ${version}`, body: 'Correções',
  html_url: `https://github.com/jonathancollars-ops/organiza/releases/tag/v${version}`,
  assets: names.map(name => ({ name,
    browser_download_url: `https://github.com/jonathancollars-ops/organiza/releases/download/v${version}/${name}` })),
});
const reply = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data }) as Response;

async function run() {
  mockReactNative.Platform.OS = 'windows';
  await mockAsyncStorage.clear();
  const requested: string[] = [];
  globalThis.fetch = async input => {
    requested.push(String(input));
    return String(input).endsWith('/latest')
      ? reply(release('3.9.0', ['lumen.apk']))
      : reply([
        release('3.9.0', ['lumen.apk']),
        release('3.8.1', ['lumen-portable.exe']),
        { ...release('3.9.1', ['lumen-setup.exe']), prerelease: true },
        release('3.8.0', ['lumen-setup.exe', 'lumen.msi']),
      ]);
  };
  const compatible = await AppUpdateService.checkForUpdates();
  assert.equal(compatible?.latestVersion, '3.8.0');
  assert.ok(compatible?.downloadUrl.endsWith('/v3.8.0/lumen-setup.exe'));
  assert.equal(requested.length, 2, 'A platform-specific release is found beyond /latest');
  console.log('PASS: Windows finds its latest compatible installer across platform-specific releases');

  await mockAsyncStorage.clear();
  globalThis.fetch = async input => String(input).endsWith('/latest')
    ? reply(release(newVersion, ['lumen.apk', 'lumen-portable.exe'])) : reply([]);
  assert.equal(await AppUpdateService.checkForUpdates(), null,
    'Automatic checks wait for a real Windows installer instead of offering a portable EXE or APK');
  assert.equal((await AppUpdateService.getUpdateState()).lastCheckedAt, undefined);
  const manual = await AppUpdateService.checkForUpdates(true);
  assert.equal(manual?.hasUpdate, true);
  assert.ok(manual?.downloadUrl.includes('/releases/tag/'));

  await mockAsyncStorage.clear();
  let attempts = 0;
  globalThis.fetch = async () => ++attempts === 1 ? reply({}, 503)
    : reply(release(newVersion, ['lumen-setup.exe']));
  assert.equal(await AppUpdateService.checkForUpdates(), null);
  assert.equal((await AppUpdateService.getUpdateState()).lastCheckedAt, undefined);
  assert.equal((await AppUpdateService.checkForUpdates())?.hasUpdate, true,
    'A failed network check can retry immediately after reconnection');
  assert.equal(attempts, 2);
  await AppUpdateService.recordPromptDismissed(newVersion);
  assert.equal(await AppUpdateService.shouldShowAutomaticPrompt(newVersion), false);
  assert.equal(await AppUpdateService.shouldShowAutomaticPrompt(bumpVersion(newVersion, 'patch')), true,
    'Deferring one version does not suppress a newer release');
  assert.equal((await AppUpdateService.getUpdateState()).ignoredVersion, undefined);
  console.log('PASS: offline retry, pending installers and per-version reminder cooldown');

  await mockAsyncStorage.clear();
  mockReactNative.Platform.OS = 'web';
  let now = new RealDate('2026-10-08T10:00:00').getTime();
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) { return args.length ? Reflect.construct(target, args) : new RealDate(now); },
    get(target, key, receiver) { return key === 'now' ? () => now : Reflect.get(target, key, receiver); },
  });
  const listeners = new Map<string, () => void>();
  (globalThis as any).window = {
    __TAURI_INTERNALS__: {},
    addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
    removeEventListener: (event: string) => listeners.delete(event),
  };
  let interval: () => void = () => {};
  let cleared = false;
  globalThis.setInterval = ((callback: () => void, ms: number) => {
    assert.equal(ms, 15 * 60 * 1000);
    interval = callback;
    return 123;
  }) as any;
  globalThis.clearInterval = (() => { cleared = true; }) as any;
  let checks = 0;
  globalThis.fetch = async () => ++checks === 1 ? reply({}, 503)
    : reply(release(newVersion, ['lumen-setup.exe']));
  const effects: (() => (() => void))[] = [];
  const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  internals.H = { useRef: (initial: unknown) => ({ current: initial }),
    useEffect: (effect: () => (() => void)) => effects.push(effect) };
  const available: AppUpdateInfo[] = [];
  try { useAutomaticAppUpdates(info => available.push(info)); } finally { internals.H = previous; }
  const cleanups = effects.map(effect => effect());
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  assert.equal(checks, 1, 'A desktop check starts automatically');
  assert.equal(available.length, 0);
  listeners.get('online')!();
  await settle();
  assert.equal(checks, 2);
  assert.equal(available.length, 1);
  listeners.get('focus')!();
  triggerAppStateChange('active');
  await settle();
  assert.equal(checks, 2, 'Focus/resume checks respect the network throttle');
  now += 4 * 60 * 60 * 1000;
  interval();
  await settle();
  assert.equal(checks, 3, 'An open desktop session checks again without restarting');
  assert.equal(available.length, 1, 'The same release respects the prompt cooldown');
  now += 21 * 60 * 60 * 1000;
  interval();
  await settle();
  assert.equal(available.length, 2, 'Remind later offers the release again after 24 hours');
  cleanups.forEach(cleanup => cleanup());
  assert.equal(cleared, true);
  assert.equal(listeners.size, 0);
  console.log('PASS: actual automatic-update hook on launch, online, focus, resume and long sessions');

  assert.equal(verifyMetadata(), APP_VERSION);
  assert.ok(isNewerVersion(APP_VERSION, '3.7.6'), 'Installed 3.7.6 clients detect this new patch');
  const env = { GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_SHA: 'a'.repeat(40), GITHUB_TOKEN: 'test-token' };
  await verifyPublishedRelease(APP_VERSION, 'windows', env, async () => reply({}, 404));
  await verifyPublishedRelease(APP_VERSION, 'windows', env, async () =>
    reply({ ...release(APP_VERSION, ['lumen.apk']), target_commitish: env.GITHUB_SHA }));
  await assert.rejects(verifyPublishedRelease(APP_VERSION, 'windows', env, async () =>
    reply(release(APP_VERSION, ['lumen-setup.exe']))), /já foi publicado/);
  await assert.rejects(verifyPublishedRelease(APP_VERSION, 'android', env, async () =>
    reply(release(APP_VERSION, ['lumen.apk']))), /já foi publicado/);
  await assert.rejects(verifyPublishedRelease(APP_VERSION, 'windows', env, async () =>
    reply({ ...release(APP_VERSION, ['lumen.apk']), target_commitish: 'b'.repeat(40) })), /mesmo commit/);
  await assert.rejects(verifyPublishedRelease(APP_VERSION, 'windows', { ...env, GITHUB_REF: 'refs/tags/v1.0.0' },
    async () => reply({}, 404)), /A tag deve ser/);
  await assert.rejects(verifyPublishedRelease(APP_VERSION, 'windows', env, async () => reply({}, 403)), /HTTP 403/);
  console.log('PASS: aligned package versions and publication guards against reused versions/tags');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = realFetch;
  globalThis.Date = RealDate;
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  (globalThis as any).window = originalWindow;
});
