/**
 * Component: Requests Hooks Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.hoisted(() => vi.fn());
const useSWRMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());
const fetchWithAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('swr', () => ({
  default: useSWRMock,
  mutate: mutateMock,
}));

vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

const renderHookValue = <T,>(hook: () => T) => {
  let value: T;
  function Probe() {
    value = hook();
    return null;
  }
  render(<Probe />);
  return value!;
};

const renderHook = <T,>(hook: () => T) => {
  const result = { current: undefined as T };
  function Probe() {
    result.current = hook();
    return null;
  }
  render(<Probe />);
  return result;
};

const makeResponse = (body: any, ok = true) => ({
  ok,
  json: async () => body,
});

describe('useRequests hooks', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useSWRMock.mockReset();
    mutateMock.mockReset();
    fetchWithAuthMock.mockReset();
    vi.resetModules();
  });

  it('builds request list endpoints when authenticated', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    useSWRMock.mockReturnValue({ data: { requests: [] }, error: null, isLoading: false });

    const { useRequests } = await import('@/lib/hooks/useRequests');

    renderHookValue(() => useRequests('pending', 25, true));

    expect(useSWRMock).toHaveBeenCalledWith(
      '/api/requests?status=pending&limit=25&myOnly=true',
      expect.any(Function),
      expect.objectContaining({ refreshInterval: 5000 })
    );
  });

  it('skips request list endpoints when unauthenticated', async () => {
    useAuthMock.mockReturnValue({ accessToken: null });
    useSWRMock.mockReturnValue({ data: null, error: null, isLoading: false });

    const { useRequests } = await import('@/lib/hooks/useRequests');

    renderHookValue(() => useRequests());

    expect(useSWRMock).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      expect.objectContaining({ refreshInterval: 5000 })
    );
  });

  it('builds request detail endpoints when authenticated', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    useSWRMock.mockReturnValue({ data: { request: { id: 'req-1' } }, error: null, isLoading: false });

    const { useRequest } = await import('@/lib/hooks/useRequests');

    renderHookValue(() => useRequest('req-1'));

    expect(useSWRMock).toHaveBeenCalledWith(
      '/api/requests/req-1',
      expect.any(Function),
      expect.objectContaining({ refreshInterval: 3000 })
    );
  });

  it('creates requests and triggers revalidation', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ request: { id: 'req-1' } }));

    const { useCreateRequest } = await import('@/lib/hooks/useRequests');
    const hook = renderHookValue(() => useCreateRequest());

    await act(async () => {
      // createRequest returns the full response so callers can detect a series-bundle
      // split ({ decomposed, ... }) vs a normal single request ({ request }).
      const result = await hook.createRequest({ asin: 'a1', title: 'Book', author: 'Author' } as any);
      expect(result.request.id).toBe('req-1');
    });

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/requests',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mutateMock).toHaveBeenCalled();
  });

  it('returns the decomposed result when a series bundle is split', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(
      makeResponse({ decomposed: true, count: 3, books: [{ asin: 'b1', title: 'One' }], message: '3-book series' })
    );

    const { useCreateRequest } = await import('@/lib/hooks/useRequests');
    const hook = renderHookValue(() => useCreateRequest());

    await act(async () => {
      const result = await hook.createRequest({ asin: 'a1', title: 'Trilogy', author: 'Author' } as any);
      expect(result.decomposed).toBe(true);
      expect(result.count).toBe(3);
    });
  });

  it('adds skipAutoSearch query params when creating requests', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ request: { id: 'req-10' } }));

    const { useCreateRequest } = await import('@/lib/hooks/useRequests');
    const result = renderHook(() => useCreateRequest());

    await act(async () => {
      await result.current.createRequest(
        { asin: 'a10', title: 'Book', author: 'Author' } as any,
        { skipAutoSearch: true }
      );
    });

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/requests?skipAutoSearch=true',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws when creating a request without authentication', async () => {
    useAuthMock.mockReturnValue({ accessToken: null });

    const { useCreateRequest } = await import('@/lib/hooks/useRequests');
    const result = renderHook(() => useCreateRequest());

    await expect(
      result.current.createRequest({ asin: 'a1', title: 'Book', author: 'Author' } as any)
    ).rejects.toThrow('Not authenticated');
  });

  it('surfaces specific create request errors', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ error: 'AlreadyAvailable' }, false));

    const { useCreateRequest } = await import('@/lib/hooks/useRequests');
    const hook = renderHookValue(() => useCreateRequest());

    await act(async () => {
      await expect(
        hook.createRequest({ asin: 'a1', title: 'Book', author: 'Author' } as any)
      ).rejects.toThrow('already in your Plex library');
    });
  });

  it('surfaces being processed errors when creating requests', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ error: 'BeingProcessed' }, false));

    const { useCreateRequest } = await import('@/lib/hooks/useRequests');
    const result = renderHook(() => useCreateRequest());

    await act(async () => {
      await expect(
        result.current.createRequest({ asin: 'a2', title: 'Book', author: 'Author' } as any)
      ).rejects.toThrow('being processed');
    });

    await waitFor(() => {
      expect(result.current.error).toContain('being processed');
    });
  });

  it('surfaces API error messages when creating requests', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ message: 'Backend refused' }, false));

    const { useCreateRequest } = await import('@/lib/hooks/useRequests');
    const result = renderHook(() => useCreateRequest());

    await act(async () => {
      await expect(
        result.current.createRequest({ asin: 'a3', title: 'Book', author: 'Author' } as any)
      ).rejects.toThrow('Backend refused');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Backend refused');
    });
  });

  it('cancels requests via the API', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ request: { id: 'req-2' } }));

    const { useCancelRequest } = await import('@/lib/hooks/useRequests');
    const hook = renderHookValue(() => useCancelRequest());

    await act(async () => {
      await hook.cancelRequest('req-2');
    });

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/requests/req-2',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('triggers manual search for requests', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ request: { id: 'req-3' } }));

    const { useManualSearch } = await import('@/lib/hooks/useRequests');
    const hook = renderHookValue(() => useManualSearch());

    await act(async () => {
      await hook.triggerManualSearch('req-3');
    });

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/requests/req-3/manual-search',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('captures API errors when triggering manual search', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ message: 'Manual search failed' }, false));

    const { useManualSearch } = await import('@/lib/hooks/useRequests');
    const result = renderHook(() => useManualSearch());

    await act(async () => {
      await expect(result.current.triggerManualSearch('req-3')).rejects.toThrow('Manual search failed');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Manual search failed');
    });
  });

  it('searches torrents interactively for a request', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ results: [{ guid: 't1' }] }));

    const { useInteractiveSearch } = await import('@/lib/hooks/useRequests');
    const hook = renderHookValue(() => useInteractiveSearch());

    await act(async () => {
      const results = await hook.searchTorrents('req-4', 'Custom');
      expect(results).toHaveLength(1);
    });

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/requests/req-4/interactive-search',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('reports interactive search errors', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ message: 'Search failed' }, false));

    const { useInteractiveSearch } = await import('@/lib/hooks/useRequests');
    const result = renderHook(() => useInteractiveSearch());

    await act(async () => {
      await expect(result.current.searchTorrents('req-4')).rejects.toThrow('Search failed');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Search failed');
    });
  });

  it('selects torrents for existing requests', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ request: { id: 'req-5' } }));

    const { useSelectTorrent } = await import('@/lib/hooks/useRequests');
    const hook = renderHookValue(() => useSelectTorrent());

    await act(async () => {
      await hook.selectTorrent('req-5', { title: 'Torrent' });
    });

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/requests/req-5/select-torrent',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('searches torrents for new requests', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ results: [{ guid: 't2' }] }));

    const { useSearchTorrents } = await import('@/lib/hooks/useRequests');
    const hook = renderHookValue(() => useSearchTorrents());

    await act(async () => {
      const results = await hook.searchTorrents('Title', 'Author', 'asin');
      expect(results).toHaveLength(1);
    });

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/audiobooks/search-torrents',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('requests torrents with audiobook payloads', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ request: { id: 'req-6' } }));

    const { useRequestWithTorrent } = await import('@/lib/hooks/useRequests');
    const hook = renderHookValue(() => useRequestWithTorrent());

    await act(async () => {
      await hook.requestWithTorrent({ asin: 'a1', title: 'Book', author: 'Author' } as any, { title: 'Torrent' });
    });

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/audiobooks/request-with-torrent',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('surfaces being processed errors when requesting with torrents', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ error: 'BeingProcessed' }, false));

    const { useRequestWithTorrent } = await import('@/lib/hooks/useRequests');
    const result = renderHook(() => useRequestWithTorrent());

    await act(async () => {
      await expect(
        result.current.requestWithTorrent(
          { asin: 'a4', title: 'Book', author: 'Author' } as any,
          { title: 'Torrent' }
        )
      ).rejects.toThrow('being processed');
    });

    await waitFor(() => {
      expect(result.current.error).toContain('being processed');
    });
  });

  it('surfaces already available errors when requesting with torrents', async () => {
    useAuthMock.mockReturnValue({ accessToken: 'token' });
    fetchWithAuthMock.mockResolvedValueOnce(makeResponse({ error: 'AlreadyAvailable' }, false));

    const { useRequestWithTorrent } = await import('@/lib/hooks/useRequests');
    const result = renderHook(() => useRequestWithTorrent());

    await act(async () => {
      await expect(
        result.current.requestWithTorrent(
          { asin: 'a5', title: 'Book', author: 'Author' } as any,
          { title: 'Torrent' }
        )
      ).rejects.toThrow('already in your Plex library');
    });

    await waitFor(() => {
      expect(result.current.error).toContain('already in your Plex library');
    });
  });
});
