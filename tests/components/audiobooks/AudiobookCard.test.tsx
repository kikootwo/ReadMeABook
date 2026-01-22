/**
 * Component: Audiobook Card Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

    const requestButton = screen.getByRole('button', { name: 'Login to Request' });
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

    expect(screen.getByText(/Request created successfully/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText(/Request created successfully/)).toBeNull();
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

  it('shows processing state for downloaded requests', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    render(
      <AudiobookCard
        audiobook={{ ...baseAudiobook, isRequested: true, requestStatus: 'downloaded' }}
      />
    );

    const button = screen.getByRole('button', { name: 'Processing...' });
    expect(button).toBeDisabled();
  });

  it('shows pending approval status with requester name', async () => {
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

    expect(screen.getByRole('button', { name: /Pending Approval \(alice\)/ })).toBeDisabled();
  });

  it('shows a denied request state', async () => {
    const { AudiobookCard } = await import('@/components/audiobooks/AudiobookCard');

    render(
      <AudiobookCard
        audiobook={{ ...baseAudiobook, isRequested: true, requestStatus: 'denied' }}
      />
    );

    expect(screen.getByRole('button', { name: 'Request Denied' })).toBeDisabled();
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
});
