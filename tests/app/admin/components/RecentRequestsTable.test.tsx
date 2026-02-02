/**
 * Component: Recent Requests Table Tests
 * Documentation: documentation/admin-dashboard.md
 */

// @vitest-environment jsdom

import React from 'react';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());
const authenticatedFetcherMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());
const useSWRMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

// Mock next/navigation
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
};
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/admin',
  useSearchParams: () => mockSearchParams,
}));

vi.mock('swr', () => ({
  default: useSWRMock,
  mutate: mutateMock,
}));

vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  authenticatedFetcher: authenticatedFetcherMock,
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => toastMock,
}));

const mockRequestsData = {
  requests: [
    {
      requestId: 'req-1',
      title: 'Test Audiobook',
      author: 'Test Author',
      status: 'pending',
      userId: 'user-1',
      user: 'TestUser',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      completedAt: null,
      errorMessage: null,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

const mockUsersData = {
  users: [
    { id: 'user-1', plexUsername: 'TestUser' },
    { id: 'user-2', plexUsername: 'OtherUser' },
  ],
};

let RecentRequestsTable: typeof import('@/app/admin/components/RecentRequestsTable').RecentRequestsTable;

describe('RecentRequestsTable', () => {
  beforeEach(async () => {
    vi.resetModules();
    fetchWithAuthMock.mockReset();
    mutateMock.mockReset();
    mockRouter.push.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    toastMock.warning.mockReset();

    // Default SWR mock - returns requests and users data
    useSWRMock.mockImplementation((url: string) => {
      if (url.includes('/api/admin/requests')) {
        return { data: mockRequestsData, error: null, isLoading: false };
      }
      if (url === '/api/admin/users') {
        return { data: mockUsersData, error: null, isLoading: false };
      }
      return { data: null, error: null, isLoading: false };
    });

    vi.doMock(path.resolve('src/app/admin/components/RequestActionsDropdown.tsx'), () => ({
      RequestActionsDropdown: ({
        request,
        onDelete,
        onManualSearch,
        onCancel,
        onFetchEbook,
        isLoading,
      }: {
        request: { requestId: string; title: string };
        onDelete: (requestId: string, title: string) => void;
        onManualSearch: (requestId: string) => void;
        onCancel: (requestId: string) => void;
        onFetchEbook?: (requestId: string) => void;
        isLoading?: boolean;
      }) => (
        <div>
          <button type="button" onClick={() => onDelete(request.requestId, request.title)}>
            Delete Trigger
          </button>
          <button type="button" onClick={() => onManualSearch(request.requestId)}>
            Manual Search Trigger
          </button>
          <button type="button" onClick={() => onCancel(request.requestId)}>
            Cancel Trigger
          </button>
          <button
            type="button"
            onClick={() => onFetchEbook?.(request.requestId)}
            disabled={isLoading}
          >
            Fetch Ebook Trigger
          </button>
        </div>
      ),
    }));

    const module = await import('@/app/admin/components/RecentRequestsTable');
    RecentRequestsTable = module.RecentRequestsTable;
  });

  it('shows empty state when there are no requests', () => {
    useSWRMock.mockImplementation((url: string) => {
      if (url.includes('/api/admin/requests')) {
        return {
          data: { requests: [], total: 0, page: 1, pageSize: 25, totalPages: 0 },
          error: null,
          isLoading: false,
        };
      }
      if (url === '/api/admin/users') {
        return { data: mockUsersData, error: null, isLoading: false };
      }
      return { data: null, error: null, isLoading: false };
    });

    render(<RecentRequestsTable />);

    expect(screen.getByText('No Requests')).toBeInTheDocument();
  });

  it('shows loading state while fetching', () => {
    useSWRMock.mockImplementation(() => ({
      data: null,
      error: null,
      isLoading: true,
    }));

    const { container } = render(<RecentRequestsTable />);

    // Should show loading spinner (check for animate-spin class)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders requests table with data', () => {
    const { container } = render(<RecentRequestsTable />);

    expect(screen.getByText('Test Audiobook')).toBeInTheDocument();
    expect(screen.getByText('Test Author')).toBeInTheDocument();
    // TestUser appears in both dropdown and table, check for table cell content
    expect(screen.getByRole('cell', { name: 'TestUser' })).toBeInTheDocument();
    // Pending status badge (span with specific class)
    const statusBadge = container.querySelector('span.inline-flex');
    expect(statusBadge).toHaveTextContent('Pending');
  });

  it('renders filter controls', () => {
    render(<RecentRequestsTable />);

    expect(screen.getByPlaceholderText('Search by title or author...')).toBeInTheDocument();
    // Check for status and user dropdowns via their options
    expect(screen.getByRole('option', { name: 'All Statuses' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All Users' })).toBeInTheDocument();
  });

  it('deletes a request and refreshes caches', async () => {
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<RecentRequestsTable />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Trigger' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/admin/requests/req-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // Should mutate the current API URL and metrics
    expect(mutateMock).toHaveBeenCalledWith(expect.stringContaining('/api/admin/requests'));
    expect(mutateMock).toHaveBeenCalledWith('/api/admin/metrics');
    expect(toastMock.success).toHaveBeenCalledWith('Request deleted successfully');
  });

  it('warns when ebook fetch fails', async () => {
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, message: 'No ebook available' }),
    });

    render(<RecentRequestsTable ebookSidecarEnabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Fetch Ebook Trigger' }));

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/requests/req-1/fetch-ebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(toastMock.warning).toHaveBeenCalledWith('E-book fetch failed: No ebook available');
    });
  });

  it('triggers manual search', async () => {
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<RecentRequestsTable />);

    fireEvent.click(screen.getByRole('button', { name: 'Manual Search Trigger' }));

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/requests/req-1/manual-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(toastMock.success).toHaveBeenCalledWith('Manual search triggered');
    });
  });

  it('cancels a request', async () => {
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    render(<RecentRequestsTable />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Trigger' }));

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/requests/req-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      expect(toastMock.success).toHaveBeenCalledWith('Request cancelled');
    });
  });

  it('shows pagination info', () => {
    const { container } = render(<RecentRequestsTable />);

    // Check pagination text container exists with expected content
    const paginationText = container.querySelector('.text-gray-700');
    expect(paginationText).toHaveTextContent('Showing');
    expect(paginationText).toHaveTextContent('requests');
  });

  it('shows error state when fetch fails', () => {
    useSWRMock.mockImplementation(() => ({
      data: null,
      error: new Error('Network error'),
      isLoading: false,
    }));

    render(<RecentRequestsTable />);

    expect(screen.getByText('Failed to load requests. Please try again.')).toBeInTheDocument();
  });
});
