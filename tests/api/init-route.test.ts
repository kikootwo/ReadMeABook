/**
 * Component: Internal Startup Init Route Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbReady = vi.hoisted(() => ({ value: true }));
/** 'ready' | 'loading' (dataset still loading) | 'silent' (accepts TCP, never answers) */
const redisState = vi.hoisted(() => ({ value: 'ready' as 'ready' | 'loading' | 'silent', errorListeners: 0 }));
const schedulerStart = vi.hoisted(() => vi.fn());
const credentialMigration = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: async () => {
      if (!dbReady.value) throw new Error('db down');
      return 1;
    },
  },
}));
// Shaped like ioredis: with the ready check on, connect() waits until loading ends;
// with it off, PING gets "-LOADING" as a reply error. A silent server never answers.
vi.mock('ioredis', () => ({
  default: class {
    constructor(_url: string, private readonly options: { enableReadyCheck?: boolean } = {}) {}
    on(event: string) {
      if (event === 'error') redisState.errorListeners++;
      return this;
    }
    connect() {
      if (redisState.value === 'silent') return new Promise(() => undefined);
      if (redisState.value === 'loading' && this.options.enableReadyCheck !== false) return new Promise(() => undefined);
      return Promise.resolve();
    }
    ping() {
      if (redisState.value === 'silent') return new Promise(() => undefined);
      if (redisState.value === 'loading') {
        return Promise.reject(Object.assign(new Error('LOADING Redis is loading the dataset in memory'), { name: 'ReplyError' }));
      }
      return Promise.resolve('PONG');
    }
    disconnect() {}
  },
}));
vi.mock('@/lib/constants/startup', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  STARTUP_REDIS_PING_TIMEOUT_MS: 200,
}));
vi.mock('@/lib/services/scheduler.service', () => ({ getSchedulerService: () => ({ start: schedulerStart }) }));
vi.mock('@/lib/services/credential-migration.service', () => ({ runCredentialMigration: credentialMigration }));

const INIT_STATE = Symbol.for('rmab.singleton.startup-init-state');
const SECRET = Symbol.for('rmab.singleton.startup-secret');

function post(token?: string) {
  const headers = new Headers();
  if (token !== undefined) headers.set('x-rmab-startup-token', token);
  return { headers } as any;
}

async function load() {
  const route = await import('@/app/api/init/route');
  const { getOrCreateStartupSecret } = await import('@/lib/startup/startup-secret');
  return { route, secret: getOrCreateStartupSecret() };
}

describe('/api/init', () => {
  beforeEach(() => {
    delete (globalThis as any)[INIT_STATE];
    delete (globalThis as any)[SECRET];
    dbReady.value = true;
    redisState.value = 'ready';
    schedulerStart.mockResolvedValue(undefined);
    credentialMigration.mockResolvedValue(undefined);
  });

  it('has no GET handler (Next answers 405)', async () => {
    const route = await import('@/app/api/init/route');
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });

  it.each([
    ['no secret header', undefined],
    ['an empty secret', ''],
    ['a wrong secret of the same length', 'f'.repeat(64)],
    ['a wrong secret of a different length', 'short'],
  ])('returns 404 for %s and does not initialize', async (_label, token) => {
    const { route } = await load();
    const response = await route.POST(post(token));

    expect(response.status).toBe(404);
    expect(schedulerStart).not.toHaveBeenCalled();
    expect(credentialMigration).not.toHaveBeenCalled();
  });

  it('returns 404 when no secret exists in this process', async () => {
    const route = await import('@/app/api/init/route');
    const response = await route.POST(post('anything'));
    expect(response.status).toBe(404);
  });

  it('runs initialization once; later calls do not re-run it', async () => {
    const { route, secret } = await load();

    const first = await route.POST(post(secret));
    const second = await route.POST(post(secret));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ success: true, alreadyInitialized: true });
    expect(schedulerStart).toHaveBeenCalledTimes(1);
    expect(credentialMigration).toHaveBeenCalledTimes(1);
  });

  it('shares one run between concurrent calls', async () => {
    const { route, secret } = await load();
    let release!: () => void;
    schedulerStart.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));

    const calls = Promise.all([route.POST(post(secret)), route.POST(post(secret))]);
    await vi.waitFor(() => expect(schedulerStart).toHaveBeenCalled());
    release();
    const responses = await calls;

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(schedulerStart).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the database is down', () => { dbReady.value = false; }],
    ['Redis is still loading its dataset', () => { redisState.value = 'loading'; }],
    ['Redis accepts connections but never answers', () => { redisState.value = 'silent'; }],
  ])('returns 503 when %s, then initializes once ready', async (_label, breakIt) => {
    const { route, secret } = await load();
    breakIt();

    const started = Date.now();
    const notReady = await route.POST(post(secret));
    expect(notReady.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(schedulerStart).not.toHaveBeenCalled();

    dbReady.value = true;
    redisState.value = 'ready';
    expect((await route.POST(post(secret))).status).toBe(200);
    expect(schedulerStart).toHaveBeenCalledTimes(1);
  });

  it('listens for Redis probe errors (no "Unhandled error event")', async () => {
    const { route, secret } = await load();
    await route.POST(post(secret));
    expect(redisState.errorListeners).toBeGreaterThan(0);
  });

  it('returns a generic 500 on failure and retries on the next call', async () => {
    const { route, secret } = await load();
    schedulerStart.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:6379 secret-detail'));

    const failed = await route.POST(post(secret));
    const body = await failed.json();
    expect(failed.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-detail');

    expect((await route.POST(post(secret))).status).toBe(200);
    expect(schedulerStart).toHaveBeenCalledTimes(2);
  });
});
