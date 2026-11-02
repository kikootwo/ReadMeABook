/**
 * Component: One-time Application Initialization (runs inside the init route)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Readiness check (database + Redis), then credential migration and scheduler
 * start. Runs at most once per process; concurrent callers share one run.
 */

import Redis from 'ioredis';
import { prisma } from '@/lib/db';
import { getSchedulerService } from '@/lib/services/scheduler.service';
import { runCredentialMigration } from '@/lib/services/credential-migration.service';
import { RMABLogger } from '@/lib/utils/logger';
import { STARTUP_REDIS_PING_TIMEOUT_MS } from '@/lib/constants/startup';
import { processSingleton } from '@/lib/utils/process-singleton';

const logger = RMABLogger.create('Startup');

export type AppInitOutcome = 'initialized' | 'already-initialized' | 'not-ready' | 'failed';

interface InitState {
  done: boolean;
  inFlight?: Promise<AppInitOutcome>;
}

function state(): InitState {
  return processSingleton<InitState>('startup-init-state', () => ({ done: false }));
}

async function databaseReady(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.warn('Database not ready for startup init', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Redis answers PING with PONG within STARTUP_REDIS_PING_TIMEOUT_MS. The ready
 * check is off so a Redis that is still LOADING fails the PING (ioredis would
 * otherwise wait in connect() until loading finishes); the deadline covers a
 * server that accepts TCP but never answers.
 */
async function redisReady(): Promise<boolean> {
  const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: STARTUP_REDIS_PING_TIMEOUT_MS,
    retryStrategy: () => null,
  });
  // Without a listener ioredis prints "Unhandled error event" for every failed probe
  client.on('error', (error: Error) => {
    logger.debug('Redis probe error', { error: error.message });
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), STARTUP_REDIS_PING_TIMEOUT_MS);
  });
  try {
    const probe = (async () => {
      await client.connect();
      return client.ping();
    })();
    probe.catch(() => undefined); // settled below or abandoned on timeout
    const result = await Promise.race([probe, deadline]);
    if (result === 'timeout') {
      logger.warn(`Redis did not answer within ${STARTUP_REDIS_PING_TIMEOUT_MS}ms; not ready for startup init`);
      return false;
    }
    return result === 'PONG';
  } catch (error) {
    logger.warn('Redis not ready for startup init', { error: error instanceof Error ? error.message : String(error) });
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    client.disconnect();
  }
}

async function runInit(): Promise<AppInitOutcome> {
  if (!(await databaseReady()) || !(await redisReady())) return 'not-ready';
  try {
    logger.info('Initializing application services...');
    await runCredentialMigration();
    await getSchedulerService().start();
    state().done = true;
    logger.info('Application services initialized successfully');
    return 'initialized';
  } catch (error) {
    logger.error('Failed to initialize services', { error: error instanceof Error ? error.message : String(error) });
    return 'failed';
  }
}

/** Initialize once per process. Later calls return 'already-initialized' without re-running. */
export async function runAppInitOnce(): Promise<AppInitOutcome> {
  const current = state();
  if (current.done) return 'already-initialized';
  if (!current.inFlight) {
    current.inFlight = runInit().finally(() => {
      current.inFlight = undefined;
    });
  }
  return current.inFlight;
}
