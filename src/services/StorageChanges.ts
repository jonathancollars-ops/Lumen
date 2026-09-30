// All synchronized writes and cloud restores share a queue. A restore cannot
// overwrite an edit made while a network request was in flight.
let writes: Promise<unknown> = Promise.resolve();
const listeners = new Set<(key: string) => void>();

export function withStorageWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation);
  writes = result.catch(() => undefined);
  return result;
}

export function notifyStorageChange(key: string): void {
  for (const listener of listeners) listener(key);
}

export function subscribeStorageChanges(listener: (key: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
