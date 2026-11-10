/**
 * Component: Library page data hook (failed live poll, Load more after a shorter reload, one reload
 * per action, a repeated status move)
 * Documentation: documentation/features/library-view.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryQuery } from '@/lib/hooks/useLibraryQuery';
import { item, response } from '../../components/library/fixtures';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: (url: string) => fetchMock(url) }));

import { LIVE_RETRY_MS, useLibrary } from '@/lib/hooks/useLibrary';

const Q: LibraryQuery = { q: '', status: [], source: [], requestedBy: [], sort: 'added', group: 'none' };
const BASE = '/api/library?limit=60';
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

type Live = { items: { id: string; status: string; progress: number; updatedAt: string }[]; refreshMs: number };
let pages: Record<string, unknown>;
let live: Live | (() => unknown);
const urls = () => fetchMock.mock.calls.map((c) => c[0] as string);
const listCalls = () => urls().filter((u) => u === BASE).length;
const liveCalls = () => urls().filter((u) => u.includes('live=1')).length;
const entry = (status: string, progress = 0) => ({ id: 'req_a', status, progress, updatedAt: '' });

function mount() {
  const cache = new Map();
  return renderHook(() => useLibrary(Q, false, true), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <SWRConfig value={{ provider: () => cache as never, dedupingInterval: 0 }}>{children}</SWRConfig>
    ),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  pages = {};
  live = { items: [], refreshMs: 0 };
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('live=1')) return live instanceof Function ? live() : ok(live);
    const page = pages[url];
    if (page instanceof Function) return page();
    return ok(page ?? response([]));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useLibrary: a failed live poll', () => {
  it('is retried quietly, polling resumes, and Live is off only while it fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const a = item({ id: 'req_a', status: 'downloading', statusGroup: 'on_the_way', progress: 10 });
    pages[BASE] = response([a]);
    const good: Live = { items: [entry('downloading', 20)], refreshMs: 1000 };
    live = good;
    const { result } = mount();
    await waitFor(() => expect(result.current.liveRefreshMs).toBe(1000));

    live = () => ok({ error: 'BadGateway', message: 'proxy' }, 502);
    await act(async () => vi.advanceTimersByTime(1100));
    await waitFor(() => expect(result.current.error).toBeNull()); // live errors are never shown
    const failedAt = liveCalls();
    let pillWhileFailing = result.current.liveRefreshMs;
    await waitFor(() => {
      pillWhileFailing = result.current.liveRefreshMs;
      expect(pillWhileFailing).toBe(0);
    }).catch(() => undefined); // asserted at the end, so the retry is checked on its own too

    live = { items: [entry('downloading', 64)], refreshMs: 1000 };
    await act(async () => vi.advanceTimersByTime(LIVE_RETRY_MS + 100));
    await waitFor(() => expect(liveCalls()).toBe(failedAt + 1)); // the quiet retry
    await waitFor(() => expect(result.current.items[0].progress).toBe(64));
    expect(result.current.liveRefreshMs).toBe(1000);
    await act(async () => vi.advanceTimersByTime(2100));
    await waitFor(() => expect(liveCalls()).toBeGreaterThanOrEqual(failedAt + 2)); // polling again
    expect(pillWhileFailing, 'Live is off while the poll fails').toBe(0);
  });
});

describe('useLibrary: Load more after a reload that ends a page earlier', () => {
  it('does not stick on Loading...', async () => {
    const a = item({ id: 'req_a', title: 'A' });
    const b = item({ id: 'req_b', title: 'B' });
    pages[BASE] = { ...response([a]), nextCursor: 'c1', matched: 2 };
    pages[`${BASE}&cursor=c1`] = { ...response([b]), matched: 2 };
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.isLoadingMore).toBe(false);

    pages[BASE] = { ...response([a]), nextCursor: null, matched: 1 }; // one book left the filter
    await act(async () => {
      await result.current.revalidate();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await waitFor(() => expect(result.current.isValidating).toBe(false));
    expect(result.current.hasMore).toBe(false);
    expect(result.current.isLoadingMore).toBe(false);

    // A later reload (a settle, an action) keeps "All N loaded": it is not a Load more
    let release!: () => void;
    pages[BASE] = () => new Promise((r) => (release = () => r(ok({ ...response([a]), nextCursor: null, matched: 1 }))));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.revalidate();
    });
    await waitFor(() => expect(result.current.isValidating).toBe(true));
    expect(result.current.isLoadingMore).toBe(false);
    await act(async () => {
      release();
      await pending;
    });
  });
});

describe('useLibrary: settles', () => {
  it('an action that moves its card to another group costs one list reload, not two', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const waiting = item({ id: 'req_a', status: 'awaiting_approval', statusGroup: 'needs_approval' });
    pages[BASE] = response([waiting]);
    live = { items: [], refreshMs: 0 };
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(liveCalls()).toBe(1));
    expect(listCalls()).toBe(1);

    // Approved: the list answers after live does (live sees the new group first)
    const pending = item({ id: 'req_a', status: 'pending', statusGroup: 'on_the_way' });
    pages[BASE] = () => new Promise((r) => setTimeout(() => r(ok(response([pending]))), 150));
    live = { items: [entry('pending')], refreshMs: 0 };
    await act(async () => {
      await result.current.revalidate();
    });
    await waitFor(() => expect(result.current.items[0].status).toBe('pending'));
    await new Promise((r) => setTimeout(r, 2300)); // past the settle window (1 s + jitter 0)
    expect(listCalls()).toBe(2);
  });

  it('the same status move later in the visit settles again', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const failed = item({ id: 'req_a', status: 'failed', statusGroup: 'problem' });
    const pending = item({ id: 'req_a', status: 'pending', statusGroup: 'on_the_way' });
    pages[BASE] = response([failed]);
    live = { items: [], refreshMs: 30 };
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // Retried elsewhere: pending in live, the list catches up after one settle
    pages[BASE] = response([pending]);
    live = { items: [entry('pending')], refreshMs: 30 };
    await waitFor(() => expect(listCalls()).toBe(2), { timeout: 2500 });
    await waitFor(() => expect(result.current.items[0].statusGroup).toBe('on_the_way'));

    // Failed again (leaves live: one settle), then retried again: pending once more
    pages[BASE] = response([failed]);
    live = { items: [], refreshMs: 30 };
    await waitFor(() => expect(listCalls()).toBe(3), { timeout: 2500 });
    await waitFor(() => expect(result.current.items[0].statusGroup).toBe('problem'));
    pages[BASE] = response([pending]);
    live = { items: [entry('pending')], refreshMs: 30 };
    await waitFor(() => expect(listCalls()).toBe(4), { timeout: 2500 });
    await waitFor(() => expect(result.current.items[0].statusGroup).toBe('on_the_way'));
  }, 15_000);
});
