/**
 * Component: Admin request row phase line (#216)
 * Documentation: documentation/frontend/components.md
 *
 * A processing row says what it is doing under its badge: "Merging chapters · N%"
 * while the merge runs, else "Organizing files". Other statuses show no line.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const useSWRMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('swr', () => ({ default: useSWRMock, mutate: vi.fn() }));
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: vi.fn(), authenticatedFetcher: vi.fn() }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({ InteractiveTorrentSearchModal: () => null }));
vi.mock('@/app/admin/components/AdjustSearchTermsModal', () => ({ AdjustSearchTermsModal: () => null }));

const row = (requestId: string, title: string, status: string, progress: number) => ({
  requestId,
  title,
  author: 'Author',
  asin: null,
  status,
  progress,
  type: 'audiobook',
  userId: 'user-1',
  user: 'reader',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  completedAt: null,
  errorMessage: null,
});

// Stable references: SWR data that changes identity on every render re-runs the table's effects
const REQUESTS = {
  data: {
    requests: [
      row('r1', 'Merging Book', 'processing', 42),
      row('r2', 'Organizing Book', 'processing', 100),
      row('r3', 'Downloading Book', 'downloading', 42),
      row('r4', 'Downloaded Book', 'downloaded', 100),
    ],
    total: 4,
    page: 1,
    pageSize: 25,
    totalPages: 1,
  },
  error: null,
  isLoading: false,
};
const USERS = { data: { users: [] }, error: null, isLoading: false };
const NONE = { data: null, error: null, isLoading: false };

describe('RecentRequestsTable: processing phase line (#216)', () => {
  let RecentRequestsTable: typeof import('@/app/admin/components/RecentRequestsTable').RecentRequestsTable;

  // The table's module graph is large: load it outside the test's own timeout (slow under load)
  beforeAll(async () => {
    ({ RecentRequestsTable } = await import('@/app/admin/components/RecentRequestsTable'));
  }, 120_000);

  it('shows the merge percent or "Organizing files" under a processing badge, nothing elsewhere', () => {
    useSWRMock.mockImplementation((url: string) =>
      url.includes('/api/admin/requests') ? REQUESTS : url === '/api/admin/users' ? USERS : NONE
    );
    render(<RecentRequestsTable />);

    const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;
    expect(rowOf('Merging Book')).toHaveTextContent('Merging chapters · 42%');
    expect(rowOf('Organizing Book')).toHaveTextContent('Organizing files');
    expect(rowOf('Organizing Book')).not.toHaveTextContent('%');
    for (const title of ['Downloading Book', 'Downloaded Book']) {
      expect(rowOf(title)).not.toHaveTextContent(/Merging chapters|Organizing files/);
    }
  });
});
