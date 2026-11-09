/**
 * Component: App Shutdown HTTP Drain Tests (real HTTP server and keep-alive client)
 * Documentation: documentation/deployment/unified.md
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { captureHttpServer, createShutdownHandler } from '@/lib/startup/shutdown-coordinator';

const BIG = 32 * 1024 * 1024; // larger than loopback socket buffers, so Node still holds most of it

interface Harness {
  port: number;
  agent: http.Agent;
  /** Run the stop through the coordinator; resolves with the exit code and how long it took */
  stop: () => Promise<{ code: number; ms: number }>;
  logs: string[];
  onRequest: (path: string) => Promise<void>;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function start(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<Harness> {
  const seen = new Map<string, () => void>();
  const waits = new Map<string, Promise<void>>();
  const onRequest = (path: string) => {
    if (!waits.has(path)) waits.set(path, new Promise<void>((resolve) => seen.set(path, resolve)));
    return waits.get(path)!;
  };
  const getServer = captureHttpServer(); // real diagnostics channel, as in production
  const server = http.createServer((req, res) => {
    onRequest(req.url ?? '');
    seen.get(req.url ?? '')?.();
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 4 });
  cleanups.push(() => {
    agent.destroy();
    server.closeAllConnections();
    server.close();
  });
  const logs: string[] = [];
  const stop = () =>
    new Promise<{ code: number; ms: number }>((resolve) => {
      const startedAt = performance.now();
      createShutdownHandler({
        getServer,
        getQueue: () => undefined,
        getPrisma: () => undefined,
        markStopping: () => undefined,
        exit: (code) => resolve({ code, ms: performance.now() - startedAt }),
        log: (level, message) => logs.push(`${level}: ${message}`),
        now: () => performance.now(),
      })('SIGTERM');
    });
  return { port: (server.address() as AddressInfo).port, agent, stop, logs, onRequest };
}

function get(h: Harness, path: string, onResponse?: (res: http.IncomingMessage) => void) {
  return new Promise<{ status: number; bytes: number; complete: boolean; endedAt: number }>((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: h.port, path, agent: h.agent }, (res) => {
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
        });
        res.on('close', () => resolve({ status: res.statusCode ?? 0, bytes, complete: res.complete, endedAt: performance.now() }));
        onResponse?.(res);
      })
      .on('error', reject);
  });
}

describe('shutdown HTTP drain (real server)', () => {
  it('a response still being written at the stop arrives in full, and the stop ends with it', async () => {
    const h = await start((_req, res) => {
      res.writeHead(200, { 'content-length': BIG });
      res.end(Buffer.alloc(BIG, 7)); // ended: the rest is written as the client reads
    });
    let stopping: Promise<{ code: number; ms: number }> | undefined;
    const response = get(h, '/big', (res) => {
      res.pause(); // a slow client: reads nothing for 300 ms
      stopping = h.stop();
      setTimeout(() => res.resume(), 300);
    });

    const got = await response;
    const stopped = await stopping!;
    expect(got).toMatchObject({ status: 200, bytes: BIG, complete: true });
    expect(stopped.code).toBe(0);
    expect(stopped.ms).toBeLessThan(2000);
    expect(h.logs.join('\n')).not.toContain('Requests still open');
  }, 10_000);

  it('a keep-alive connection with no request open does not hold the stop', async () => {
    const h = await start((req, res) => {
      if (req.url === '/slow') setTimeout(() => res.end('slow done'), 200);
      else res.end('fast done');
    });
    // A: request done before the stop, connection kept alive
    expect(await get(h, '/fast')).toMatchObject({ status: 200, complete: true });
    // B: in flight at the stop; once it answers, its connection is kept alive too
    const slow = get(h, '/slow');
    await h.onRequest('/slow');
    const stopped = await h.stop();
    const got = await slow;

    expect(got).toMatchObject({ status: 200, bytes: 'slow done'.length, complete: true });
    expect(stopped.code).toBe(0);
    expect(stopped.ms).toBeGreaterThanOrEqual(150);
    expect(stopped.ms).toBeLessThan(1000); // the drain window is 3500 ms, keep-alive 5000 ms
    expect(h.logs.join('\n')).not.toContain('Requests still open');
  }, 10_000);
});
