/**
 * Component: Startup Init Trigger Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { describe, expect, it, vi } from 'vitest';
import {
  startupInitTargets,
  startupRetryDelay,
  triggerStartupInit,
} from '@/lib/startup/startup-trigger';
import { getOrCreateStartupSecret } from '@/lib/startup/startup-secret';

const respond = (status: number) => ({ status }) as Response;

/** Sleep stand-in that fails the test (instead of hanging) if the retry loop runs away. */
function makeSleep(maxCalls = 50) {
  let calls = 0;
  return vi.fn(async (_ms: number) => {
    calls++;
    if (calls > maxCalls) throw new Error(`retry loop exceeded ${maxCalls} rounds`);
  });
}

const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });

describe('startupInitTargets', () => {
  it('uses loopback on the configured port, then the origin Next recorded', () => {
    expect(startupInitTargets({ PORT: '3030', HOSTNAME: '0.0.0.0', __NEXT_PRIVATE_ORIGIN: 'http://localhost:3030' }))
      .toEqual(['http://127.0.0.1:3030', 'http://[::1]:3030', 'http://localhost:3030']);
  });

  it('adds a bound IP literal after loopback', () => {
    expect(startupInitTargets({ PORT: '3030', HOSTNAME: '192.168.1.20', __NEXT_PRIVATE_ORIGIN: 'http://192.168.1.20:3030' }))
      .toEqual(['http://127.0.0.1:3030', 'http://[::1]:3030', 'http://192.168.1.20:3030']);
  });

  it('accepts an IP-literal origin from `next start -H <ip>` without HOSTNAME', () => {
    expect(startupInitTargets({ PORT: '3030', __NEXT_PRIVATE_ORIGIN: 'http://10.0.0.7:3030' }))
      .toEqual(['http://127.0.0.1:3030', 'http://[::1]:3030', 'http://10.0.0.7:3030']);
  });

  it.each(['fd00::5', '[fd00::5]'])('accepts a bound IPv6 literal written as %s', (hostname) => {
    expect(startupInitTargets({ PORT: '3030', HOSTNAME: hostname, __NEXT_PRIVATE_ORIGIN: 'http://[fd00::5]:3030' }))
      .toEqual(['http://127.0.0.1:3030', 'http://[::1]:3030', 'http://[fd00::5]:3030']);
  });

  it('ignores a HOSTNAME or origin that is a machine name (it could resolve off-box)', () => {
    expect(startupInitTargets({ PORT: '3030', HOSTNAME: 'build-host.corp.example', __NEXT_PRIVATE_ORIGIN: 'http://build-host.corp.example:3030' }))
      .toEqual(['http://127.0.0.1:3030', 'http://[::1]:3030']);
  });

  it('defaults to port 3000', () => {
    expect(startupInitTargets({})[0]).toBe('http://127.0.0.1:3000');
  });
});

describe('startupRetryDelay', () => {
  it('backs off from 1s and caps at 60s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 50].map(startupRetryDelay))
      .toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });
});

describe('triggerStartupInit', () => {
  const env = { PORT: '3030', HOSTNAME: '0.0.0.0' };

  it('retries on 503 and stops after the first 200', async () => {
    const statuses = [503, 503, 500, 200];
    const fetchMock = vi.fn(async () => respond(statuses.shift() ?? 200));
    const sleep = makeSleep();
    const log = vi.fn();

    await triggerStartupInit({ fetch: fetchMock as any, sleep, log, env });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
    expect(log).toHaveBeenLastCalledWith('info', expect.stringContaining('initialized via http://127.0.0.1:3030'));
  });

  it('treats 404 as another process and moves on; never contacts a named host', async () => {
    const fetchMock = vi.fn(async (url: string) => respond(url.startsWith('http://127.0.0.1') ? 404 : 200));
    const sleep = makeSleep();

    await triggerStartupInit({
      fetch: fetchMock as any, sleep, log: vi.fn(),
      env: { PORT: '3030', HOSTNAME: 'myhost.example', __NEXT_PRIVATE_ORIGIN: 'http://myhost.example:3030' },
    });

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toEqual(['http://127.0.0.1:3030/api/init', 'http://[::1]:3030/api/init']);
    expect(urls.some((u) => u.includes('myhost'))).toBe(false);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops the round on an attempt timeout instead of starting init again on another target', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(respond(200));
    const sleep = makeSleep();

    await triggerStartupInit({ fetch: fetchMock as any, sleep, log: vi.fn(), env });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:3030/api/init',
      'http://127.0.0.1:3030/api/init',
    ]);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('falls through to the next loopback target when one is unreachable, logging the cause code', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('http://127.0.0.1')) throw refused();
      return respond(200);
    });
    const log = vi.fn();

    await triggerStartupInit({ fetch: fetchMock as any, sleep: makeSleep(), log, env });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:3030/api/init',
      'http://[::1]:3030/api/init',
    ]);
  });

  it('logs the cause code and a one-time bind-address hint when nothing answers', async () => {
    let rounds = 0;
    const sleep = vi.fn(async () => {
      rounds++;
      if (rounds > 10) throw new Error('retry loop ran away');
    });
    const fetchMock = vi.fn(async () => {
      if (rounds < 3) throw refused();
      return respond(200);
    });
    const log = vi.fn();

    await triggerStartupInit({ fetch: fetchMock as any, sleep, log, env });

    const text = log.mock.calls.map(([, message]) => message).join('\n');
    expect(text).toContain('ECONNREFUSED');
    expect(log.mock.calls.filter(([, message]) => String(message).includes('set HOSTNAME to that IP address'))).toHaveLength(1);
  });

  it('keeps going past the backoff cap with error-level logs, and never logs the secret', async () => {
    let rounds = 0;
    const sleep = vi.fn(async () => {
      rounds++;
      if (rounds > 40) throw new Error('retry loop ran away');
    });
    const fetchMock = vi.fn(async () => {
      if (rounds < 25) throw refused();
      return respond(200);
    });
    const log = vi.fn();

    await triggerStartupInit({ fetch: fetchMock as any, sleep, log, env });

    expect(sleep).toHaveBeenCalledTimes(25);
    expect(sleep.mock.calls.slice(-1)[0]).toEqual([60000]);
    const levels = log.mock.calls.map(([level]) => level);
    expect(levels).toContain('error');
    expect(log).toHaveBeenLastCalledWith('info', expect.stringContaining('initialized'));
    const secret = getOrCreateStartupSecret();
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it('POSTs the per-process secret and refuses to follow redirects', async () => {
    const fetchMock = vi.fn(async () => respond(200));
    await triggerStartupInit({ fetch: fetchMock as any, sleep: makeSleep(), log: vi.fn(), env });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>)['x-rmab-startup-token']).toBe(getOrCreateStartupSecret());
    expect(getOrCreateStartupSecret()).toMatch(/^[0-9a-f]{64}$/);
  });
});
