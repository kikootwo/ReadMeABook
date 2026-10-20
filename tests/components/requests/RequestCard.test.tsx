/**
 * Component: Request Card Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cancelRequestMock = vi.hoisted(() => vi.fn());
const detailsModalSpy = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/useRequests', () => ({
  useCancelRequest: () => ({ cancelRequest: cancelRequestMock, isLoading: false }),
}));

vi.mock('@/components/audiobooks/AudiobookDetailsModal', () => ({
  AudiobookDetailsModal: (props: any) => {
    detailsModalSpy(props);
    return <div data-testid="audiobook-details-modal" data-open={String(props.isOpen)} />;
  },
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
    detailsModalSpy.mockReset();
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
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
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

  it('renders release date when status is awaiting_release and releaseDate is provided', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'awaiting_release',
          releaseDate: '2026-08-15T00:00:00Z',
        }}
      />
    );

    expect(screen.getByText('Releases Aug 15, 2026')).toBeInTheDocument();
  });

  it('does not render release text when status is awaiting_release but releaseDate is null', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'awaiting_release',
          releaseDate: null,
        }}
      />
    );

    expect(screen.queryByText(/^Releases /)).toBeNull();
  });

  it('does not render release text when releaseDate is provided but status is not awaiting_release', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          status: 'pending',
          releaseDate: '2026-08-15T00:00:00Z',
        }}
      />
    );

    expect(screen.queryByText(/^Releases /)).toBeNull();
  });

  it('opens AudiobookDetailsModal without hiding request actions when details are viewed', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          audiobook: { ...baseRequest.audiobook, audibleAsin: 'ASIN123' },
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: baseRequest.audiobook.title }));

    expect(detailsModalSpy).toHaveBeenCalled();
    const props = detailsModalSpy.mock.calls.at(-1)?.[0];
    expect(props.isOpen).toBe(true);
    expect(props.asin).toBe('ASIN123');
    expect(props.hideRequestActions).toBeUndefined();
  });

  it('forwards the request id and owner to AudiobookDetailsModal', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          user: { id: 'user-1', plexUsername: 'owner' },
          audiobook: { ...baseRequest.audiobook, audibleAsin: 'ASIN123' },
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: baseRequest.audiobook.title }));

    const props = detailsModalSpy.mock.calls.at(-1)?.[0];
    expect(props.requestId).toBe('req-1');
    expect(props.requestedByUserId).toBe('user-1');
  });

  it('forwards a null owner when the request has no user relation', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    render(
      <RequestCard
        request={{
          ...baseRequest,
          audiobook: { ...baseRequest.audiobook, audibleAsin: 'ASIN123' },
        }}
      />
    );

    const props = detailsModalSpy.mock.calls.at(-1)?.[0];
    expect(props.requestId).toBe('req-1');
    expect(props.requestedByUserId).toBeNull();
  });
});
