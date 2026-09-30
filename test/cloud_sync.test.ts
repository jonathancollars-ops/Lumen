import { memoryStore, mockAsyncStorage } from './setup_env';
import assert from 'node:assert/strict';
import { mergeSyncBackups, SyncBackup, sameData, syncContent } from '../src/services/SyncBackupModel';
import { CloudSyncStorage } from '../src/services/CloudSyncStorage';
import { CloudSyncEngine, CloudSyncStatus } from '../src/services/CloudSyncEngine';
import { StorageService, validateBackupSchema } from '../src/services/storage';
import { FirebaseBackupService } from '../src/services/FirebaseBackupService';
import { CourseCRService } from '../src/services/CourseCRService';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function empty(): SyncBackup {
  return { version: 2, timestamp: '2026-09-30T12:00:00Z', events: [], subjects: [], attendances: [], tasks: [], studySessions: [], semesters: [], aaccActivities: [], groupProjects: [] };
}
const task = (id: string, title = id) => ({ id, title, isCompleted: false });
let count = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  console.log(`PASS ${++count}: ${name}`);
}

async function main() {
  await test('PC vazio recebe a rotina do Android e preserva o backup válido', () => {
    const phone = { ...empty(), tasks: [task('android')], events: [{ id: 'exam', title: 'Prova', date: '2026-10-30' }] };
    const merged = mergeSyncBackups(null, empty(), phone);
    assert.equal(merged.tasks[0].id, 'android');
    assert.equal(merged.events[0].date, '2026-10-30');
    assert.equal(validateBackupSchema(merged).isValid, true);
  });
  await test('primeira conexão une IDs sem duplicar nem apagar dados existentes', () => {
    const merged = mergeSyncBackups(null, { ...empty(), tasks: [task('pc'), task('shared', 'antiga')] }, { ...empty(), tasks: [task('phone'), task('shared', 'remota')] });
    assert.deepEqual(merged.tasks.map(t => t.id).sort(), ['pc', 'phone', 'shared']);
    assert.equal(merged.tasks.find(t => t.id === 'shared')?.title, 'remota');
  });
  await test('edições simultâneas em tarefas diferentes e campos diferentes sobrevivem', () => {
    const base = { ...empty(), tasks: [task('shared')] };
    const local = clone(base); local.tasks[0].title = 'Título PC'; local.tasks.push(task('pc'));
    const remote = clone(base); remote.tasks[0].isCompleted = true; remote.tasks.push(task('phone'));
    const merged = mergeSyncBackups(base, local, remote);
    assert.equal(merged.tasks.length, 3);
    assert.deepEqual(merged.tasks[0], { id: 'shared', title: 'Título PC', isCompleted: true });
  });
  await test('exclusões são propagadas e dispositivo sem baseline não ressuscita tarefa', () => {
    const base = { ...empty(), tasks: [task('delete'), task('keep')] };
    const local = { ...clone(base), tasks: [task('keep')] };
    const remote = mergeSyncBackups(base, local, base);
    assert.deepEqual(remote.deletedRecords?.tasks, ['delete']);
    const stale = mergeSyncBackups(null, base, remote);
    assert.deepEqual(stale.tasks.map(t => t.id), ['keep']);
    const receiving = mergeSyncBackups(base, base, remote);
    assert.deepEqual(receiving.tasks.map(t => t.id), ['keep']);
  });
  await test('edições offline e campos de notas em objetos aninhados são preservados', () => {
    const base: any = { ...empty(), subjects: [{ id: 's', name: 'Matemática', gradeGroups: [{ id: 'g', items: [{ id: 'a', grade: 5 }, { id: 'b', grade: 4 }] }] }] };
    const local = clone(base), remote = clone(base);
    local.subjects[0].gradeGroups[0].items[0].grade = 9;
    remote.subjects[0].gradeGroups[0].items[1].grade = 8;
    const merged: any = mergeSyncBackups(base, local, remote);
    assert.deepEqual(merged.subjects[0].gradeGroups[0].items.map((t: any) => t.grade), [9, 8]);
  });
  await test('transação migra backup 3.7.4, mantém AACC/projetos e não envia segredo/undefined', async () => {
    let cloud: any = { ...empty(), version: undefined, timestamp: undefined, updatedAt: '2026-09-28T00:00:00Z', tasks: [task('phone')], aiConfig: { apiKey: 'secret' } };
    let writes = 0;
    const paths: string[] = [];
    const deps: any = {
      db: {}, doc: (_db: any, ...path: string[]) => path.join('/'),
      runTransaction: async (_db: any, fn: any) => fn({
        get: async (path: string) => { paths.push(path); return { exists: () => !!cloud, data: () => clone(cloud) }; },
        set: (_ref: any, data: any) => { cloud = clone(data); writes++; },
      }),
    };
    const service = new FirebaseBackupService('same-google-uid', deps);
    const local: any = { ...empty(), aaccActivities: [{ id: 'aacc', title: 'Curso' }], groupProjects: [{ id: 'project', title: 'Projeto' }], settings: { currentSemesterId: undefined }, aiConfig: { apiKey: 'secret' } };
    const merged = await service.synchronize(null, local, 'windows');
    assert.equal(merged.version, 2);
    assert.equal(validateBackupSchema(merged).isValid, true);
    assert.equal(merged.tasks[0].id, 'phone');
    assert.equal(merged.aaccActivities?.length, 1);
    assert.equal(merged.groupProjects?.length, 1);
    assert.equal(JSON.stringify(cloud).includes('secret'), false);
    assert.deepEqual(paths, ['users/same-google-uid/backup/latest']);
    await service.synchronize(merged, merged, 'windows');
    assert.equal(writes, 1, 'snapshot echoes must not trigger another write');
    cloud = { version: 2, timestamp: 'now' };
    await assert.rejects(service.synchronize(merged, merged, 'windows'), /incompleto/);
  });
  await test('alteração salva durante a rede permanece no disco e pendente de envio', async () => {
    await mockAsyncStorage.clear();
    await StorageService.saveTasks([task('local') as any]);
    const captured = await CloudSyncStorage.read('uid');
    await StorageService.saveTasks([task('local', 'editada durante upload') as any, task('later') as any]);
    const remote = mergeSyncBackups(null, captured.local, { ...empty(), tasks: [task('phone')] });
    assert.equal((await CloudSyncStorage.apply('uid', captured.local, remote)).pending, true);
    const after = await CloudSyncStorage.read('uid');
    assert.equal(after.local.tasks.find(t => t.id === 'local')?.title, 'editada durante upload');
    assert.equal(after.local.tasks.length, 3);
    assert.deepEqual(after.base?.tasks.map(t => t.id).sort(), ['local', 'phone']);
  });
  await test('erro de leitura/JSON bloqueia envio em vez de fabricar uma rotina vazia', async () => {
    memoryStore['@organiza_tasks'] = '{invalid';
    await assert.rejects(CloudSyncStorage.read('uid'));
    memoryStore['@organiza_tasks'] = '[]';
    const get = mockAsyncStorage.multiGet;
    mockAsyncStorage.multiGet = async () => { throw new Error('read failed'); };
    try { await assert.rejects(CloudSyncStorage.read('uid'), /read failed/); }
    finally { mockAsyncStorage.multiGet = get; }
  });
  await test('histórico/CR também entra na sincronização e no backup local', async () => {
    await mockAsyncStorage.clear();
    const progress = { officialCR: 9.12, totalRequiredCredits: 200, completedCredits: 80, semesters: [{ semesterNumber: 1, title: '1', subjects: [{ id: 'history', name: 'Cálculo', credits: 4, isCompleted: true }] }] };
    await CourseCRService.saveCourseProgress(progress);
    const captured = await CloudSyncStorage.read('uid');
    assert.equal(captured.local.courseProgress?.officialCR, 9.12);
    assert.equal((await StorageService.exportBackup()).courseProgress?.officialCR, 9.12);
  });
  await test('dois motores convergem por listener, incluindo alterações e exclusões nos dois sentidos', async () => {
    let remote: SyncBackup | null = null;
    let writeCount = 0;
    const listeners = new Set<() => void>();
    function device(initial: SyncBackup) {
      let local = clone(initial), base: SyncBackup | null = null;
      let engine: CloudSyncEngine;
      const storage: typeof CloudSyncStorage = {
        read: async () => ({ local: clone(local), base: clone(base) }),
        apply: async (_uid, captured, result) => {
          local = mergeSyncBackups(captured, local, result);
          base = clone(result);
          return { pending: !sameData(syncContent(local), syncContent(result)), changed: !sameData(syncContent(captured), syncContent(local)) };
        },
      };
      const service: any = {
        subscribe: (notify: () => void) => { listeners.add(notify); return () => listeners.delete(notify); },
        synchronize: async (baseline: SyncBackup | null, current: SyncBackup) => {
          const merged = mergeSyncBackups(baseline, current, remote);
          if (!sameData(syncContent(merged), syncContent(remote))) {
            remote = clone(merged); writeCount++;
            for (const notify of listeners) notify();
          }
          return clone(remote);
        },
      };
      engine = new CloudSyncEngine('uid', 'web', async () => {}, () => {}, service, storage);
      return { engine, read: () => clone(local), edit: (next: SyncBackup) => { local = next; engine.schedule(); } };
    }
    const phone = device({ ...empty(), tasks: [task('phone')] });
    const pc = device(empty());
    phone.engine.start(); pc.engine.start();
    try {
      await phone.engine.syncNow(); await pc.engine.syncNow();
      assert.equal(pc.read().tasks[0].id, 'phone');
      const updated = pc.read(); updated.tasks[0].title = 'Editada no PC';
      pc.edit(updated); await pc.engine.syncNow(); await phone.engine.syncNow();
      assert.equal(phone.read().tasks[0].title, 'Editada no PC');
      phone.edit({ ...phone.read(), tasks: [] }); await phone.engine.syncNow(); await pc.engine.syncNow();
      assert.equal(pc.read().tasks.length, 0);
      const settled = writeCount;
      await pc.engine.syncNow(); await phone.engine.syncNow();
      assert.equal(writeCount, settled);
    } finally { phone.engine.stop(); pc.engine.stop(); }
    assert.equal(listeners.size, 0);
  });
  await test('falha de permissão aparece e mudanças locais sobrevivem para nova tentativa', async () => {
    await mockAsyncStorage.clear();
    await StorageService.saveTasks([task('offline') as any]);
    let fail = true;
    const statuses: CloudSyncStatus[] = [];
    const service: any = {
      subscribe: () => () => {},
      synchronize: async (_base: any, local: SyncBackup) => {
        if (fail) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
        return mergeSyncBackups(null, local, empty());
      },
    };
    const engine = new CloudSyncEngine('uid', 'android', async () => {}, status => statuses.push(status), service);
    engine.start();
    try {
      await assert.rejects(engine.syncNow(), /denied/);
      assert.equal((await StorageService.getTasks())[0].id, 'offline');
      assert.equal(statuses.at(-1)?.state, 'error');
      assert.match(statuses.at(-1)!.message, /regras/);
      fail = false;
      await engine.syncNow();
      assert.equal(statuses.at(-1)?.state, 'synced');
    } finally { engine.stop(); }
  });
  await test('debounce do motor agrupa gravações e não perde pedidos durante envio', async () => {
    let calls = 0;
    let release: (() => void) | null = null;
    let block = false;
    const service: any = {
      subscribe: () => () => {},
      synchronize: async (_base: any, local: SyncBackup) => {
        calls++;
        if (block) { block = false; await new Promise<void>(resolve => { release = resolve; }); }
        return mergeSyncBackups(null, local, empty());
      },
    };
    const engine = new CloudSyncEngine('uid', 'web', async () => {}, () => {}, service);
    engine.start();
    try {
      await engine.syncNow(); calls = 0;
      for (let i = 0; i < 10; i++) engine.schedule(20);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(calls, 1);
      block = true;
      const sending = engine.syncNow();
      while (!release) await new Promise(resolve => setTimeout(resolve, 1));
      const before = calls;
      engine.schedule();
      release!(); await sending;
      assert.equal(calls, before + 1, 'a request arriving during upload must run afterward');
    } finally { engine.stop(); }
  });
  await test('logout durante envio impede aplicar a resposta antiga no dispositivo', async () => {
    let release: (() => void) | null = null;
    let applied = false;
    const storage: typeof CloudSyncStorage = {
      read: async () => ({ base: null, local: empty() }),
      apply: async () => { applied = true; return { pending: false, changed: true }; },
    };
    const service: any = {
      subscribe: () => () => {},
      synchronize: async () => { await new Promise<void>(resolve => { release = resolve; }); return empty(); },
    };
    const engine = new CloudSyncEngine('uid', 'web', async () => {}, () => {}, service, storage);
    const sending = engine.syncNow();
    while (!release) await new Promise(resolve => setTimeout(resolve, 1));
    engine.stop(); release!(); await sending;
    assert.equal(applied, false);
  });
  console.log(`${count} cloud sync tests passed`);
}
main().catch(error => { console.error(error); process.exit(1); });
