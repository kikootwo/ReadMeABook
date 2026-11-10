/**
 * Component: Recent Requests Table, the Explicit mark into the details modal (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * View Details on a marked request opens the details modal with the request's mark, so the box
 * starts checked there as it does from My Requests.
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useSWRMock = vi.hoisted(() => vi.fn());
const modalProps = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('swr', () => ({ default: useSWRMock, mutate: vi.fn() }));
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: vi.fn(), authenticatedFetcher: vi.fn() }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/lib/hooks/useExplicitMark', () => ({ useIsAudiobookshelf: () => true }));
vi.mock('@/app/admin/components/RequestActionsDropdown', () => ({
  RequestActionsDropdown: ({ request, onViewDetails }: { request: { requestId: string; asin?: string }; onViewDetails?: (asin: string) => void }) => (
    <button type="button" onClick={() => onViewDetails?.(request.asin ?? '')}>View {request.requestId}</button>
  ),
}));
vi.mock('@/components/audiobooks/AudiobookDetailsModal', () => ({
  AudiobookDetailsModal: (props: Record<string, unknown>) => {
    modalProps(props);
    return null;
  },
}));

const { RecentRequestsTable } = await import('@/app/admin/components/RecentRequestsTable');

const row = (requestId: string, explicit: boolean) => ({
  requestId, asin: `ASIN-${requestId}`, title: `Book ${requestId}`, author: 'Author', status: 'failed', type: 'audiobook',
  userId: 'user-1', user: 'Reader', createdAt: new Date('2024-01-01T00:00:00Z'), completedAt: null, errorMessage: null, explicit,
});

beforeEach(() => {
  vi.clearAllMocks();
  useSWRMock.mockImplementation((url: string) => {
    if (url?.includes('/api/admin/requests')) {
      return { data: { requests: [row('req-1', true), row('req-2', false)], total: 2, page: 1, pageSize: 25, totalPages: 1 }, error: null, isLoading: false };
    }
    if (url === '/api/admin/users') return { data: { users: [] }, error: null, isLoading: false };
    return { data: null, error: null, isLoading: false };
  });
});

describe('RecentRequestsTable View Details and the Explicit mark', () => {
  it.each([
    ['req-1', true],
    ['req-2', false],
  ])('%s opens the details modal with requestExplicit %s', (requestId, explicit) => {
    render(<RecentRequestsTable />);

    fireEvent.click(screen.getByRole('button', { name: `View ${requestId}` }));

    expect(modalProps).toHaveBeenLastCalledWith(expect.objectContaining({ requestId, requestExplicit: explicit }));
  });
});
