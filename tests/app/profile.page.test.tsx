/**
 * Component: Profile Page Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
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
      data-request-id={request.id}
      data-show-actions={String(!!showActions)}
    >
      {request.id}
    </div>
  ),
}));

const getStatValue = (label: string) => {
  const labelNode = screen.getByText(label);
  const container = labelNode.parentElement;
  const valueNode = container?.querySelector('p:nth-of-type(2)');
  return valueNode?.textContent;
};

describe('ProfilePage', () => {
  beforeEach(() => {
    resetMockAuthState();
    resetMockRouter();
    useRequestsMock.mockReset();
    vi.resetModules();
  });

  it('prompts for authentication when no user is available', async () => {
    setMockAuthState({ user: null });
    useRequestsMock.mockReturnValue({ requests: [], isLoading: false });

    const { default: ProfilePage } = await import('@/app/profile/page');
    render(<ProfilePage />);

    expect(screen.getByText('Authentication Required')).toBeInTheDocument();
    expect(screen.getByText('Please log in to view your profile')).toBeInTheDocument();
  });

  it('calculates stats and orders recent requests', async () => {
    setMockAuthState({
      user: {
        id: 'user-1',
        plexId: 'plex-1',
        username: 'user',
        role: 'user',
      },
      isLoading: false,
    });

    const requests = [
      { id: 'req-1', status: 'pending', createdAt: '2025-01-01T10:00:00Z', audiobook: {} },
      { id: 'req-2', status: 'awaiting_search', createdAt: '2025-01-02T10:00:00Z', audiobook: {} },
      { id: 'req-3', status: 'available', createdAt: '2025-01-03T10:00:00Z', audiobook: {} },
      { id: 'req-4', status: 'failed', createdAt: '2025-01-04T10:00:00Z', audiobook: {} },
      { id: 'req-5', status: 'cancelled', createdAt: '2025-01-05T10:00:00Z', audiobook: {} },
      { id: 'req-6', status: 'searching', createdAt: '2025-01-06T10:00:00Z', audiobook: {} },
    ];

    useRequestsMock.mockReturnValue({ requests, isLoading: false });

    const { default: ProfilePage } = await import('@/app/profile/page');
    render(<ProfilePage />);

    expect(getStatValue('Total')).toBe('6');
    expect(getStatValue('Active')).toBe('2');
    expect(getStatValue('Waiting')).toBe('1');
    expect(getStatValue('Completed')).toBe('1');
    expect(getStatValue('Failed')).toBe('1');
    expect(getStatValue('Cancelled')).toBe('1');

    const cards = screen.getAllByTestId('request-card');
    expect(cards).toHaveLength(5);
    expect(cards[0]).toHaveAttribute('data-request-id', 'req-6');
  });

  it('shows active downloads when downloading requests exist', async () => {
    setMockAuthState({
      user: {
        id: 'user-2',
        plexId: 'plex-2',
        username: 'download-user',
        role: 'user',
      },
      isLoading: false,
    });

    const requests = [
      { id: 'req-downloading', status: 'downloading', createdAt: '2025-02-01T10:00:00Z', audiobook: {} },
      { id: 'req-processing', status: 'processing', createdAt: '2025-02-02T10:00:00Z', audiobook: {} },
      { id: 'req-pending', status: 'pending', createdAt: '2025-02-03T10:00:00Z', audiobook: {} },
    ];

    useRequestsMock.mockReturnValue({ requests, isLoading: false });

    const { default: ProfilePage } = await import('@/app/profile/page');
    render(<ProfilePage />);

    expect(screen.getByText('Active Downloads')).toBeInTheDocument();
    const cards = screen.getAllByTestId('request-card');
    expect(cards.length).toBeGreaterThan(0);
  });
});
