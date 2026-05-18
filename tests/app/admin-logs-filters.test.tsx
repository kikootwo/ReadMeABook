/**
 * Component: Admin Logs — LogsFilters Tests
 * Documentation: documentation/admin-dashboard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LogsFilters from '@/app/admin/logs/components/LogsFilters';
import { DEFAULT_FILTER_STATE, type LogsFilterState } from '@/app/admin/logs/types';

// ---- Mock hooks (the seam between components and page-level state) -------

const setFiltersMock = vi.fn();
const clearAllMock = vi.fn();
const removeFilterMock = vi.fn();
const setSearchInputMock = vi.fn();
let mockFilters: LogsFilterState = { ...DEFAULT_FILTER_STATE };

vi.mock('@/app/admin/logs/hooks/useLogsUrlState', () => ({
  useLogsUrlState: () => ({
    filters: mockFilters,
    setFilters: setFiltersMock,
    setSearchInput: setSearchInputMock,
    searchInput: mockFilters.search,
    clearAll: clearAllMock,
    removeFilter: removeFilterMock,
  }),
}));

const registerMock = vi.fn();
const unregisterMock = vi.fn();
const useRegisterPauseReasonMock = vi.fn();

vi.mock('@/app/admin/logs/hooks/useAutoRefreshControl', () => ({
  useAutoRefreshControl: () => ({
    register: registerMock,
    unregister: unregisterMock,
    isPaused: false,
    isRunning: true,
    pauseReasons: [],
    enabled: true,
    setEnabled: vi.fn(),
    effectiveInterval: 10000,
    manualRefresh: vi.fn(),
    setMutate: vi.fn(),
    setLastUpdatedAt: vi.fn(),
    lastUpdatedAt: 0,
  }),
  useRegisterPauseReason: (reason: string, active: boolean) => {
    useRegisterPauseReasonMock(reason, active);
    React.useEffect(() => {
      if (active) registerMock(reason);
      else unregisterMock(reason);
      return () => unregisterMock(reason);
    }, [reason, active]);
  },
}));

const filterByQueryMock = vi.fn();
const findUserByIdMock = vi.fn();

vi.mock('@/app/admin/logs/hooks/useUserSearch', () => ({
  useUserSearch: () => ({
    users: [
      { id: 'user-1', plexUsername: 'alice', role: 'user' },
      { id: 'user-2', plexUsername: 'bob', role: 'admin' },
    ],
    filterByQuery: filterByQueryMock,
    findUserById: findUserByIdMock,
    isLoading: false,
    error: null,
  }),
}));

// ---- Tests ---------------------------------------------------------------

describe('LogsFilters', () => {
  beforeEach(() => {
    setFiltersMock.mockReset();
    clearAllMock.mockReset();
    removeFilterMock.mockReset();
    registerMock.mockReset();
    unregisterMock.mockReset();
    useRegisterPauseReasonMock.mockReset();
    filterByQueryMock.mockReset();
    findUserByIdMock.mockReset();
    mockFilters = { ...DEFAULT_FILTER_STATE };
    filterByQueryMock.mockReturnValue([
      { id: 'user-1', plexUsername: 'alice', role: 'user' },
      { id: 'user-2', plexUsername: 'bob', role: 'admin' },
    ]);
    findUserByIdMock.mockReturnValue(undefined);
  });

  it('renders the Status dropdown with all canonical options', () => {
    render(<LogsFilters />);
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['all', 'pending', 'active', 'completed', 'failed', 'delayed', 'stuck']);
  });

  it('renders the Job Type dropdown with All Types + JOB_TYPE_LABELS in insertion order', () => {
    render(<LogsFilters />);
    const select = screen.getByLabelText('Job Type') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    // First option is 'all', followed by every JOB_TYPE_LABELS key.
    expect(values[0]).toBe('all');
    expect(values.slice(1, 5)).toEqual([
      'search_indexers',
      'download_torrent',
      'monitor_download',
      'organize_files',
    ]);
  });

  it('calls setFilters({ status }) when the Status dropdown changes', () => {
    render(<LogsFilters />);
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'failed' } });
    expect(setFiltersMock).toHaveBeenCalledWith({ status: 'failed' });
  });

  it('clicking a preset date option calls setFilters with computed dateFrom and dateTo null', () => {
    render(<LogsFilters />);
    const dateSelect = screen.getByLabelText('Date Range') as HTMLSelectElement;
    fireEvent.change(dateSelect, { target: { value: 'last_7d' } });
    expect(setFiltersMock).toHaveBeenCalledTimes(1);
    const [call] = setFiltersMock.mock.calls;
    const payload = call[0] as Partial<LogsFilterState>;
    expect(payload.dateTo).toBeNull();
    expect(payload.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const fromMs = new Date(payload.dateFrom as string).getTime();
    // 7 days ago, ±60s tolerance (test execution time).
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(fromMs - expected)).toBeLessThan(60_000);
  });

  it('selecting Custom reveals datetime-local inputs', () => {
    render(<LogsFilters />);
    const dateSelect = screen.getByLabelText('Date Range') as HTMLSelectElement;
    fireEvent.change(dateSelect, { target: { value: 'custom' } });
    expect(screen.getByLabelText('Date from')).toBeInTheDocument();
    expect(screen.getByLabelText('Date to')).toBeInTheDocument();
  });

  it('typing in the Audiobook input calls setFilters with audiobookQuery', () => {
    render(<LogsFilters />);
    const input = screen.getByLabelText('Audiobook') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Dune' } });
    expect(setFiltersMock).toHaveBeenCalledWith({ audiobookQuery: 'Dune' });
  });

  it('user typeahead selection calls setFilters with the user id', () => {
    render(<LogsFilters />);
    const input = screen.getByLabelText('User') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'al' } });
    // The popover renders the filtered options; click "alice" via mouseDown
    // (the component uses onMouseDown to avoid the blur race).
    const option = screen.getByRole('option', { name: /alice/ });
    fireEvent.mouseDown(option);
    expect(setFiltersMock).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('user typeahead clear button calls setFilters with userId null', () => {
    findUserByIdMock.mockReturnValue({ id: 'user-1', plexUsername: 'alice', role: 'user' });
    mockFilters = { ...DEFAULT_FILTER_STATE, userId: 'user-1' };
    render(<LogsFilters />);
    const clear = screen.getByRole('button', { name: 'Clear user filter' });
    fireEvent.click(clear);
    expect(setFiltersMock).toHaveBeenCalledWith({ userId: null });
  });

  it('hides "Clear all filters" when no filters or search are active', () => {
    render(<LogsFilters />);
    expect(screen.queryByText('Clear all filters')).not.toBeInTheDocument();
  });

  it('shows "Clear all filters" when at least one filter is active and clears on click', () => {
    mockFilters = { ...DEFAULT_FILTER_STATE, status: 'failed' };
    render(<LogsFilters />);
    const button = screen.getByText('Clear all filters');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(clearAllMock).toHaveBeenCalledTimes(1);
  });

  it('registers a pause reason when the Status select is focused and unregisters on blur', () => {
    render(<LogsFilters />);
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    fireEvent.focus(select);
    expect(registerMock).toHaveBeenCalledWith('logs-status-dropdown');
    fireEvent.blur(select);
    expect(unregisterMock).toHaveBeenCalledWith('logs-status-dropdown');
  });

  it('custom datetime-local input emits UTC ISO via setFilters', () => {
    render(<LogsFilters />);
    fireEvent.change(screen.getByLabelText('Date Range'), { target: { value: 'custom' } });
    const fromInput = screen.getByLabelText('Date from') as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: '2026-01-15T10:30' } });
    expect(setFiltersMock).toHaveBeenCalled();
    const lastCall = setFiltersMock.mock.calls.at(-1)?.[0] as Partial<LogsFilterState>;
    expect(lastCall.dateFrom).toMatch(/Z$/);
    // The submitted ISO must parse to the same wall-clock time the user typed,
    // interpreted as local. Round-trip check:
    const parsed = new Date(lastCall.dateFrom as string);
    const localRoundTrip = new Date(2026, 0, 15, 10, 30);
    expect(parsed.getTime()).toBe(localRoundTrip.getTime());
  });
});
