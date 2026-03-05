/**
 * Component: Request Card Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cancelRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/useRequests', () => ({
  useCancelRequest: () => ({ cancelRequest: cancelRequestMock, isLoading: false }),
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img {...props} />,
}));

vi.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ squareCovers: false, setSquareCovers: vi.fn(), cardSize: 5, setCardSize: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', role: 'user' },
    accessToken: 'test-token',
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshToken: vi.fn(),
    setAuthData: vi.fn(),
  }),
}));

const baseRequest = {
  id: 'req-1',
  status: 'pending',
  progress: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  audiobook: {
    id: 'book-1',
    title: 'Test Book',
    author: 'Test Author',
  },
};

describe('RequestCard', () => {
  beforeEach(() => {
    cancelRequestMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows progress and active indicator for downloads', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'downloading',
          progress: 45,
        }}
      />
    );

    expect(screen.getByText('Downloading')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
  });

  it('toggles the error message for failed requests', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'failed',
          errorMessage: 'Failure details',
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show error' }));
    expect(await screen.findByText('Failure details')).toBeInTheDocument();
  });

  it('triggers cancel action', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    cancelRequestMock.mockResolvedValueOnce(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<RequestCard request={baseRequest} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(cancelRequestMock).toHaveBeenCalledWith('req-1');
    });
  });

  it('does not show manual search or interactive search buttons', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(<RequestCard request={baseRequest} />);

    expect(screen.queryByRole('button', { name: 'Manual Search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Interactive Search' })).toBeNull();
  });

  it('shows setup indicator when progress is zero', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'processing',
          progress: 0,
        }}
      />
    );

    expect(screen.getByText('Setting up...')).toBeInTheDocument();
  });

  it('hides action buttons when showActions is false', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(<RequestCard request={baseRequest} showActions={false} />);

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('does not cancel when confirmation is declined', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<RequestCard request={baseRequest} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(cancelRequestMock).not.toHaveBeenCalled();
    });
  });

  it('shows completed timestamp when available', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          completedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
        }}
      />
    );

    expect(screen.getByText(/Completed/)).toBeInTheDocument();
  });
});
