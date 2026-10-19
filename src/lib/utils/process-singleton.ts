/**
 * Component: Process-wide Singletons
 * Documentation: documentation/backend/services/scheduler.md
 *
 * A module that the bundler includes in more than one server entry (for example
 * the instrumentation hook and the route handlers) can be evaluated more than
 * once in the same process, giving each copy its own module-level `let instance`.
 * Services that own process resources (DB pool, Bull queue + processors,
 * scheduler) keep their instance on globalThis so all copies share one.
 */

type SingletonStore = Record<symbol, unknown>;

const store = globalThis as unknown as SingletonStore;

/** Return the process-wide instance for `key`, creating it once. */
export function processSingleton<T>(key: string, create: () => T): T {
  const slot = Symbol.for(`rmab.singleton.${key}`);
  if (!(slot in store) || store[slot] === undefined) {
    store[slot] = create();
  }
  return store[slot] as T;
}

/** Return the process-wide instance for `key` without creating it. */
export function peekProcessSingleton<T>(key: string): T | undefined {
  return store[Symbol.for(`rmab.singleton.${key}`)] as T | undefined;
}

/** Run `register` once per process for `key` (e.g. process.on hooks). */
export function oncePerProcess(key: string, register: () => void): void {
  const slot = Symbol.for(`rmab.once.${key}`);
  if (store[slot]) return;
  store[slot] = true;
  register();
}
