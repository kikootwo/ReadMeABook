/**
 * Component: Setup Job Poller Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJobPoller, isPollCancelled, JOB_POLL_INTERVAL_MS } from '@/app/setup/lib/job-poller';

const statusResponse = (status: string) => ({ ok: true, json: async () => ({ job: { status } }) });

describe('createJobPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('polls every 2 s until the job completes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse('active'))
      .mockResolvedValueOnce(statusResponse('completed'));
    vi.stubGlobal('fetch', fetchMock);
    const poller = createJobPoller();

    const outcome = poller.pollJobStatus('run-1', 'token');
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS * 2);

    await expect(outcome).resolves.toBe('completed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/job-status/run-1', { headers: { Authorization: 'Bearer token' } });
  });

  it.each([
    ['the job fails', () => Promise.resolve(statusResponse('failed'))],
    ['the status request fails', () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })],
    ['fetch throws', () => Promise.reject(new Error('network'))],
  ])('reports failed when %s', async (_label, respond) => {
    vi.stubGlobal('fetch', vi.fn(respond));
    const outcome = createJobPoller().pollJobStatus('run-1', 'token');
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);

    await expect(outcome).resolves.toBe('failed');
  });

  it('gives up with failed after the timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => statusResponse('active')));
    const outcome = createJobPoller().pollJobStatus('run-1', 'token', { timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(6000);

    await expect(outcome).resolves.toBe('failed');
  });

  it('cancel stops polling, rejects the waiting caller and leaves no timer', async () => {
    const fetchMock = vi.fn(async () => statusResponse('active'));
    vi.stubGlobal('fetch', fetchMock);
    const poller = createJobPoller();
    const outcome = poller.pollJobStatus('run-1', 'token').catch((error) => error);
    const waited = poller.delay(60_000).catch((error) => error);
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS);
    const callsBefore = fetchMock.mock.calls.length;

    poller.cancel();
    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS * 10);

    expect(isPollCancelled(await outcome)).toBe(true);
    expect(isPollCancelled(await waited)).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(vi.getTimerCount()).toBe(0);
    await expect(poller.delay(10)).rejects.toSatisfy(isPollCancelled);
  });
});

describe('setup pages stop polling when they unmount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('FinalizeStep: no job-status requests and no timers after unmount mid-poll', async () => {
    localStorage.setItem('accessToken', 'token');
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/admin/jobs') return { ok: true, json: async () => ({ jobs: [{ id: 'job-1', type: 'audible_refresh' }, { id: 'job-2', type: 'plex_library_scan' }] }) };
      if (url.endsWith('/trigger')) return { ok: true, json: async () => ({ jobId: 'run-1' }) };
      return statusResponse('active');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { FinalizeStep } = await import('@/app/setup/steps/FinalizeStep');

    const { unmount } = render(<FinalizeStep hasAdminTokens onComplete={vi.fn()} onBack={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS * 2);
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/admin/job-status/'))).toBe(true);
    const callsBefore = fetchMock.mock.calls.length;

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL_MS * 30);
    });

    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Initializing page: no job-status requests and no 10-minute timer after unmount mid-poll', async () => {
    vi.doMock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
    const authData = encodeURIComponent(JSON.stringify({ accessToken: 'a', refreshToken: 'r', user: { id: 'u' } }));
    window.history.replaceState(null, '', `/setup/initializing#authData=${authData}`);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/admin/jobs') return { ok: true, json: async () => ({ jobs: [{ id: 'job-1', type: 'audible_refresh', lastRunJobId: 'run-1' }, { id: 'job-2', type: 'plex_library_scan', lastRunJobId: 'run-2' }] }) };
      return statusResponse('active');
    });
    vi.stubGlobal('fetch', fetchMock);
    const { default: InitializingPage } = await import('@/app/setup/initializing/page');

    const { unmount } = render(<InitializingPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000 + JOB_POLL_INTERVAL_MS * 2);
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/admin/job-status/'))).toBe(true);
    const callsBefore = fetchMock.mock.calls.length;

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    });

    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(vi.getTimerCount()).toBe(0);
  });
});
