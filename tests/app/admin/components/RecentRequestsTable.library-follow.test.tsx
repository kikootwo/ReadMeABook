/**
 * Component: Admin request row of a followed request (#325a)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * The row shows the library's edition (`displayTitle`/`displayAuthor`), while every action keeps
 * the requested title and author: both interactive search modals and Adjust Search Terms.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useSWRMock = vi.hoisted(() => vi.fn());
const searchModalProps = vi.hoisted(() => [] as Record<string, unknown>[]);
const adjustModalProps = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('swr', () => ({ default: useSWRMock, mutate: vi.fn() }));
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: vi.fn(), authenticatedFetcher: vi.fn() }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({
  InteractiveTorrentSearchModal: (props: Record<string, unknown>) => {
    searchModalProps.push(props);
    return null;
  },
}));
vi.mock('@/app/admin/components/AdjustSearchTermsModal', () => ({
  AdjustSearchTermsModal: (props: Record<string, unknown>) => {
    adjustModalProps.push(props);
    return null;
  },
}));

const ROW = {
  requestId: 'req-1',
  title: 'The Martian',
  author: 'Andy Weir',
  displayTitle: 'Artemis',
  displayAuthor: 'Library Author',
  asin: 'B082BHJMFF',
  libraryAsin: 'B072R1CY4P',
  status: 'available',
  type: 'audiobook',
  userId: 'user-1',
  user: 'reader',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  completedAt: new Date('2026-01-02T00:00:00Z'),
  errorMessage: null,
};

// Stable references: SWR data that changes identity on every render re-runs the table's effects
const page = (row: Record<string, unknown>) => ({ data: { requests: [row], total: 1, page: 1, pageSize: 25, totalPages: 1 }, error: null, isLoading: false });
const FOLLOWED = page(ROW);
const OLDER = page({ ...ROW, displayTitle: undefined, displayAuthor: undefined });
const USERS = { data: { users: [] }, error: null, isLoading: false };
const NONE = { data: null, error: null, isLoading: false };
const swrFor = (requests: unknown) => (url: string) =>
  url.includes('/api/admin/requests') ? requests : url === '/api/admin/users' ? USERS : NONE;

describe('RecentRequestsTable: a followed request (#325a)', () => {
  beforeEach(() => {
    searchModalProps.length = 0;
    adjustModalProps.length = 0;
    useSWRMock.mockImplementation(swrFor(FOLLOWED));
  });

  it('shows the library edition on the row and gives every search modal the requested one', async () => {
    const { RecentRequestsTable } = await import('@/app/admin/components/RecentRequestsTable');
    render(<RecentRequestsTable />);

    expect(screen.getByText('Artemis')).toBeInTheDocument();
    expect(screen.getByText('Library Author')).toBeInTheDocument();
    expect(screen.queryByText('The Martian')).not.toBeInTheDocument();

    const modes = searchModalProps.map((p) => p.searchMode ?? 'audiobook');
    expect(new Set(modes)).toEqual(new Set(['audiobook', 'ebook']));
    for (const props of searchModalProps) {
      expect(props.audiobook).toEqual({ title: 'The Martian', author: 'Andy Weir' });
    }
    expect(adjustModalProps.length).toBeGreaterThan(0);
    for (const props of adjustModalProps) {
      expect(props).toMatchObject({ title: 'The Martian', author: 'Andy Weir' });
    }
  });

  it('a row without display fields (older server) shows the title and author it has', async () => {
    useSWRMock.mockImplementation(swrFor(OLDER));
    const { RecentRequestsTable } = await import('@/app/admin/components/RecentRequestsTable');
    render(<RecentRequestsTable />);
    expect(screen.getByText('The Martian')).toBeInTheDocument();
    expect(screen.getByText('Andy Weir')).toBeInTheDocument();
  });
});
