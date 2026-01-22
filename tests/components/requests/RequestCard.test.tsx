/**
 * Component: Request Card Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cancelRequestMock = vi.hoisted(() => vi.fn());
const manualSearchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/useRequests', () => ({
  useCancelRequest: () => ({ cancelRequest: cancelRequestMock, isLoading: false }),
  useManualSearch: () => ({ triggerManualSearch: manualSearchMock, isLoading: false }),
}));

vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({
  InteractiveTorrentSearchModal: ({
    isOpen,
    requestId,
  }: {
    isOpen: boolean;
    requestId?: string;
  }) => (
    <div data-testid="interactive-modal" data-open={String(isOpen)} data-request-id={requestId} />
  ),
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img {...props} />,
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
    manualSearchMock.mockReset();
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

  it('triggers manual search, interactive search, and cancel actions', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    manualSearchMock.mockResolvedValueOnce(undefined);
    cancelRequestMock.mockResolvedValueOnce(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<RequestCard request={baseRequest} />);

    fireEvent.click(screen.getByRole('button', { name: 'Manual Search' }));
    await waitFor(() => {
      expect(manualSearchMock).toHaveBeenCalledWith('req-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Interactive Search' }));
    expect(screen.getByTestId('interactive-modal')).toHaveAttribute('data-open', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(cancelRequestMock).toHaveBeenCalledWith('req-1');
    });
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

    expect(screen.queryByRole('button', { name: 'Manual Search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('alerts when manual search fails', async () => {
    const { RequestCard } = await import('@/components/requests/RequestCard');

    manualSearchMock.mockRejectedValueOnce(new Error('Search failed'));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<RequestCard request={baseRequest} />);

    fireEvent.click(screen.getByRole('button', { name: 'Manual Search' }));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Search failed');
    });
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
