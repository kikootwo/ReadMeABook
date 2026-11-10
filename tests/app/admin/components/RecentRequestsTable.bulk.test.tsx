/**
 * Component: Recent Requests Table Tests - bulk action mount points (#212)
 * Documentation: documentation/admin-features/bulk-request-actions.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useSWRMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());
const fetchWithAuthMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('swr', () => ({ default: useSWRMock, mutate: mutateMock }));
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchWithAuthMock, authenticatedFetcher: vi.fn() }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => toastMock }));
vi.mock('@/app/admin/components/RequestActionsDropdown', () => ({
  RequestActionsDropdown: ({ isLoading }: { isLoading?: boolean }) => <span data-testid="row-menu" data-loading={String(!!isLoading)} />,
}));

import { RecentRequestsTable } from '@/app/admin/components/RecentRequestsTable';

const row = (requestId: string, status: string, extra: Record<string, unknown> = {}) => ({
  requestId, title: `Made Up ${requestId}`, author: 'Made Up Author', status, userId: 'u-1', user: 'reader',
  createdAt: new Date('2026-01-01T00:00:00Z'), completedAt: null, errorMessage: null, ...extra,
});
const DATA = {
  requests: [row('r1', 'awaiting_approval'), row('r2', 'failed'), row('r3', 'available', { inLibrary: true })],
  total: 3, page: 1, pageSize: 25, totalPages: 1,
};

/** The options of the newest useSWR call for the requests list. */
const lastListOptions = () => [...useSWRMock.mock.calls].reverse().find(([url]) => String(url).startsWith('/api/admin/requests?'))?.[2];

describe('RecentRequestsTable bulk selection', () => {
  beforeEach(() => {
    useSWRMock.mockReset();
    fetchWithAuthMock.mockReset();
    useSWRMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/admin/requests')) return { data: DATA, error: null, isLoading: false };
      if (url === '/api/admin/users') return { data: { users: [] }, error: null, isLoading: false };
      return { data: null, error: null, isLoading: false };
    });
  });

  it('mounts a checkbox per row and a header checkbox for the page', () => {
    render(<RecentRequestsTable />);
    expect(screen.getByRole('checkbox', { name: 'Select all requests on this page' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select Made Up r1' })).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });

  it('auto-refresh pauses while anything is selected and resumes when cleared', () => {
    render(<RecentRequestsTable />);
    expect(lastListOptions().refreshInterval).toBe(10000);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Made Up r2' }));
    expect(lastListOptions().refreshInterval).toBe(0);
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(lastListOptions().refreshInterval).toBe(10000);
  });

  it('the header selects the visible page; the bar counts the mixed selection', () => {
    render(<RecentRequestsTable />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all requests on this page' }));
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel 1' })).toBeTruthy();
  });

  it('a selected row keeps its tint under hover, light and dark', () => {
    render(<RecentRequestsTable />);
    const rowOf = (name: string) => screen.getByRole('checkbox', { name }).closest('tr') as HTMLElement;
    expect(rowOf('Select Made Up r2').className).toContain('hover:bg-gray-50');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Made Up r2' }));
    const cls = rowOf('Select Made Up r2').className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(['bg-blue-50/70', 'dark:bg-blue-900/20']));
    expect(cls.filter((c) => c.startsWith('hover:') || c.startsWith('dark:hover:')).every((c) => c.includes('blue'))).toBe(true);
    expect(cls.some((c) => c.startsWith('dark:hover:'))).toBe(true);
  });

  it('a failed list fetch during a run keeps the bar with its progress and Stop', async () => {
    fetchWithAuthMock.mockImplementation(() => new Promise(() => {}));
    const { rerender } = render(<RecentRequestsTable />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Made Up r2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete 1' }));
    expect(await screen.findByText('Deleting 0 of 1...')).toBeTruthy();
    useSWRMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/admin/requests')) return { data: DATA, error: new Error('Failed to load'), isLoading: false };
      if (url === '/api/admin/users') return { data: { users: [] }, error: null, isLoading: false };
      return { data: null, error: null, isLoading: false };
    });
    rerender(<RecentRequestsTable />);
    expect(screen.getByText('Failed to load requests. Please try again.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Bulk actions' })).getByText('Deleting 0 of 1...')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  it('changing a filter clears the selection', () => {
    render(<RecentRequestsTable />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Made Up r1' }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by type' }), { target: { value: 'ebook' } });
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Select Made Up r1' }) as HTMLInputElement).checked).toBe(false);
  });
});
