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

const useRequestsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/useRequests', () => ({
  useRequests: useRequestsMock,
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

describe('RequestsPage', () => {
  beforeEach(() => {
    resetMockAuthState();
    resetMockRouter();
    useRequestsMock.mockReset();
    vi.resetModules();
  });

  it('prompts for authentication when no user is available', async () => {
    setMockAuthState({ user: null });
    useRequestsMock.mockReturnValue({ requests: [], isLoading: false });

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

    const requests = [
      { id: 'req-active', status: 'pending', audiobook: { title: 'Active', author: 'Author' } },
      { id: 'req-wait', status: 'awaiting_search', audiobook: { title: 'Wait', author: 'Author' } },
      { id: 'req-complete', status: 'downloaded', audiobook: { title: 'Done', author: 'Author' } },
      { id: 'req-failed', status: 'failed', audiobook: { title: 'Fail', author: 'Author' } },
    ];

    useRequestsMock.mockReturnValue({ requests, isLoading: false });

    const { default: RequestsPage } = await import('@/app/requests/page');
    render(<RequestsPage />);

    const activeTab = screen.getByRole('button', { name: /Active/i });
    const waitingTab = screen.getByRole('button', { name: /Waiting/i });

    expect(activeTab).toHaveTextContent('(1)');
    expect(waitingTab).toHaveTextContent('(1)');

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
