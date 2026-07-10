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

vi.mock('@/components/requests/AnnasArchiveSearchModal', () => ({
  AnnasArchiveSearchModal: () => null,
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
      expect(toastMock.success).toHaveBeenCalledWith('Request approved');
    });

    expect(mutateMock).toHaveBeenCalledWith('/api/admin/requests/pending-approval');
    expect(mutateMock).toHaveBeenCalledWith('/api/admin/requests/recent');
    expect(mutateMock).toHaveBeenCalledWith('/api/admin/metrics');
  });

  it('shows an error message when dashboard data fails to load', async () => {
    swrState.set('/api/admin/metrics', { error: new Error('Metrics unavailable') });

    render(<AdminDashboard />);

    expect(await screen.findByText('Error Loading Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Metrics unavailable')).toBeInTheDocument();
  });
});
