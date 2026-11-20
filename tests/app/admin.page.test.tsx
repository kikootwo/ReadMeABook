/**
 * Component: Admin Dashboard Page Tests
 * Documentation: documentation/admin-dashboard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from '@/app/admin/page';

const authenticatedFetcherMock = vi.hoisted(() => vi.fn());
const fetchJSONMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());

// Mock next/navigation for RecentRequestsTable component
const mockRouter = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));
const mockSearchParams = vi.hoisted(() => new URLSearchParams());

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/admin',
  useSearchParams: () => mockSearchParams,
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const swrState = new Map<string, { data?: any; error?: any; mutate?: ReturnType<typeof vi.fn> }>();

vi.mock('swr', () => ({
  default: (key: string) => {
    return swrState.get(key) || { data: undefined, error: undefined, mutate: vi.fn() };
  },
  mutate: mutateMock,
}));

vi.mock('@/lib/utils/api', () => ({
  authenticatedFetcher: authenticatedFetcherMock,
  fetchJSON: fetchJSONMock,
  fetchWithAuth: vi.fn(),
}));

vi.mock('@/components/ui/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => toastMock,
}));

vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({
  InteractiveTorrentSearchModal: () => null,
}));

describe('AdminDashboard', () => {
  beforeEach(() => {
    swrState.clear();
    fetchJSONMock.mockReset();
    mutateMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    mockRouter.push.mockReset();
    mockRouter.replace.mockReset();
  });

  it('renders metrics, downloads, and recent requests', async () => {
    swrState.set('/api/admin/metrics', {
      data: {
        totalRequests: 12,
        activeDownloads: 2,
        completedLast30Days: 8,
        failedLast30Days: 1,
        totalUsers: 4,
        systemHealth: { status: 'healthy', issues: [] },
      },
    });
    swrState.set('/api/admin/downloads/active', {
      data: {
        downloads: [
          {
            requestId: 'r1',
            title: 'Active Book',
            author: 'Author One',
            progress: 55,
            speed: 1024,
            eta: 1200,
            user: 'Zach',
            startedAt: new Date('2024-01-01T00:00:00Z'),
          },
        ],
      },
    });
    // RecentRequestsTable fetches from /api/admin/requests with query params
    swrState.set('/api/admin/requests?page=1&pageSize=25&search=&status=all&type=all&userId=&sortBy=createdAt&sortOrder=desc', {
      data: {
        requests: [
          {
            requestId: 'req-1',
            title: 'Recent Book',
            author: 'Author Two',
            status: 'pending',
            userId: 'user-1',
            user: 'Sam',
            createdAt: new Date('2024-01-02T00:00:00Z'),
            completedAt: null,
            errorMessage: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      },
    });
    swrState.set('/api/admin/users', { data: { users: [] } });
    swrState.set('/api/admin/requests/pending-approval', { data: { requests: [] } });
    swrState.set('/api/admin/settings', { data: { ebook: { enabled: false } } });

    render(<AdminDashboard />);

    expect(await screen.findByText('Admin Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Total Requests')).toBeInTheDocument();
    expect(screen.getByText('Active Book')).toBeInTheDocument();
    expect(screen.getByText('Recent Book')).toBeInTheDocument();
  });

  it('approves a pending request and refreshes caches', async () => {
    swrState.set('/api/admin/metrics', {
      data: {
        totalRequests: 1,
        activeDownloads: 0,
        completedLast30Days: 0,
        failedLast30Days: 0,
        totalUsers: 1,
        systemHealth: { status: 'healthy', issues: [] },
      },
    });
    swrState.set('/api/admin/downloads/active', { data: { downloads: [] } });
    // RecentRequestsTable fetches from /api/admin/requests with query params
    swrState.set('/api/admin/requests?page=1&pageSize=25&search=&status=all&type=all&userId=&sortBy=createdAt&sortOrder=desc', {
      data: { requests: [], total: 0, page: 1, pageSize: 25, totalPages: 0 },
    });
    swrState.set('/api/admin/users', { data: { users: [] } });
    swrState.set('/api/admin/settings', { data: { ebook: { enabled: false } } });
    swrState.set('/api/admin/requests/pending-approval', {
      data: {
        requests: [
          {
            id: 'pending-1',
            createdAt: new Date().toISOString(),
            audiobook: { title: 'Awaiting', author: 'Author', coverArtUrl: null },
            user: { id: 'u1', plexUsername: 'User', avatarUrl: null },
          },
        ],
      },
    });

    fetchJSONMock.mockResolvedValue({ success: true });

    render(<AdminDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/requests/pending-1/approve', {
        method: 'POST',
        body: JSON.stringify({ action: 'approve' }),
      });
      expect(toastMock.success).toHaveBeenCalledWith('Approved "Awaiting" for User');
    });

    expect(mutateMock).toHaveBeenCalledWith('/api/admin/requests/pending-approval');
    expect(mutateMock).toHaveBeenCalledWith('/api/admin/requests/recent');
    expect(mutateMock).toHaveBeenCalledWith('/api/admin/metrics');
  });

  /** One pending request on an otherwise empty dashboard. */
  const seedPending = (extra: Record<string, unknown> = {}) => {
    swrState.set('/api/admin/metrics', {
      data: { totalRequests: 1, activeDownloads: 0, completedLast30Days: 0, failedLast30Days: 0, totalUsers: 1, systemHealth: { status: 'healthy', issues: [] } },
    });
    swrState.set('/api/admin/downloads/active', { data: { downloads: [] } });
    swrState.set('/api/admin/users', { data: { users: [] } });
    swrState.set('/api/admin/settings', { data: { ebook: { enabled: false } } });
    swrState.set('/api/admin/requests/pending-approval', {
      data: {
        requests: [
          {
            id: 'pending-2',
            createdAt: new Date().toISOString(),
            audiobook: { title: 'Dune', author: 'Frank Herbert', coverArtUrl: null },
            user: { id: 'u2', plexUsername: 'reader1', avatarUrl: null },
            ...extra,
          },
        ],
      },
    });
  };

  it('the deny toast names the book and the requester', async () => {
    seedPending();
    fetchJSONMock.mockResolvedValue({ success: true });

    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));

    await waitFor(() => {
      expect(fetchJSONMock).toHaveBeenCalledWith('/api/admin/requests/pending-2/approve', {
        method: 'POST',
        body: JSON.stringify({ action: 'deny' }),
      });
      expect(toastMock.success).toHaveBeenCalledWith('Denied "Dune" for reader1');
    });
  });

  it('approving an access request says the user was granted access', async () => {
    seedPending({ accessRequest: true });
    fetchJSONMock.mockResolvedValue({ success: true, accessGranted: true, message: 'Access granted: the book is already in the library' });

    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith('Granted reader1 access to "Dune"');
    });
  });

  it('an access request approved as a normal request (book left the library) gets the usual toast', async () => {
    seedPending({ accessRequest: true });
    fetchJSONMock.mockResolvedValue({ success: true, message: 'Request approved and search job triggered' });

    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith('Approved "Dune" for reader1');
    });
  });

  it('an unreleased book keeps the API message in the approve toast', async () => {
    seedPending();
    fetchJSONMock.mockResolvedValue({ awaitingRelease: true, message: 'Request approved; it will be searched on its release date (May 5, 2027)' });

    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalledWith('Request approved; it will be searched on its release date (May 5, 2027)');
    });
  });

  it('shows an error message when dashboard data fails to load', async () => {
    swrState.set('/api/admin/metrics', { error: new Error('Metrics unavailable') });

    render(<AdminDashboard />);

    expect(await screen.findByText('Error Loading Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Metrics unavailable')).toBeInTheDocument();
  });

  it('a failed poll after the data loaded keeps the dashboard and the requests table on screen (#212)', async () => {
    swrState.set('/api/admin/metrics', {
      data: { totalRequests: 1, activeDownloads: 0, completedLast30Days: 0, failedLast30Days: 0, totalUsers: 1, systemHealth: { status: 'healthy', issues: [] } },
    });
    // SWR keeps the last data when a later poll fails
    swrState.set('/api/admin/downloads/active', { data: { downloads: [] }, error: new Error('Download client unreachable') });
    swrState.set('/api/admin/requests?page=1&pageSize=25&search=&status=all&type=all&userId=&sortBy=createdAt&sortOrder=desc', {
      data: {
        requests: [{ requestId: 'req-1', title: 'Made Up Book', author: 'Made Up Author', status: 'downloading', userId: 'user-1', user: 'Sam', createdAt: new Date('2024-01-02T00:00:00Z'), completedAt: null, errorMessage: null }],
        total: 1, page: 1, pageSize: 25, totalPages: 1,
      },
    });
    swrState.set('/api/admin/users', { data: { users: [] } });
    swrState.set('/api/admin/settings', { data: { ebook: { enabled: false } } });

    render(<AdminDashboard />);

    expect(await screen.findByText('Made Up Book')).toBeInTheDocument();
    expect(screen.queryByText('Error Loading Dashboard')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Download client unreachable');
  });
});
