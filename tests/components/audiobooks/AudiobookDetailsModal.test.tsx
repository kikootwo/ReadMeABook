/**
 * Component: Audiobook Details Modal Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.hoisted(() => vi.fn());
const useAudiobookDetailsMock = vi.hoisted(() => vi.fn());
const createRequestMock = vi.hoisted(() => vi.fn());
const fetchEbookMock = vi.hoisted(() => vi.fn());
const revalidateEbookStatusMock = vi.hoisted(() => vi.fn());
const fetchWithAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ squareCovers: false, setSquareCovers: vi.fn(), cardSize: 5, setCardSize: vi.fn() }),
}));

vi.mock('@/lib/hooks/useAudiobooks', () => ({
  useAudiobookDetails: (asin: string | null) => useAudiobookDetailsMock(asin),
}));

vi.mock('@/lib/hooks/useRequests', () => ({
  useCreateRequest: () => ({ createRequest: createRequestMock, isLoading: false }),
  useEbookStatus: () => ({
    ebookStatus: { ebookSourcesEnabled: false, hasActiveEbookRequest: false },
    revalidate: revalidateEbookStatusMock,
  }),
  useDownloadStatus: () => ({ downloadAvailable: false, requestId: null }),
  useFetchEbookByAsin: () => ({ fetchEbook: fetchEbookMock, isLoading: false }),
}));

vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({
  InteractiveTorrentSearchModal: ({ isOpen, requestId }: { isOpen: boolean; requestId?: string }) => (
    <div
      data-testid="interactive-modal"
      data-open={String(isOpen)}
      data-request-id={requestId ?? ''}
    />
  ),
}));

vi.mock('@/lib/utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/api')>()),
  fetchWithAuth: fetchWithAuthMock,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img {...props} />,
}));

const audiobookDetails = {
  asin: 'ASIN123',
  title: 'Detail Book',
  author: 'Detail Author',
  description: 'Summary',
  rating: 4.2,
  durationMinutes: 320,
  releaseDate: '2023-01-01',
  genres: ['Fantasy'],
};

describe('AudiobookDetailsModal', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { id: 'user-1', username: 'user' } });
    useAudiobookDetailsMock.mockReturnValue({
      audiobook: audiobookDetails,
      isLoading: false,
      error: null,
    });
    createRequestMock.mockReset();
    fetchWithAuthMock.mockReset();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders audiobook details and closes when requested', async () => {
    const onClose = vi.fn();
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={onClose}
      />
    );

    await act(async () => {});
    expect(screen.getByText('Detail Book')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    // Both mobile and desktop close buttons exist, click the first one
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('creates requests and auto-closes when no request id is returned', async () => {
    vi.useFakeTimers();
    createRequestMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const onRequestSuccess = vi.fn();
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={onClose}
        onRequestSuccess={onRequestSuccess}
      />
    );

    await act(async () => {});
    const requestButton = screen.getByRole('button', { name: 'Request Audiobook' });
    fireEvent.click(requestButton);

    const requestPromise = createRequestMock.mock.results[0]?.value;
    await act(async () => {
      await requestPromise;
    });

    expect(onRequestSuccess).toHaveBeenCalled();
    expect(screen.getByText(/Request created!/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('stays open after a successful request that returns an id', async () => {
    vi.useFakeTimers();
    useAuthMock.mockReturnValue({ user: { id: 'admin-1', username: 'admin', role: 'admin' } });
    createRequestMock.mockResolvedValueOnce({ id: 'req-1' });
    const onClose = vi.fn();
    const onRequestSuccess = vi.fn();
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={onClose}
        onRequestSuccess={onRequestSuccess}
      />
    );

    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Request Audiobook' }));

    const requestPromise = createRequestMock.mock.results[0]?.value;
    await act(async () => {
      await requestPromise;
    });

    expect(onRequestSuccess).toHaveBeenCalled();
    expect(screen.getByText(/Request created!/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTitle('Manual Torrent')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('copies the ASIN to the clipboard', async () => {
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await act(async () => {});
    const asinButton = screen.getByText('ASIN123');
    await act(async () => {
      fireEvent.click(asinButton.closest('button') as HTMLButtonElement);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ASIN123');
  });

  it('shows an error state when details fail to load', async () => {
    useAudiobookDetailsMock.mockReturnValue({
      audiobook: null,
      isLoading: false,
      error: 'boom',
    });
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await act(async () => {});
    expect(screen.getByText('Failed to load details')).toBeInTheDocument();
  });

  it('shows availability state and hides interactive search when available', async () => {
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={vi.fn()}
        isAvailable={true}
      />
    );

    await act(async () => {});
    // Status badge and button both show "In Your Library"
    expect(screen.getAllByText('In Your Library').length).toBeGreaterThan(0);
    expect(screen.queryByTitle('Interactive Search')).toBeNull();
  });

  it('shows pending approval status with requester name', async () => {
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={vi.fn()}
        isRequested={true}
        requestStatus="awaiting_approval"
        requestedByUsername="alice"
      />
    );

    await act(async () => {});
    expect(screen.getByRole('button', { name: /Pending Approval \(alice\)/ })).toBeDisabled();
  });

  it('shows request button for denied status (allows re-request)', async () => {
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={vi.fn()}
        isRequested={true}
        requestStatus="denied"
      />
    );

    await act(async () => {});
    // Denied status allows re-requesting, shows Request Audiobook button
    expect(screen.getByRole('button', { name: 'Request Audiobook' })).toBeInTheDocument();
  });

  it('does not show rating badge when rating is zero', async () => {
    useAudiobookDetailsMock.mockReturnValue({
      audiobook: { ...audiobookDetails, rating: 0 },
      isLoading: false,
      error: null,
    });
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await act(async () => {});
    // Rating badge is not shown when rating is 0
    expect(screen.queryByText('0.0')).toBeNull();
  });

  it('opens interactive search when requested', async () => {
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await act(async () => {});

    expect(screen.queryByTestId('interactive-modal')).toBeNull();

    fireEvent.click(screen.getByTitle('Interactive Search'));

    expect(screen.getByTestId('interactive-modal')).toHaveAttribute('data-open', 'true');
  });

  it('shows request error and clears it after timeout', async () => {
    vi.useFakeTimers();
    createRequestMock.mockRejectedValueOnce(new Error('Request failed'));
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Request Audiobook' }));

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

  it('renders sticky footer with status pill and admin icons when opened from a pending request', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'admin-1', username: 'admin', role: 'admin' } });
    const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

    render(
      <AudiobookDetailsModal
        asin="ASIN123"
        isOpen={true}
        onClose={vi.fn()}
        requestStatus="pending"
        isAvailable={false}
      />
    );

    await act(async () => {});

    const statusPill = screen.getByRole('button', { name: 'Requested' });
    expect(statusPill).toBeDisabled();
    expect(screen.getByTitle('Interactive Search')).toBeInTheDocument();
    expect(screen.getByTitle('Manual Import')).toBeInTheDocument();
  });

  describe('Interactive Search routing (advance vs. create)', () => {
    const openInteractiveAndReadForwardedRequestId = async (props: {
      user: { id: string; username: string; role?: string };
      requestStatus?: string | null;
      requestId?: string | null;
      requestedByUserId?: string | null;
    }) => {
      useAuthMock.mockReturnValue({ user: props.user });
      const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

      render(
        <AudiobookDetailsModal
          asin="ASIN123"
          isOpen={true}
          onClose={vi.fn()}
          requestStatus={props.requestStatus ?? null}
          requestId={props.requestId ?? null}
          requestedByUserId={props.requestedByUserId ?? null}
        />
      );

      await act(async () => {});
      fireEvent.click(screen.getByTitle('Interactive Search'));
      const modal = screen.getByTestId('interactive-modal');
      return modal.getAttribute('data-request-id') ?? '';
    };

    it.each(['pending', 'failed', 'awaiting_search', 'awaiting_release'])(
      'forwards requestId when own user has an advanceable %s request',
      async (status) => {
        const forwarded = await openInteractiveAndReadForwardedRequestId({
          user: { id: 'user-1', username: 'u' },
          requestStatus: status,
          requestId: 'req-advance',
          requestedByUserId: 'user-1',
        });
        expect(forwarded).toBe('req-advance');
      }
    );

    it.each(['awaiting_approval', 'searching', 'downloading', 'processing', 'denied'])(
      'does NOT forward requestId when own status is %s (blocked / non-advanceable)',
      async (status) => {
        const forwarded = await openInteractiveAndReadForwardedRequestId({
          user: { id: 'user-1', username: 'u' },
          requestStatus: status,
          requestId: 'req-x',
          requestedByUserId: 'user-1',
        });
        expect(forwarded).toBe('');
      }
    );

    it('does NOT forward requestId for a non-admin viewing another user\'s awaiting_search request', async () => {
      const forwarded = await openInteractiveAndReadForwardedRequestId({
        user: { id: 'user-2', username: 'other' },
        requestStatus: 'awaiting_search',
        requestId: 'req-from-user-1',
        requestedByUserId: 'user-1',
      });
      expect(forwarded).toBe('');
    });

    it('forwards requestId for an admin viewing another user\'s awaiting_search request', async () => {
      const forwarded = await openInteractiveAndReadForwardedRequestId({
        user: { id: 'admin-1', username: 'admin', role: 'admin' },
        requestStatus: 'awaiting_search',
        requestId: 'req-from-user-1',
        requestedByUserId: 'user-1',
      });
      expect(forwarded).toBe('req-from-user-1');
    });

    it('does NOT forward requestId when caller omits requestId entirely', async () => {
      const forwarded = await openInteractiveAndReadForwardedRequestId({
        user: { id: 'user-1', username: 'u' },
        requestStatus: 'awaiting_search',
        requestId: null,
        requestedByUserId: 'user-1',
      });
      expect(forwarded).toBe('');
    });
  });

  describe('manual torrent', () => {
    const renderModal = async (props: {
      user?: {
        id: string;
        username: string;
        role?: string;
        permissions?: Record<string, boolean>;
      } | null;
      requestStatus?: string | null;
      requestId?: string | null;
      requestedByUserId?: string | null;
      isAvailable?: boolean;
    }) => {
      useAuthMock.mockReturnValue({ user: props.user ?? { id: 'admin-1', username: 'admin', role: 'admin' } });
      const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

      render(
        <AudiobookDetailsModal
          asin="ASIN123"
          isOpen={true}
          onClose={vi.fn()}
          isAvailable={props.isAvailable ?? false}
          requestStatus={props.requestStatus ?? null}
          requestId={props.requestId ?? null}
          requestedByUserId={props.requestedByUserId ?? null}
        />
      );

      await act(async () => {});
    };

    it.each(['pending', 'failed', 'awaiting_search', 'awaiting_release'])(
      'renders the Manual Torrent button for an admin on a %s request',
      async (status) => {
        await renderModal({
          requestStatus: status,
          requestId: 'req-1',
          requestedByUserId: 'user-1',
        });

        expect(screen.getByTitle('Manual Torrent')).toBeInTheDocument();
      }
    );

    it('renders the Manual Torrent button for an admin viewing another user\'s request', async () => {
      await renderModal({
        user: { id: 'admin-1', username: 'admin', role: 'admin' },
        requestStatus: 'awaiting_search',
        requestId: 'req-1',
        requestedByUserId: 'user-1',
      });

      expect(screen.getByTitle('Manual Torrent')).toBeInTheDocument();
    });

    it('hides the Manual Torrent button when there is no actionable request', async () => {
      await renderModal({ requestStatus: null, requestId: null });

      expect(screen.queryByTitle('Manual Torrent')).not.toBeInTheDocument();
    });

    it('reveals the Manual Torrent button after the user requests from a card with no requestId', async () => {
      createRequestMock.mockResolvedValueOnce({ id: 'req-1' });

      await renderModal({ requestStatus: null, requestId: null, requestedByUserId: null });

      expect(screen.queryByTitle('Manual Torrent')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Request Audiobook' }));
      await act(async () => {
        await createRequestMock.mock.results[0]?.value;
      });

      expect(screen.getByTitle('Manual Torrent')).toBeInTheDocument();
    });

    it('keeps the Manual Torrent button hidden when the created request has no id', async () => {
      createRequestMock.mockResolvedValueOnce(undefined);

      await renderModal({ requestStatus: null, requestId: null, requestedByUserId: null });

      fireEvent.click(screen.getByRole('button', { name: 'Request Audiobook' }));
      await act(async () => {
        await createRequestMock.mock.results[0]?.value;
      });

      expect(screen.queryByTitle('Manual Torrent')).not.toBeInTheDocument();
    });

    it('forgets the in-session request once the modal closes', async () => {
      createRequestMock.mockResolvedValueOnce({ id: 'req-1' });
      const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');
      useAuthMock.mockReturnValue({ user: { id: 'admin-1', username: 'admin', role: 'admin' } });

      const { rerender } = render(
        <AudiobookDetailsModal asin="ASIN123" isOpen={true} onClose={vi.fn()} />
      );
      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: 'Request Audiobook' }));
      await act(async () => {
        await createRequestMock.mock.results[0]?.value;
      });
      expect(screen.getByTitle('Manual Torrent')).toBeInTheDocument();

      await act(async () => {
        rerender(<AudiobookDetailsModal asin="ASIN123" isOpen={false} onClose={vi.fn()} />);
      });
      await act(async () => {
        rerender(<AudiobookDetailsModal asin="ASIN123" isOpen={true} onClose={vi.fn()} />);
      });

      expect(screen.queryByTitle('Manual Torrent')).not.toBeInTheDocument();
    });

    it('hides the Manual Torrent button for a non-advanceable status', async () => {
      await renderModal({
        requestStatus: 'downloading',
        requestId: 'req-1',
        requestedByUserId: 'user-1',
      });

      expect(screen.queryByTitle('Manual Torrent')).not.toBeInTheDocument();
    });

    it('hides the Manual Torrent button when the book is already available', async () => {
      await renderModal({
        isAvailable: true,
        requestStatus: 'pending',
        requestId: 'req-1',
        requestedByUserId: 'user-1',
      });

      expect(screen.queryByTitle('Manual Torrent')).not.toBeInTheDocument();
    });

    it('hides the Manual Torrent button for a non-admin user', async () => {
      await renderModal({
        user: { id: 'user-1', username: 'u' },
        requestStatus: 'pending',
        requestId: 'req-1',
        requestedByUserId: 'user-1',
      });

      expect(screen.queryByTitle('Manual Torrent')).not.toBeInTheDocument();
    });

    it('submits a magnet link and shows a success notification', async () => {
      fetchWithAuthMock.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, request: { id: 'req-1', status: 'downloading' } }),
      });

      await renderModal({
        requestStatus: 'failed',
        requestId: 'req-1',
        requestedByUserId: 'user-1',
      });

      fireEvent.click(screen.getByTitle('Manual Torrent'));

      const magnet = 'magnet:?xt=urn:btih:abc123def4567890abc123def4567890abc12345';
      fireEvent.change(screen.getByPlaceholderText('magnet:?xt=urn:btih:...'), {
        target: { value: magnet },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start Download' }));
      });

      expect(fetchWithAuthMock).toHaveBeenCalledWith(
        '/api/requests/req-1/manual-download',
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
      );
      const body = fetchWithAuthMock.mock.calls[0][1].body as FormData;
      expect(body.get('magnet')).toBe(magnet);
      expect(screen.getByText('Download started')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Start Download' })).not.toBeInTheDocument();
    });

    it('keeps the modal open and surfaces the API error message on failure', async () => {
      fetchWithAuthMock.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'NoDownloadClient', message: 'No torrent download client configured.' }),
      });

      await renderModal({
        requestStatus: 'failed',
        requestId: 'req-1',
        requestedByUserId: 'user-1',
      });

      fireEvent.click(screen.getByTitle('Manual Torrent'));
      fireEvent.change(screen.getByPlaceholderText('magnet:?xt=urn:btih:...'), {
        target: { value: 'magnet:?xt=urn:btih:abc123' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start Download' }));
      });

      expect(screen.getByText('No torrent download client configured.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Start Download' })).toBeInTheDocument();
    });
  });
});
