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

const preferencesMock = vi.hoisted(() => ({ squareCovers: true }));
vi.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => preferencesMock,
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
    preferencesMock.squareCovers = true;
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

  /** One pending request with a cover, for the approval-card cover tests. */
  const seedCoverRequest = () => {
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
            audiobook: { title: 'Dune', author: 'Frank Herbert', coverArtUrl: 'https://example.test/dune.jpg' },
            user: { id: 'u2', plexUsername: 'reader1', avatarUrl: null },
          },
        ],
      },
    });
  };

  const seedPendingCard = (extra: Record<string, unknown>, providers?: Record<string, unknown>) => {
    seedCoverRequest();
    const [request] = swrState.get('/api/admin/requests/pending-approval')!.data.requests;
    swrState.set('/api/admin/requests/pending-approval', { data: { requests: [{ ...request, ...extra }] } });
    if (providers) swrState.set('/api/auth/providers', { data: providers });
  };

  it('approval card shows an Ebook pill on ebook requests', async () => {
    seedPendingCard({ type: 'ebook' });
    render(<AdminDashboard />);

    expect(await screen.findByTitle('Ebook')).toHaveTextContent('Ebook');
    expect(screen.queryByText('Explicit')).toBeNull();
  });

  it('approval card shows an Explicit pill on a marked request while the setting is on', async () => {
    seedPendingCard({ type: 'audiobook', explicit: true }, { backendMode: 'audiobookshelf', explicitMarkEnabled: true });
    render(<AdminDashboard />);

    expect(await screen.findByText('Explicit')).toBeInTheDocument();
  });

  it('approval card shows no Explicit pill while the setting is off', async () => {
    seedPendingCard({ type: 'audiobook', explicit: true }, { backendMode: 'audiobookshelf', explicitMarkEnabled: false });
    render(<AdminDashboard />);

    await screen.findByRole('img', { name: 'Dune' });
    expect(screen.queryByText('Explicit')).toBeNull();
  });

  it('approval card puts the requester and time on one line', async () => {
    seedPendingCard({ type: 'audiobook' });
    render(<AdminDashboard />);

    const name = await screen.findByText('reader1');
    expect(name.parentElement).toHaveTextContent(/reader1·.*ago/);
  });

  it('approval card puts the pills and the details button top right, after the title', async () => {
    const dune = { title: 'Dune', author: 'Frank Herbert', coverArtUrl: 'https://example.test/dune.jpg', audibleAsin: 'B002V1OF70' };
    seedPendingCard({ type: 'audiobook', explicit: true, audiobook: dune }, { backendMode: 'audiobookshelf', explicitMarkEnabled: true });
    render(<AdminDashboard />);

    const title = await screen.findByRole('heading', { name: 'Dune' });
    expect(title).toHaveAttribute('title', 'Dune');
    const row = title.parentElement!;
    expect(row.children[1]).toHaveTextContent('Explicit');
    expect(row.children[2]).toBe(screen.getByRole('button', { name: 'View book details' }));
  });

  it('approval card summarizes the authors and adds the year', async () => {
    const book = { title: 'Guards! Guards!', author: 'Terry Pratchett, Neil Gaiman, Ben Aaronovitch - introduction, Stephen Baxter', year: 2007, coverArtUrl: null };
    seedPendingCard({ type: 'audiobook', audiobook: book });
    render(<AdminDashboard />);

    const line = await screen.findByTestId('approval-authors');
    expect(line).toHaveTextContent('Terry Pratchett, Neil Gaiman and 1 more · 2007');
    expect(line).toHaveAttribute('title', 'Terry Pratchett, Neil Gaiman, Ben Aaronovitch (introduction), Stephen Baxter');
    // The authors truncate; the year never does
    expect(screen.getByText('Terry Pratchett, Neil Gaiman and 1 more').className).toContain('truncate');
    expect(screen.getByText('· 2007').className).toContain('flex-shrink-0');
  });

  it('approval card shows the year and narrators on ebook requests too', async () => {
    seedPendingCard({ type: 'ebook', audiobook: { title: 'Dune', author: 'Frank Herbert', narrator: 'Scott Brick', year: 2006, coverArtUrl: null } });
    render(<AdminDashboard />);

    expect(await screen.findByTestId('approval-authors')).toHaveTextContent('Frank Herbert · 2006');
    expect(screen.getByTestId('approval-narrators')).toHaveTextContent('Narrated by Scott Brick');
  });

  it('approval card text steps down like My Requests: title, authors, narrators, then requester', async () => {
    seedPendingCard({ type: 'audiobook', audiobook: { title: 'Dune', author: 'Frank Herbert', narrator: 'Scott Brick', year: 2006, coverArtUrl: null } });
    render(<AdminDashboard />);

    expect((await screen.findByRole('heading', { name: 'Dune' })).className).toContain('font-semibold text-gray-900 dark:text-gray-100');
    expect(screen.getByTestId('approval-authors').className).toContain('font-medium text-gray-700 dark:text-gray-200');
    expect(screen.getByTestId('approval-narrators').className).toContain('text-gray-600 dark:text-gray-300');
    expect(screen.getByTestId('approval-requester').className).toContain('text-xs text-gray-500 dark:text-gray-500');
  });

  it('approval card summarizes the narrators, everyone on hover', async () => {
    const narrator = 'Amanda Forstrom, Andy Clemence, Julie-Ann Elliott, Laura C. Harris';
    seedPendingCard({ type: 'audiobook', audiobook: { title: 'Golden Son', author: 'Pierce Brown', narrator, year: 2023, coverArtUrl: null } });
    render(<AdminDashboard />);

    const line = await screen.findByTestId('approval-narrators');
    expect(line).toHaveTextContent('Narrated by Amanda Forstrom, Andy Clemence and 2 more');
    expect(line).toHaveAttribute('title', `Narrated by ${narrator}`);
  });

  it('approval card shows no narrator line when the book has none', async () => {
    seedPendingCard({ type: 'audiobook' });
    render(<AdminDashboard />);

    await screen.findByTestId('approval-authors');
    expect(screen.queryByTestId('approval-narrators')).toBeNull();
  });

  it.each([
    [true, 'aspect-square', 'h-16'],
    [false, 'aspect-[2/3]', 'aspect-square'],
  ])('approval card cover follows the square-covers preference (%s)', async (square, expected, absent) => {
    preferencesMock.squareCovers = square;
    seedCoverRequest();

    render(<AdminDashboard />);
    const cover = await screen.findByRole('img', { name: 'Dune' });

    expect(cover.className).toContain(expected);
    expect(cover.className).not.toContain(absent);
  });
});
