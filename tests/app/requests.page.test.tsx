/**
 * Component: Requests Page Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockAuthState, setMockAuthState } from '../helpers/mock-auth';
import { resetMockRouter } from '../helpers/mock-next-navigation';

const useMyRequestsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/useRequests', () => ({
  useMyRequests: useMyRequestsMock,
}));

vi.mock('@/components/layout/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock('@/components/requests/RequestCard', () => ({
  RequestCard: ({ request, showActions }: { request: any; showActions?: boolean }) => (
    <div
      data-testid="request-card"
      data-status={request.status}
      data-show-actions={String(!!showActions)}
    >
      {request.id}
    </div>
  ),
}));

vi.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ squareCovers: false, setSquareCovers: vi.fn(), cardSize: 5, setCardSize: vi.fn() }),
}));

describe('RequestsPage', () => {
  beforeEach(() => {
    resetMockAuthState();
    resetMockRouter();
    useMyRequestsMock.mockReset();
    vi.resetModules();
  });

  const defaultCounts = { all: 0, active: 0, waiting: 0, completed: 0, failed: 0, cancelled: 0 };

  it('prompts for authentication when no user is available', async () => {
    setMockAuthState({ user: null });
    useMyRequestsMock.mockReturnValue({
      requests: [], counts: defaultCounts, hasMore: false,
      isLoading: false, isLoadingMore: false, isEmpty: true, loadMore: vi.fn(),
    });

    const { default: RequestsPage } = await import('@/app/requests/page');
    render(<RequestsPage />);

    expect(screen.getByText('Authentication Required')).toBeInTheDocument();
    expect(screen.getByText('Please log in to view your audiobook requests')).toBeInTheDocument();
  });

  it('filters requests by status and updates tab counts', async () => {
    setMockAuthState({
      user: { id: 'user-1', plexId: 'plex-1', username: 'user', role: 'user' },
      isLoading: false,
    });

    const allRequests = [
      { id: 'req-active', status: 'pending', audiobook: { title: 'Active', author: 'Author' } },
      { id: 'req-wait', status: 'awaiting_search', audiobook: { title: 'Wait', author: 'Author' } },
      { id: 'req-complete', status: 'downloaded', audiobook: { title: 'Done', author: 'Author' } },
      { id: 'req-failed', status: 'failed', audiobook: { title: 'Fail', author: 'Author' } },
    ];

    const counts = { all: 4, active: 1, waiting: 1, completed: 1, failed: 1, cancelled: 0 };

    // The hook is called with the current filter; mock returns different data per filter
    useMyRequestsMock.mockImplementation((filter: string) => {
      let requests = allRequests;
      if (filter === 'active') requests = allRequests.filter(r => r.status === 'pending');
      else if (filter === 'waiting') requests = allRequests.filter(r => r.status === 'awaiting_search');
      return {
        requests, counts, hasMore: false,
        isLoading: false, isLoadingMore: false, isEmpty: requests.length === 0, loadMore: vi.fn(),
      };
    });

    const { default: RequestsPage } = await import('@/app/requests/page');
    render(<RequestsPage />);

    // Counts now render as badge numbers inside tabs, not "(1)" format
    const activeTab = screen.getByRole('tab', { name: /Active/i });
    const waitingTab = screen.getByRole('tab', { name: /Waiting/i });

    expect(activeTab).toHaveTextContent('1');
    expect(waitingTab).toHaveTextContent('1');

    fireEvent.click(activeTab);

    const activeCards = screen.getAllByTestId('request-card');
    expect(activeCards).toHaveLength(1);
    expect(activeCards[0]).toHaveAttribute('data-status', 'pending');

    fireEvent.click(waitingTab);

    const waitingCards = screen.getAllByTestId('request-card');
    expect(waitingCards).toHaveLength(1);
    expect(waitingCards[0]).toHaveAttribute('data-status', 'awaiting_search');
  });
});
