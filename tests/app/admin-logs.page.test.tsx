/**
 * Component: Admin Logs Page Tests
 * Documentation: documentation/admin-dashboard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLogsPage from '@/app/admin/logs/page';
import {
  buildLogsApiKey,
  DEFAULT_FILTER_STATE,
  LogsData,
  LogsFilterState,
} from '@/app/admin/logs/types';

// ===========================================================================
// Mocks
// ===========================================================================

const useSWRMock = vi.hoisted(() => vi.fn());
const routerReplaceMock = vi.hoisted(() => vi.fn());
const searchParamsState = vi.hoisted(() => ({ value: new URLSearchParams() }));

vi.mock('swr', () => ({
  default: (...args: any[]) => useSWRMock(...args),
}));

vi.mock('@/lib/utils/api', () => ({
  authenticatedFetcher: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn() }),
  usePathname: () => '/admin/logs',
  useSearchParams: () => searchParamsState.value,
}));

// useUserSearch fires its own SWR call for /api/admin/users; we branch the
// SWR mock by URL so both the logs key and the users key get sensible defaults.
const mockMutate = vi.fn();
function defaultSwrImpl(logsResponse: { data?: LogsData; error?: Error } = {}) {
  return (key: string) => {
    if (typeof key === 'string' && key.startsWith('/api/admin/users')) {
      return { data: { users: [] }, error: undefined, mutate: vi.fn(), isLoading: false };
    }
    return {
      data: logsResponse.data,
      error: logsResponse.error,
      mutate: mockMutate,
      isLoading: false,
    };
  };
}

// ===========================================================================
// Fixtures
// ===========================================================================

function makeLog(overrides: Partial<any> = {}): any {
  return {
    id: 'log-1',
    bullJobId: 'bull-1',
    type: 'search_indexers',
    status: 'failed',
    priority: 1,
    attempts: 2,
    maxAttempts: 3,
    errorMessage: 'Search failed',
    startedAt: '2024-01-01T00:00:00Z',
    completedAt: '2024-01-01T00:02:00Z',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:02:00Z',
    result: { retries: 2 },
    events: [
      {
        id: 'event-1',
        level: 'error',
        context: 'SearchJob',
        message: 'Indexer timeout',
        metadata: { indexer: 'Example' },
        createdAt: '2024-01-01T00:01:00Z',
      },
    ],
    request: {
      id: 'req-1',
      audiobook: { title: 'Search Book', author: 'Author' },
      user: { plexUsername: 'User' },
    },
    ...overrides,
  };
}

function makeData(logs: any[] = [makeLog()], pagination: Partial<any> = {}): LogsData {
  return {
    logs,
    pagination: {
      page: 1,
      limit: 50,
      total: logs.length,
      totalPages: Math.max(1, Math.ceil(logs.length / 50)),
      ...pagination,
    },
  };
}

// ===========================================================================
// Setup / teardown
// ===========================================================================

beforeEach(() => {
  vi.useRealTimers();
  useSWRMock.mockReset();
  routerReplaceMock.mockReset();
  mockMutate.mockReset();
  searchParamsState.value = new URLSearchParams();
});

afterEach(() => {
  vi.useRealTimers();
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
});

// ===========================================================================
// Page-level tests
// ===========================================================================

describe('AdminLogsPage', () => {
  it('renders the page header and a desktop row from data', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    expect(await screen.findByText('System Logs')).toBeInTheDocument();
    expect(screen.getAllByText('Search Book')[0]).toBeInTheDocument();
  });

  it('shows skeleton on initial load (no data, no error)', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: undefined, error: undefined }));
    render(<AdminLogsPage />);
    expect(await screen.findByTestId('log-skeleton-mobile')).toBeInTheDocument();
    expect(screen.getByTestId('log-skeleton-desktop')).toBeInTheDocument();
  });

  it('renders error state when logs fail to load', async () => {
    useSWRMock.mockImplementation(
      defaultSwrImpl({ data: undefined, error: new Error('Log failure') })
    );
    render(<AdminLogsPage />);

    expect(await screen.findByText('Error Loading Logs')).toBeInTheDocument();
    expect(screen.getByText('Log failure')).toBeInTheDocument();
  });

  it('uses buildLogsApiKey for the SWR key (with hydrate-time 7d default applied)', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData([]) }));
    render(<AdminLogsPage />);

    await waitFor(() => {
      const calls = useSWRMock.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/admin/logs')
      );
      expect(calls.length).toBeGreaterThan(0);
      const key = calls[0][0];
      const params = new URLSearchParams(key.split('?')[1] ?? '');
      // Defaults: page=1, limit=50 always present.
      expect(params.get('page')).toBe('1');
      expect(params.get('limit')).toBe('50');
      // Zach Resolution #1: hydrate-time Last-7-days default → dateFrom set,
      // dateTo unset (sliding window to "now").
      const dateFrom = params.get('dateFrom');
      expect(dateFrom).not.toBeNull();
      expect(params.get('dateTo')).toBeNull();
      // Confirm the dateFrom is roughly 7 days ago (allow generous tolerance).
      const fromMs = new Date(dateFrom as string).getTime();
      const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(fromMs - expected)).toBeLessThan(60_000);
    });
  });

  it('updates the SWR key when Errors-only pill is activated', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData([]) }));
    render(<AdminLogsPage />);

    const pill = await screen.findByRole('button', { name: /errors only/i });
    fireEvent.click(pill);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalled();
      const lastCall = routerReplaceMock.mock.calls[routerReplaceMock.mock.calls.length - 1];
      expect(lastCall[0]).toContain('hasError=1');
    });
  });

  it('renders fresh empty state when no rows, no filters, no search', async () => {
    // Note: hydrate-time 7d default IS applied here, but the page's
    // empty-state branch treats the implicit default as "not user-applied",
    // so the "fresh" copy still wins.
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData([]) }));
    render(<AdminLogsPage />);

    expect(
      await screen.findByText(/No background jobs have run yet/i)
    ).toBeInTheDocument();
  });

  it('skips hydrate-time 7d default when URL already has dateFrom', async () => {
    searchParamsState.value = new URLSearchParams('dateFrom=2024-01-01T00:00:00.000Z');
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData([]) }));
    render(<AdminLogsPage />);

    await waitFor(() => {
      const calls = useSWRMock.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/admin/logs')
      );
      const key = calls[calls.length - 1][0];
      const params = new URLSearchParams(key.split('?')[1] ?? '');
      // URL-provided dateFrom wins; hydrate default does NOT replace it.
      expect(params.get('dateFrom')).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  it('retires hydrate default after user retires dates via setFilters', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    // First confirm hydrate is active.
    await waitFor(() => {
      const calls = useSWRMock.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/admin/logs')
      );
      const key = calls[calls.length - 1][0];
      expect(new URLSearchParams(key.split('?')[1]).get('dateFrom')).not.toBeNull();
    });

    // Click Errors-only — this writes URL. The hydrate dates ride along in
    // the merge, so URL now carries an explicit dateFrom.
    const pill = await screen.findByRole('button', { name: /errors only/i });
    fireEvent.click(pill);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalled();
      const lastCall = routerReplaceMock.mock.calls[routerReplaceMock.mock.calls.length - 1];
      const params = new URLSearchParams((lastCall[0] as string).split('?')[1] ?? '');
      expect(params.get('hasError')).toBe('1');
      expect(params.get('dateFrom')).not.toBeNull();
    });
  });

  it('renders search-no-match empty state with Clear search button', async () => {
    searchParamsState.value = new URLSearchParams('search=foo');
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData([]) }));
    render(<AdminLogsPage />);

    expect(await screen.findByText(/No matches for/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /clear search and show all logs/i })
    ).toBeInTheDocument();
  });

  it('renders filters-too-tight empty state with Clear filters button', async () => {
    searchParamsState.value = new URLSearchParams('status=failed');
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData([]) }));
    render(<AdminLogsPage />);

    expect(
      await screen.findByText(/No logs match your current filters/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });

  it('hydrates filter state from URL on mount', async () => {
    searchParamsState.value = new URLSearchParams('status=failed&hasError=1&page=2');
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData([]) }));
    render(<AdminLogsPage />);

    await waitFor(() => {
      const calls = useSWRMock.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/admin/logs')
      );
      expect(calls.length).toBeGreaterThan(0);
      const key = calls[calls.length - 1][0];
      const params = new URLSearchParams(key.split('?')[1] ?? '');
      expect(params.get('status')).toBe('failed');
      expect(params.get('hasError')).toBe('1');
      expect(params.get('page')).toBe('2');
    });
  });

  it('silently drops invalid URL params', async () => {
    searchParamsState.value = new URLSearchParams(
      'status=garbage&type=not_a_type&limit=37&page=abc'
    );
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData([]) }));
    render(<AdminLogsPage />);

    await waitFor(() => {
      const calls = useSWRMock.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/admin/logs')
      );
      expect(calls.length).toBeGreaterThan(0);
      const key = calls[calls.length - 1][0];
      const params = new URLSearchParams(key.split('?')[1] ?? '');
      // Invalid values silently dropped → defaults applied
      expect(params.get('status')).toBeNull();
      expect(params.get('type')).toBeNull();
      // page + limit fall back to defaults (1 / 50) which the SWR key always sets
      expect(params.get('page')).toBe('1');
      expect(params.get('limit')).toBe('50');
    });
  });

  it('debounces search input — fast keystrokes produce ONE URL write', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    const search = await screen.findByLabelText(/search logs/i);
    fireEvent.change(search, { target: { value: 'a' } });
    fireEvent.change(search, { target: { value: 'ab' } });
    fireEvent.change(search, { target: { value: 'abc' } });

    // Wait past the 300ms debounce window — only ONE URL write should land,
    // with the final value.
    await waitFor(
      () => {
        const searchCalls = routerReplaceMock.mock.calls.filter((c: any[]) =>
          (c[0] as string).includes('search=')
        );
        expect(searchCalls.length).toBe(1);
        expect(searchCalls[0][0]).toContain('search=abc');
      },
      { timeout: 1500 }
    );
  });

  it('shows search clear (×) when populated and clears search on click', async () => {
    searchParamsState.value = new URLSearchParams('search=foo');
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData([]) }));
    render(<AdminLogsPage />);

    // The toolbar's × button has aria-label="Clear search" (exact match).
    const clearBtn = await screen.findByRole('button', { name: 'Clear search' });
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalled();
      const lastCall = routerReplaceMock.mock.calls[routerReplaceMock.mock.calls.length - 1];
      expect(lastCall[0]).not.toContain('search=');
    });
  });

  it('Refresh-now button triggers SWR mutate', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    const refresh = await screen.findByRole('button', { name: /refresh now/i });
    fireEvent.click(refresh);

    expect(mockMutate).toHaveBeenCalled();
  });

  it('Auto-refresh toggle persists state to sessionStorage', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    const toggle = await screen.findByRole('switch', { name: /auto-refresh/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(window.sessionStorage.getItem('admin-logs:auto-refresh-enabled')).toBe('0');
  });

  it('Auto-refresh OFF makes effectiveInterval=0 in the SWR call', async () => {
    window.sessionStorage.setItem('admin-logs:auto-refresh-enabled', '0');
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    await waitFor(() => {
      const logsCalls = useSWRMock.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/admin/logs')
      );
      const lastCfg = logsCalls[logsCalls.length - 1][2];
      expect(lastCfg.refreshInterval).toBe(0);
    });
  });

  it('expanding a row pauses auto-refresh (refreshInterval=0)', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    const discloseButtons = await screen.findAllByRole('button', { name: /show details/i });
    fireEvent.click(discloseButtons[0]);

    await waitFor(() => {
      const logsCalls = useSWRMock.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('/api/admin/logs')
      );
      const lastCfg = logsCalls[logsCalls.length - 1][2];
      expect(lastCfg.refreshInterval).toBe(0);
    });
  });

  it('Live indicator shows Paused when auto-refresh disabled', async () => {
    window.sessionStorage.setItem('admin-logs:auto-refresh-enabled', '0');
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    await waitFor(() => {
      const indicator = screen.getByTestId('logs-live-indicator');
      expect(indicator.getAttribute('data-state')).toBe('paused');
    });
  });

  it('pagination shows total result count and Page X of Y', async () => {
    useSWRMock.mockImplementation(
      defaultSwrImpl({ data: makeData([makeLog()], { total: 247, totalPages: 5 }) })
    );
    render(<AdminLogsPage />);

    const summary = await screen.findByTestId('logs-pagination-summary');
    expect(summary.textContent).toContain('247');
    expect(summary.textContent).toMatch(/Page\s*1\s*of\s*5/);
  });

  it('changing page-size triggers URL update with new limit and resets to page 1', async () => {
    searchParamsState.value = new URLSearchParams('page=3');
    useSWRMock.mockImplementation(
      defaultSwrImpl({ data: makeData([makeLog()], { page: 3, total: 200, totalPages: 4 }) })
    );
    render(<AdminLogsPage />);

    const sizeSelect = await screen.findByLabelText(/page size/i);
    fireEvent.change(sizeSelect, { target: { value: '100' } });

    await waitFor(() => {
      const lastCall = routerReplaceMock.mock.calls[routerReplaceMock.mock.calls.length - 1];
      expect(lastCall[0]).toContain('limit=100');
      expect(lastCall[0]).not.toContain('page=');
    });
  });

  it('changing a filter resets pagination to page 1', async () => {
    searchParamsState.value = new URLSearchParams('page=4');
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    const pill = await screen.findByRole('button', { name: /errors only/i });
    fireEvent.click(pill);

    await waitFor(() => {
      const lastCall = routerReplaceMock.mock.calls[routerReplaceMock.mock.calls.length - 1];
      const params = new URLSearchParams((lastCall[0] as string).split('?')[1] ?? '');
      expect(params.get('hasError')).toBe('1');
      expect(params.get('page')).toBeNull();
    });
  });

  it('disclosure button has rotating chevron and ARIA expanded state', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    const discloseButtons = await screen.findAllByRole('button', { name: /show details/i });
    const button = discloseButtons[0];
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const chevron = button.querySelector('svg');
    expect(chevron?.className.baseVal ?? chevron?.getAttribute('class') ?? '').not.toContain(
      'rotate-180'
    );

    fireEvent.click(button);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    const updatedChevron = button.querySelector('svg');
    const cls = updatedChevron?.className.baseVal ?? updatedChevron?.getAttribute('class') ?? '';
    expect(cls).toContain('rotate-180');
  });

  it('detail panel shows Event Log / Job Result / Error sections when expanded', async () => {
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    const discloseButtons = await screen.findAllByRole('button', { name: /show details/i });
    fireEvent.click(discloseButtons[0]);

    expect(screen.getAllByRole('button', { name: /event log/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /job result/i }).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('button', { name: /^error$/i }).length
    ).toBeGreaterThan(0);
  });

  it('copy button on Bull Job ID calls clipboard and shows toast', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData() }));
    render(<AdminLogsPage />);

    const discloseButtons = await screen.findAllByRole('button', { name: /show details/i });
    fireEvent.click(discloseButtons[0]);

    const copyButtons = screen.getAllByRole('button', { name: /copy bull job id/i });
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    expect(writeTextMock).toHaveBeenCalledWith('bull-1');
    await waitFor(() => {
      expect(screen.getByText(/Copied Bull Job ID/i)).toBeInTheDocument();
    });
  });

  it('hides disclosure button when log has no details', async () => {
    const log = makeLog({
      events: [],
      errorMessage: null,
      bullJobId: null,
      result: null,
    });
    useSWRMock.mockImplementation(defaultSwrImpl({ data: makeData([log]) }));
    render(<AdminLogsPage />);

    await screen.findAllByText('Search Book');
    expect(screen.queryByRole('button', { name: /show details/i })).toBeNull();
  });

  it('jump-to-page input on Enter dispatches a page change', async () => {
    useSWRMock.mockImplementation(
      defaultSwrImpl({ data: makeData([makeLog()], { total: 200, totalPages: 4 }) })
    );
    render(<AdminLogsPage />);

    const jump = await screen.findByLabelText(/jump to page/i);
    fireEvent.change(jump, { target: { value: '3' } });
    fireEvent.keyDown(jump, { key: 'Enter' });

    await waitFor(() => {
      const lastCall = routerReplaceMock.mock.calls[routerReplaceMock.mock.calls.length - 1];
      expect(lastCall[0]).toContain('page=3');
    });
  });
});

// ===========================================================================
// buildLogsApiKey unit tests
// ===========================================================================

describe('buildLogsApiKey', () => {
  it('omits defaults so the key stays short', () => {
    const key = buildLogsApiKey(DEFAULT_FILTER_STATE);
    const params = new URLSearchParams(key.split('?')[1] ?? '');
    expect(params.get('page')).toBe('1');
    expect(params.get('limit')).toBe('50');
    expect(params.get('status')).toBeNull();
    expect(params.get('type')).toBeNull();
    expect(params.get('search')).toBeNull();
    expect(params.get('hasError')).toBeNull();
  });

  it('includes every active filter', () => {
    const state: LogsFilterState = {
      ...DEFAULT_FILTER_STATE,
      search: 'foo',
      status: 'failed',
      type: 'search_indexers',
      dateFrom: '2024-01-01T00:00:00Z',
      dateTo: '2024-01-02T00:00:00Z',
      hasError: true,
      userId: 'user-123',
      audiobookQuery: 'Mistborn',
      page: 2,
      limit: 100,
    };
    const params = new URLSearchParams(buildLogsApiKey(state).split('?')[1] ?? '');
    expect(params.get('search')).toBe('foo');
    expect(params.get('status')).toBe('failed');
    expect(params.get('type')).toBe('search_indexers');
    expect(params.get('dateFrom')).toBe('2024-01-01T00:00:00Z');
    expect(params.get('dateTo')).toBe('2024-01-02T00:00:00Z');
    expect(params.get('hasError')).toBe('1');
    expect(params.get('userId')).toBe('user-123');
    expect(params.get('audiobookQuery')).toBe('Mistborn');
    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('100');
  });
});
