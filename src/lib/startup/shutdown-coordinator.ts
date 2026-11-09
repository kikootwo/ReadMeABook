/**
 * Component: App Shutdown Coordinator (SIGTERM / SIGINT)
 * Documentation: documentation/deployment/unified.md
 *
 * Owns the stop when NEXT_MANUAL_SIG_HANDLE=true (exported by docker/unified/app-start.sh,
 * read by Next before register() runs). Order, all within SHUTDOWN_HARD_DEADLINE_MS:
 * stop HTTP + new jobs → running jobs and requests get SHUTDOWN_DRAIN_MS → close the queue
 * (only when nothing is left running) → flush job-row writes → disconnect Prisma and
 * Redis → exit 0. Every step is bounded and they end before the hard deadline, which
 * exits 1 if the event loop ran late. A blocked event loop fires no timer at all:
 * app-start.sh then SIGKILLs node by wall clock (APP_STOP_KILL_AFTER).
 * Only peeks the process singletons: never creates the job queue (that starts workers)
 * or Prisma, and imports neither, so the instrumentation bundle stays small.
 * Dependency-light like startup-trigger.ts: console logging, no Prisma/logger imports.
 */

import diagnosticsChannel from 'node:diagnostics_channel';
import { SHUTDOWN_DRAIN_MS, SHUTDOWN_HARD_DEADLINE_MS, SHUTDOWN_STEP_LIMIT_MS } from '@/lib/constants/shutdown';
import { JOB_QUEUE_SINGLETON_KEY, type ActiveJobInfo, type QueueShutdownTarget } from '@/lib/services/job-activity-tracker';
import { oncePerProcess, peekProcessSingleton } from '@/lib/utils/process-singleton';
import { markProcessStopping } from '@/lib/utils/process-stopping';

/** Node's built-in channel published at the start of every HTTP request (carries the server) */
export const HTTP_REQUEST_CHANNEL = 'http.server.request.start';

export interface ClosableServer {
  close(callback?: (error?: Error) => void): unknown;
  closeAllConnections?(): void;
}

type Level = 'info' | 'warn' | 'error';

export interface ShutdownDeps {
  getServer: () => ClosableServer | undefined;
  getQueue: () => QueueShutdownTarget | undefined;
  getPrisma: () => { $disconnect(): Promise<void> } | undefined;
  markStopping: () => void;
  exit: (code: number) => void;
  log: (level: Level, message: string) => void;
  now: () => number;
}

type Outcome = 'done' | 'timeout' | 'error';

/** Settle `work` or give up after `ms`. Never rejects. */
async function within(work: () => Promise<unknown> | unknown, ms: number): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), Math.max(0, ms));
  });
  const run = (async () => {
    await work();
    return 'done' as const;
  })().catch(() => 'error' as const);
  try {
    return await Promise.race([run, limit]);
  } finally {
    clearTimeout(timer);
  }
}

