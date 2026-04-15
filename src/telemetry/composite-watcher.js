import { EventEmitter } from 'node:events';

export function createCompositeWatcher(watchers = []) {
  const emitter = new EventEmitter();
  const unsubscribers = watchers.flatMap((watcher) => [
    watcher.on?.('session:update', (payload) => emitter.emit('session:update', payload)),
    watcher.on?.('session:idle', (payload) => emitter.emit('session:idle', payload)),
  ]).filter(Boolean);

  return {
    start() {
      for (const watcher of watchers) watcher.start?.();
    },
    async stop() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      await Promise.all(watchers.map((watcher) => watcher.stop?.()).filter(Boolean));
    },
    registerLaunch(payload) {
      for (const watcher of watchers) watcher.registerLaunch?.(payload);
    },
    ingestUsage(providerSessionId, projectPath, usage) {
      for (const watcher of watchers) {
        if (typeof watcher.ingestUsage === 'function') {
          return watcher.ingestUsage(providerSessionId, projectPath, usage);
        }
      }
      return null;
    },
    snapshot() {
      return watchers.flatMap((watcher) => watcher.snapshot?.() ?? []);
    },
    on(eventName, handler) {
      emitter.on(eventName, handler);
      return () => emitter.off(eventName, handler);
    },
  };
}
