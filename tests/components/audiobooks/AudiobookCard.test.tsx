/**
 * Component: Audiobook Card Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textNodesEqualTo } from '../../helpers/stray-text';

const createRequestMock = vi.hoisted(() => vi.fn());
const authState = {
  user: null as null | { id: string; username: string },
};

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/hooks/useRequests', () => ({
  useCreateRequest: () => ({ createRequest: createRequestMock, isLoading: false }),
}));

vi.mock('@/components/audiobooks/AudiobookDetailsModal', () => ({
  AudiobookDetailsModal: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="details-modal" data-open={String(isOpen)} />
  ),
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img {...props} />,
}));

const baseAudiobook = {
  asin: 'asin-1',
  title: 'Test Book',
  author: 'Author',
};

describe('AudiobookCard', () => {
  beforeEach(() => {
    authState.user = null;
    createRequestMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disables requests when no user is logged in', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    render(<AudiobookCard audiobook={baseAudiobook} />);

    const requestButton = screen.getByRole('button', { name: 'Sign in to Request' });
    expect(requestButton).toBeDisabled();
    expect(createRequestMock).not.toHaveBeenCalled();
  });

  it('creates a request and shows a success toast', async () => {
    authState.user = { id: 'user-1', username: 'user' };
    createRequestMock.mockResolvedValueOnce(undefined);

    const onRequestSuccess = vi.fn();
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    render(<AudiobookCard audiobook={baseAudiobook} onRequestSuccess={onRequestSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: 'Request' }));

    const requestPromise = createRequestMock.mock.results[0]?.value;
    await act(async () => {
      await requestPromise;
    });

    expect(createRequestMock).toHaveBeenCalledWith(baseAudiobook);
    expect(onRequestSuccess).toHaveBeenCalled();

    expect(screen.getByText(/Request created!/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText(/Request created!/)).toBeNull();
  });

  it('shows in-library state when available', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    render(<AudiobookCard audiobook={{ ...baseAudiobook, isAvailable: true }} />);

    expect(screen.getByText('In Your Library')).toBeInTheDocument();
  });

  it('opens the details modal when the title is clicked', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    render(<AudiobookCard audiobook={baseAudiobook} />);

    expect(screen.getByTestId('details-modal')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByText('Test Book'));

    expect(screen.getByTestId('details-modal')).toHaveAttribute('data-open', 'true');
  });

  it('shows processing state with a spinner for downloading requests', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    const { container } = render(
      <AudiobookCard
        audiobook={{ ...baseAudiobook, isRequested: true, requestStatus: 'downloading' }}
      />
    );

    // Processing status is shown as a div overlay, not a button
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('labels a downloaded request "Downloaded" like My Requests, not Processing (#298)', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    const { container } = render(
      <AudiobookCard
        audiobook={{ ...baseAudiobook, isRequested: true, isAvailable: false, requestStatus: 'downloaded' }}
      />
    );

    expect(screen.getByText('Downloaded')).toBeInTheDocument();
    expect(screen.queryByText('Processing')).toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request' })).toBeNull();
  });

  it('shows pending status for awaiting_approval requests', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    render(
      <AudiobookCard
        audiobook={{
          ...baseAudiobook,
          isRequested: true,
          requestStatus: 'awaiting_approval',
          requestedByUsername: 'alice',
        }}
      />
    );

    // Card shows "Requested" for all pending statuses
    expect(screen.getByText('Requested')).toBeInTheDocument();
  });

  it('allows re-requesting for denied status', async () => {
    authState.user = { id: 'user-1', username: 'user' };
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    render(
      <AudiobookCard
        audiobook={{ ...baseAudiobook, isRequested: true, requestStatus: 'denied' }}
      />
    );

    // Denied status allows re-requesting, so Request button is shown
    expect(screen.getByRole('button', { name: 'Request' })).toBeInTheDocument();
  });

  it('shows an error when a request fails', async () => {
    authState.user = { id: 'user-1', username: 'user' };
    createRequestMock.mockRejectedValueOnce(new Error('Request failed'));

    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    render(<AudiobookCard audiobook={baseAudiobook} />);

    fireEvent.click(screen.getByRole('button', { name: 'Request' }));

    const requestPromise = createRequestMock.mock.results[0]?.value;
    await act(async () => {
      try {
        await requestPromise;
      } catch {
        // Expected for this test.
      }
    });

    expect(screen.getByText('Request failed')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('Request failed')).toBeNull();
  });

  it('renders no rating badge and no stray "0" when the rating is 0', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    const { container } = render(<AudiobookCard audiobook={{ ...baseAudiobook, rating: 0 }} />);

    expect(container.querySelector('svg.text-amber-400')).toBeNull();
    expect(textNodesEqualTo(container, '0')).toHaveLength(0);
    expect(screen.queryByText('0.0')).toBeNull();
  });

  it('renders the rating badge for a positive rating', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    const { container } = render(<AudiobookCard audiobook={{ ...baseAudiobook, rating: 4.5 }} />);

    expect(container.querySelector('svg.text-amber-400')).not.toBeNull();
    expect(screen.getByText('4.5')).toBeInTheDocument();
  });
});
