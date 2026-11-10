/**
 * Component: Library page data hook (keys, pages, live overlay, settle, reload on return)
 * Documentation: documentation/features/library-view.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryQuery } from '@/lib/hooks/useLibraryQuery';
import type { LibraryItem } from '@/lib/library-view/types';
import { item, response } from '../../components/library/fixtures';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: (url: string) => fetchMock(url) }));

import { useLibrary } from '@/lib/hooks/useLibrary';

const Q: LibraryQuery = { q: '', status: [], source: [], requestedBy: [], sort: 'added', group: 'none' };
const BASE = '/api/library?limit=60';

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

interface Server {
  pages: Record<string, unknown>;
  live: { items: { id: string; status: string; progress: number; updatedAt: string }[]; refreshMs: number };
}

let server: Server;
const calls = (pred: (url: string) => boolean) => fetchMock.mock.calls.map((c) => c[0] as string).filter(pred);
const listCalls = (url = BASE) => calls((u) => u === url).length;
const liveCalls = () => calls((u) => u.includes('live=1')).length;

function serve() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('live=1')) return ok(server.live);
    const page = server.pages[url];
    if (page instanceof Function) return page();
    if (page === undefined) return ok(response([]));
    return ok(page);
  });
}

function sharedWrapper(cache: Map<string, unknown>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <SWRConfig value={{ provider: () => cache as never, dedupingInterval: 0 }}>{children}</SWRConfig>;
  };
}

function mount(opts: { query?: LibraryQuery; hide?: boolean; enabled?: boolean; cache?: Map<string, unknown> } = {}) {
  const cache = opts.cache ?? new Map();
  const hook = renderHook(
    ({ query, hide, enabled }: { query: LibraryQuery; hide: boolean; enabled: boolean }) => useLibrary(query, hide, enabled),
    {
      initialProps: { query: opts.query ?? Q, hide: opts.hide ?? false, enabled: opts.enabled ?? true },
      wrapper: sharedWrapper(cache),
    }
  );
  return { ...hook, cache };
}

const a = item({ id: 'req_a', title: 'A', status: 'downloading', statusGroup: 'on_the_way', progress: 10 });
const b = item({ id: 'req_b', title: 'B', status: 'pending', statusGroup: 'on_the_way' });
const lib = item({ id: 'req_lib', title: 'L', status: 'available', statusGroup: 'available', inLibrary: true });

beforeEach(() => {
  fetchMock.mockReset();
  server = { pages: { [BASE]: response([a, lib]) }, live: { items: [], refreshMs: 0 } };
  serve();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLibrary: keys and pages', () => {
  it('makes no call until enabled (preferences read, signed in) and never sends order', async () => {
    const { rerender } = mount({ enabled: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ query: Q, hide: false, enabled: true });
    await waitFor(() => expect(listCalls()).toBe(1));
    expect(calls((u) => u.includes('order='))).toHaveLength(0);
  });

  it('builds one fixed-order key with defaults left out', async () => {
    const query: LibraryQuery = { q: 'dune', status: ['problem'], source: ['rmab'], requestedBy: ['u1'], sort: 'title', group: 'author' };
    mount({ query, hide: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/library?q=dune&status=problem&source=rmab&requestedBy=u1&hideAvailable=true&sort=title&group=author&limit=60'
    );
  });

  it('Load more follows nextCursor without refetching page 1, and dedupes across pages', async () => {
    server.pages[BASE] = { ...response([a, b]), nextCursor: 'c1', matched: 3 };
    server.pages[`${BASE}&cursor=c1`] = { ...response([b, lib]), matched: 3 };
    const { result } = mount();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['req_a', 'req_b', 'req_lib']));
    expect(listCalls()).toBe(1);
    expect(listCalls(`${BASE}&cursor=c1`)).toBe(1);
    expect(result.current.hasMore).toBe(false);
  });

  it('a stale cursor starts over from page 1', async () => {
    server.pages[BASE] = { ...response([a]), nextCursor: 'old' };
    server.pages[`${BASE}&cursor=old`] = () => ok({ error: 'StaleCursor', message: 'stale' }, 400);
    const { result } = mount();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    server.pages[BASE] = response([a]);
    act(() => result.current.loadMore());
    await waitFor(() => expect(listCalls()).toBe(2));
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.items.map((i) => i.id)).toEqual(['req_a']);
  });

  it('does not retry a 4xx; retries a 5xx', async () => {
    server.pages[BASE] = () => ok({ error: 'Forbidden', message: 'no' }, 403);
    const { result } = mount();
    await waitFor(() => expect(result.current.error).not.toBeNull());
    await new Promise((r) => setTimeout(r, 1200));
    expect(listCalls()).toBe(1);

    fetchMock.mockClear();
    server.pages[BASE] = () => ok({ error: 'InternalError', message: 'boom' }, 500);
    const other = mount();
    await waitFor(() => expect(other.result.current.error).not.toBeNull());
    await waitFor(() => expect(listCalls()).toBe(2), { timeout: 2500 });
  });

  it('never refetches the list on focus or reconnect', async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(listCalls()).toBe(1);
  });
});

describe('useLibrary: reload on mount and on return (shared cache)', () => {
  it('a remount with cached pages refetches them once', async () => {
    const first = mount();
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    first.unmount();
    expect(listCalls()).toBe(1);

    server.pages[BASE] = response([b, a, lib]); // a book requested elsewhere meanwhile
    const again = mount({ cache: first.cache });
    expect(again.result.current.items.map((i) => i.id)).toEqual(['req_a', 'req_lib']); // cache shown at once
    await waitFor(() => expect(again.result.current.items.map((i) => i.id)).toEqual(['req_b', 'req_a', 'req_lib']));
    expect(listCalls()).toBe(2);
  });

  it('returning to a cached query (A, B, A) fetches A again', async () => {
    const dune = '/api/library?q=dune&limit=60';
    server.pages[dune] = response([a]);
    const { result, rerender } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    rerender({ query: { ...Q, q: 'dune' }, hide: false, enabled: true });
    await waitFor(() => expect(listCalls(dune)).toBe(1));
    server.pages[BASE] = response([b]);
    rerender({ query: Q, hide: false, enabled: true });
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['req_b']));
    expect(listCalls()).toBe(2);
    expect(listCalls(dune)).toBe(1);
  });

  it('after the reload on return, Load more still makes no page-1 call', async () => {
    server.pages[BASE] = { ...response([a]), nextCursor: 'c1' };
    server.pages[`${BASE}&cursor=c1`] = { ...response([b]), nextCursor: 'c2' };
    server.pages[`${BASE}&cursor=c2`] = response([lib]);
    const first = mount();
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    act(() => first.result.current.loadMore());
    await waitFor(() => expect(first.result.current.items).toHaveLength(2));
    first.unmount();

    const again = mount({ cache: first.cache });
    await waitFor(() => expect(listCalls()).toBe(2)); // page 1 and page 2 revalidated together
    await waitFor(() => expect(listCalls(`${BASE}&cursor=c1`)).toBe(2));
    act(() => again.result.current.loadMore());
    await waitFor(() => expect(again.result.current.items).toHaveLength(3));
    expect(listCalls()).toBe(2);
    expect(listCalls(`${BASE}&cursor=c1`)).toBe(2);
    expect(listCalls(`${BASE}&cursor=c2`)).toBe(1);
  });
});

describe('useLibrary: live overlay and settle', () => {
  const liveA = (status: string, progress = 50) => ({ id: 'req_a', status, progress, updatedAt: '2026-11-09T00:00:00Z' });

  it('patches a loaded card (also on page 2), never an in-library card; an unknown id is ignored', async () => {
    server.pages[BASE] = { ...response([b]), nextCursor: 'c1' };
    server.pages[`${BASE}&cursor=c1`] = response([a, lib]);
    server.live = {
      items: [liveA('downloading', 64), { id: 'req_lib', status: 'downloading', progress: 5, updatedAt: '' }, { id: 'req_zzz', status: 'searching', progress: 0, updatedAt: '' }],
      refreshMs: 0,
    };
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    await waitFor(() => expect(result.current.items.find((i) => i.id === 'req_a')?.progress).toBe(64));
    expect(result.current.items.find((i) => i.id === 'req_lib')).toMatchObject({ status: 'available', inLibrary: true });
    const pageOneCalls = listCalls();
    await new Promise((r) => setTimeout(r, 50));
    expect(listCalls()).toBe(pageOneCalls); // the unknown id caused no list fetch
  });

  it('polls at refreshMs and stops at 0', async () => {
    server.live = { items: [liveA('downloading')], refreshMs: 40 };
    const { result } = mount();
    await waitFor(() => expect(liveCalls()).toBeGreaterThanOrEqual(3), { timeout: 2000 });
    expect(result.current.liveRefreshMs).toBe(40);
    server.live = { items: [liveA('downloading')], refreshMs: 0 };
    await waitFor(() => expect(result.current.liveRefreshMs).toBe(0));
    const after = liveCalls();
    await new Promise((r) => setTimeout(r, 200));
    expect(liveCalls()).toBe(after);
  });

  it('a live id that leaves causes exactly one debounced list revalidation (coalesced)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    server.live = { items: [liveA('downloading'), { id: 'req_b', status: 'pending', progress: 0, updatedAt: '' }], refreshMs: 30 };
    const { result } = mount();
    await waitFor(() => expect(result.current.liveIds.size).toBe(2));
    server.live = { items: [{ id: 'req_b', status: 'pending', progress: 0, updatedAt: '' }], refreshMs: 30 };
    await waitFor(() => expect(result.current.liveIds.size).toBe(1));
    server.live = { items: [], refreshMs: 30 }; // a second settle inside the window
    await waitFor(() => expect(result.current.liveIds.size).toBe(0));
    const before = listCalls();
    expect(before).toBe(1);
    await waitFor(() => expect(listCalls()).toBe(2), { timeout: 2500 });
    await new Promise((r) => setTimeout(r, 1200));
    expect(listCalls()).toBe(2);
  });

  it('a live status that moves a card to another group schedules one settle', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const waiting = item({ id: 'req_a', status: 'awaiting_approval', statusGroup: 'needs_approval' });
    server.pages[BASE] = response([waiting]);
    server.live = { items: [liveA('pending', 0)], refreshMs: 30 };
    const { result } = mount();
    await waitFor(() => expect(result.current.items[0].statusGroup).toBe('on_the_way'));
    await waitFor(() => expect(listCalls()).toBe(2), { timeout: 2500 });
    await new Promise((r) => setTimeout(r, 1300));
    expect(listCalls()).toBe(2); // the list still says awaiting_approval: no loop
  });

  it('withLive patches a snapshot item that is not on a page', async () => {
    server.live = { items: [liveA('downloading', 77)], refreshMs: 0 };
    server.pages[BASE] = response([lib]);
    const { result } = mount();
    await waitFor(() => expect(result.current.liveIds.size).toBe(1));
    const snap: LibraryItem = { ...a, progress: 1 };
    expect(result.current.withLive(snap).progress).toBe(77);
  });
});
