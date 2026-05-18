/**
 * Component: Admin Logs — ActiveFilterChips Tests
 * Documentation: documentation/admin-dashboard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActiveFilterChips from '@/app/admin/logs/components/ActiveFilterChips';
import { DEFAULT_FILTER_STATE, type LogsFilterState } from '@/app/admin/logs/types';

const setFiltersMock = vi.fn();
const removeFilterMock = vi.fn();
const clearAllMock = vi.fn();
let mockFilters: LogsFilterState = { ...DEFAULT_FILTER_STATE };

vi.mock('@/app/admin/logs/hooks/useLogsUrlState', () => ({
  useLogsUrlState: () => ({
    filters: mockFilters,
    setFilters: setFiltersMock,
    setSearchInput: vi.fn(),
    searchInput: mockFilters.search,
    clearAll: clearAllMock,
    removeFilter: removeFilterMock,
  }),
}));

const findUserByIdMock = vi.fn();
vi.mock('@/app/admin/logs/hooks/useUserSearch', () => ({
  useUserSearch: () => ({
    users: [],
    filterByQuery: vi.fn(),
    findUserById: findUserByIdMock,
    isLoading: false,
    error: null,
  }),
}));

describe('ActiveFilterChips', () => {
  beforeEach(() => {
    setFiltersMock.mockReset();
    removeFilterMock.mockReset();
    findUserByIdMock.mockReset();
    mockFilters = { ...DEFAULT_FILTER_STATE };
  });

  it('renders nothing when all filters are at default and no search', () => {
    const { container } = render(<ActiveFilterChips />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a status chip with the correct aria-label and label', () => {
    mockFilters = { ...DEFAULT_FILTER_STATE, status: 'failed' };
    render(<ActiveFilterChips />);
    const chip = screen.getByRole('button', { name: 'Remove filter: status' });
    expect(chip).toHaveTextContent('Status: Failed');
  });

  it('renders a job-type chip using JOB_TYPE_LABELS for the display label', () => {
    mockFilters = { ...DEFAULT_FILTER_STATE, type: 'search_indexers' };
    render(<ActiveFilterChips />);
    const chip = screen.getByRole('button', { name: 'Remove filter: job type' });
    expect(chip).toHaveTextContent('Type: Search Indexers');
  });

  it('renders an Errors only chip when hasError is true', () => {
    mockFilters = { ...DEFAULT_FILTER_STATE, hasError: true };
    render(<ActiveFilterChips />);
    const chip = screen.getByRole('button', { name: 'Remove filter: errors only' });
    expect(chip).toHaveTextContent('Errors only');
  });

  it('clicking a chip calls removeFilter with the correct key', () => {
    mockFilters = { ...DEFAULT_FILTER_STATE, status: 'failed' };
    render(<ActiveFilterChips />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: status' }));
    expect(removeFilterMock).toHaveBeenCalledWith('status');
  });

  it('clicking the date chip clears both dateFrom and dateTo via setFilters', () => {
    mockFilters = {
      ...DEFAULT_FILTER_STATE,
      dateFrom: '2026-05-10T00:00:00.000Z',
      dateTo: '2026-05-12T00:00:00.000Z',
    };
    render(<ActiveFilterChips />);
    const chip = screen.getByRole('button', { name: 'Remove filter: date range' });
    fireEvent.click(chip);
    expect(setFiltersMock).toHaveBeenCalledWith({ dateFrom: null, dateTo: null });
  });

  it('renders a search chip when search is non-empty', () => {
    mockFilters = { ...DEFAULT_FILTER_STATE, search: 'timeout' };
    render(<ActiveFilterChips />);
    const chip = screen.getByRole('button', { name: 'Remove filter: search' });
    expect(chip).toHaveTextContent('Search: "timeout"');
    fireEvent.click(chip);
    expect(removeFilterMock).toHaveBeenCalledWith('search');
  });

  it('user chip uses resolved plexUsername when available, falls back to id', () => {
    findUserByIdMock.mockReturnValue({ id: 'user-1', plexUsername: 'alice', role: 'user' });
    mockFilters = { ...DEFAULT_FILTER_STATE, userId: 'user-1' };
    const { unmount } = render(<ActiveFilterChips />);
    expect(
      screen.getByRole('button', { name: 'Remove filter: user' })
    ).toHaveTextContent('User: alice');
    unmount();

    findUserByIdMock.mockReturnValue(undefined);
    render(<ActiveFilterChips />);
    expect(
      screen.getByRole('button', { name: 'Remove filter: user' })
    ).toHaveTextContent('User: user-1');
  });

  it('audiobook chip shows the query string', () => {
    mockFilters = { ...DEFAULT_FILTER_STATE, audiobookQuery: 'Dune' };
    render(<ActiveFilterChips />);
    const chip = screen.getByRole('button', { name: 'Remove filter: audiobook' });
    expect(chip).toHaveTextContent('Book: "Dune"');
  });

  it('renders all chips together when multiple filters are active', () => {
    mockFilters = {
      ...DEFAULT_FILTER_STATE,
      status: 'failed',
      type: 'search_indexers',
      hasError: true,
      search: 'oops',
      audiobookQuery: 'Dune',
    };
    render(<ActiveFilterChips />);
    const group = screen.getByRole('group', { name: 'Active filters' });
    // Five chips for five active values.
    expect(group.querySelectorAll('button')).toHaveLength(5);
  });
});
