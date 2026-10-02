import { CloudSyncStorage, SYNC_STORAGE_KEYS } from './CloudSyncStorage';
import { FirebaseBackupService } from './FirebaseBackupService';
import { subscribeStorageChanges } from './StorageChanges';

export interface CloudSyncStatus {
  state: 'disconnected' | 'syncing' | 'synced' | 'error';
  message: string;
  lastSyncedAt?: string;
  isSyncing?: boolean;
}

export class CloudSyncEngine {
  private stopped = false;
  private requested = false;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private remoteUnsubscribe: (() => void) | null = null;
  private storageUnsubscribe: (() => void) | null = null;
  private retries = 0;

  constructor(
    private readonly uid: string,
    private readonly platform: string,
    private readonly reload: () => Promise<void>,
    private readonly status: (status: CloudSyncStatus) => void,
    private readonly service = new FirebaseBackupService(uid),
    private readonly storage = CloudSyncStorage,
  ) {}

  start(): void {
    this.storageUnsubscribe = subscribeStorageChanges(key => {
      if (Object.values(SYNC_STORAGE_KEYS).includes(key as any)) this.schedule();
    });
    this.listen();
    this.schedule(0);
  }

  private listen(): void {
    if (this.remoteUnsubscribe || this.stopped) return;
    this.remoteUnsubscribe = this.service.subscribe(() => this.schedule(0), error => {
      this.remoteUnsubscribe?.();
      this.remoteUnsubscribe = null;
      this.reportError(error);
      this.retry();
    });
  }

  schedule(delay = 1000): void {
    if (this.stopped) return;
    this.requested = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow().catch(() => { /* Error already visible; retry retained. */ });
    }, delay);
  }

  async syncNow(): Promise<void> {
    if (this.stopped) return;
    this.requested = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.running) return this.running;
    this.running = this.drain();
    try { await this.running; }
    finally { this.running = null; }
  }

  private async drain(): Promise<void> {
    try {
      while (this.requested && !this.stopped) {
        this.requested = false;
        this.status({ state: 'syncing', message: 'Sincronizando alterações entre seus dispositivos…' });
        const { base, local } = await this.storage.read(this.uid);
        if (this.stopped) return;
        const remote = await this.service.synchronize(base, local, this.platform);
        if (this.stopped) return;
        const { pending, changed } = await this.storage.apply(this.uid, local, remote);
        if (this.stopped) return;
        if (changed) await this.reload();
        this.retries = 0;
        if (pending) this.requested = true;
        this.status({ state: 'synced', message: 'Dados sincronizados. As alterações são enviadas e recebidas automaticamente.', lastSyncedAt: new Date().toISOString() });
      }
    } catch (error) {
      if (!this.stopped) { this.requested = true; this.reportError(error); this.retry(); }
      throw error;
    }
  }

  private reportError(error: unknown): void {
    const code = (error as { code?: string })?.code;
    const message = code === 'permission-denied'
      ? 'O Firebase recusou o acesso aos dados. Confira as regras do Firestore para esta conta.'
      : code === 'unavailable'
        ? 'Sem conexão com o Firebase. Sua rotina está salva neste dispositivo e será sincronizada quando a conexão voltar.'
        : (error instanceof Error ? error.message : 'Não foi possível sincronizar. Tentaremos novamente automaticamente.');
    this.status({ state: 'error', message });
  }

  private retry(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.min(60000, 2000 * 2 ** Math.min(this.retries++, 5));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.listen();
      void this.syncNow().catch(() => {});
    }, delay);
  }

  stop(): void {
    this.stopped = true;
    this.remoteUnsubscribe?.();
    this.storageUnsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
  }
}