function closeServer(server: ClosableServer): Promise<void> {
  // Stops accepting connections and drops idle keep-alive ones; in-flight requests carry on
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function describe(job: ActiveJobInfo): string {
  return `${job.id} ${job.name}${job.requestId ? ` (request ${job.requestId})` : ''}`;
}

async function runShutdown(signal: string, deps: ShutdownDeps): Promise<void> {
  const { log } = deps;
  const startedAt = deps.now();
  const remaining = (until: number) => until - (deps.now() - startedAt);
  const deadline = setTimeout(() => {
    log('error', `Stop did not finish within ${SHUTDOWN_HARD_DEADLINE_MS} ms; exiting now`);
    deps.exit(1);
  }, SHUTDOWN_HARD_DEADLINE_MS);

  log('info', `${signal} received; stopping (limit ${SHUTDOWN_HARD_DEADLINE_MS} ms)`);
  deps.markStopping();

  // 1. Stop taking HTTP requests and new jobs
  const server = deps.getServer();
  if (!server) log('warn', 'HTTP server not captured; open requests end when the process exits');
  const queue = deps.getQueue();
  const runningAtStart = queue ? queue.activeJobs().length : 0;

  // 2. Running jobs and in-flight requests get the drain window
  const [httpOutcome, jobsOutcome] = await Promise.all([
    server ? within(() => closeServer(server), remaining(SHUTDOWN_DRAIN_MS)) : Promise.resolve<Outcome>('done'),
    queue
      ? within(async () => {
          try {
            await queue.pauseLocal();
          } catch (error) {
            // Bull's blocking client reconnecting, or Redis down: running jobs still get the window
            log('warn', `Job queue pause failed (${error instanceof Error ? error.message : String(error)}); still waiting for running jobs`);
          }
          await queue.whenCurrentJobsFinished();
        }, remaining(SHUTDOWN_DRAIN_MS))
      : Promise.resolve<Outcome>('done'),
  ]);
  if (server && httpOutcome !== 'done') {
    log('warn', 'Requests still open at the drain limit; closing their connections');
    server.closeAllConnections?.();
  }

  // 3. Close the queue only when nothing runs: a job finishing in the last moments
  //    can still record itself; the rest stay active in Redis and rerun after the restart
  let left: ActiveJobInfo[] = [];
  if (queue) {
    left = queue.activeJobs();
    if (left.length === 0) {
      if (jobsOutcome !== 'done') log('warn', `Job queue did not pause cleanly (${jobsOutcome})`);
      const closed = await within(() => queue.close(), SHUTDOWN_STEP_LIMIT_MS);
      if (closed !== 'done') log('warn', `Job queue close: ${closed}`);
    } else {
      for (const job of left) log('warn', `Job ${describe(job)} still running; left for retry on next start`);
    }

    // 4. Job rows written by the queue's completed/failed handlers
    const flushed = await within(() => queue.flushJobWrites(), SHUTDOWN_STEP_LIMIT_MS);
    if (flushed !== 'done') log('warn', `Job status writes: ${flushed}`);
  }

  // 5. Disconnect before PostgreSQL and Redis stop
  const prisma = deps.getPrisma();
  const disconnected = await within(async () => {
    queue?.disconnect();
    await prisma?.$disconnect();
  }, SHUTDOWN_STEP_LIMIT_MS);
  if (disconnected !== 'done') log('warn', `Disconnect: ${disconnected}`);

  clearTimeout(deadline);
  const finished = Math.max(0, runningAtStart - left.length);
  log('info', `Done in ${deps.now() - startedAt} ms (finished ${finished}, left ${left.length} for retry)`);
  deps.exit(0);
}

/** One handler for every signal; a second signal while stopping is logged and ignored. */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => void {
  let stopping = false;
  return (signal) => {
    if (stopping) {
      deps.log('warn', `${signal} received again; already stopping`);
      return;
    }
    stopping = true;
    runShutdown(signal, deps).catch((error) => {
      deps.log('error', `Stop failed: ${error instanceof Error ? error.message : String(error)}`);
      deps.exit(1);
    });
  };
}

/**
 * Keep the HTTP server from the first request's diagnostics message (Next keeps its
 * handle local). Unsubscribes after the first capture and keeps nothing else: the
 * message also carries the request, with its cookies and tokens.
 */
export function captureHttpServer(channel: Pick<typeof diagnosticsChannel, 'subscribe' | 'unsubscribe'> = diagnosticsChannel): () => ClosableServer | undefined {
  let server: ClosableServer | undefined;
  const onRequest = (message: unknown) => {
    const candidate = (message as { server?: unknown } | null)?.server as ClosableServer | undefined;
    if (server || !candidate || typeof candidate.close !== 'function') return;
    server = candidate;
    channel.unsubscribe(HTTP_REQUEST_CHANNEL, onRequest);
  };
  channel.subscribe(HTTP_REQUEST_CHANNEL, onRequest);
  return () => server;
}

function consoleLog(level: Level, message: string): void {
  const line = `[${level.toUpperCase()}] [Shutdown] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Install the SIGTERM/SIGINT handlers once per process (called from register()). */
export function registerShutdownHandlers(env: Record<string, string | undefined> = process.env): void {
  // Same test as Next's start-server (any non-empty value turns its handlers off)
  if (!env.NEXT_MANUAL_SIG_HANDLE) {
    consoleLog('info', 'NEXT_MANUAL_SIG_HANDLE is not set: Next.js handles SIGTERM and exits without waiting for running jobs');
    return;
  }
  oncePerProcess('shutdown-coordinator', () => {
    const handler = createShutdownHandler({
      getServer: captureHttpServer(),
      getQueue: () => peekProcessSingleton<{ shutdownTarget(): QueueShutdownTarget }>(JOB_QUEUE_SINGLETON_KEY)?.shutdownTarget(),
      getPrisma: () => peekProcessSingleton<{ $disconnect(): Promise<void> }>('prisma'),
      markStopping: markProcessStopping,
      exit: (code) => process.exit(code),
      log: consoleLog,
      now: () => Date.now(),
    });
    process.on('SIGTERM', () => handler('SIGTERM'));
    process.on('SIGINT', () => handler('SIGINT'));
    consoleLog('info', 'Handlers registered (SIGTERM, SIGINT)');
  });
}
