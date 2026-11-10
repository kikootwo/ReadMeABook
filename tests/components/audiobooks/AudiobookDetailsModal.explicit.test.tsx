/**
 * Component: Audiobook Details Modal, the Explicit checkbox (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * Wherever Request shows (Audiobookshelf mode, never on a denied request) a checkbox sits above the
 * action buttons; its value goes to createRequest and to the interactive search's new request. A
 * marked request re-opened from My Requests starts checked.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ isABS: true, role: 'user' }));
const createRequestMock = vi.hoisted(() => vi.fn());
const searchModalProps = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1', username: 'user', role: state.role } }) }));
vi.mock('@/contexts/PreferencesContext', () => ({ usePreferences: () => ({ squareCovers: false }) }));
vi.mock('@/lib/hooks/useExplicitMark', () => ({ useIsAudiobookshelf: () => state.isABS, useSetExplicit: () => ({ setExplicit: vi.fn(), isLoading: false }) }));
vi.mock('@/lib/hooks/useAudiobooks', () => ({
  useAudiobookDetails: () => ({ audiobook: { asin: 'ASIN1', title: 'Book', author: 'Author', description: '' }, isLoading: false, error: null }),
}));
vi.mock('@/lib/hooks/useRequests', () => ({
  useCreateRequest: () => ({ createRequest: createRequestMock, isLoading: false }),
  useEbookStatus: () => ({ ebookStatus: null, revalidate: vi.fn() }),
  useDownloadStatus: () => ({ downloadAvailable: false, requestId: null }),
  useFetchEbookByAsin: () => ({ fetchEbook: vi.fn(), isLoading: false }),
}));
vi.mock('@/lib/hooks/useIgnoredAudiobooks', () => ({
  useIsIgnored: () => ({ isIgnored: false, ignoredId: null, isLoading: true }),
  useToggleIgnore: () => ({ addIgnore: vi.fn(), removeIgnore: vi.fn() }),
}));
vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({
  InteractiveTorrentSearchModal: (props: { explicit?: boolean; searchMode?: string }) => {
    searchModalProps(props);
    return <div data-testid="interactive-modal" />;
  },
}));
vi.mock('next/image', () => ({ __esModule: true, default: () => null }));

const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

const box = () => screen.queryByRole('checkbox', { name: /Explicit/ });

async function open(props: Partial<React.ComponentProps<typeof AudiobookDetailsModal>> = {}) {
  render(<AudiobookDetailsModal asin="ASIN1" isOpen={true} onClose={vi.fn()} {...props} />);
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  state.isABS = true;
  state.role = 'user';
  createRequestMock.mockResolvedValue({ id: 'req-1' });
});

describe('AudiobookDetailsModal Explicit checkbox', () => {
  it('unticked by default; Request sends explicit false', async () => {
    await open();

    expect(box()).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Request Audiobook' }));
    await act(async () => {});

    expect(createRequestMock).toHaveBeenCalledWith(expect.objectContaining({ asin: 'ASIN1' }), { explicit: false });
  });

  it('ticked (after the confirm) sends explicit true', async () => {
    await open();

    fireEvent.click(box()!);
    fireEvent.click(screen.getByRole('button', { name: 'Mark explicit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Request Audiobook' }));
    await act(async () => {});

    expect(createRequestMock).toHaveBeenCalledWith(expect.anything(), { explicit: true });
  });

  it('an admin ticks without a confirm, and the interactive search creates the request marked', async () => {
    state.role = 'admin';
    await open();

    fireEvent.click(box()!);
    fireEvent.click(screen.getByTitle('Interactive Search'));

    expect(searchModalProps).toHaveBeenLastCalledWith(expect.objectContaining({ explicit: true }));
  });

  it.each([
    ['Plex mode (or still loading)', () => { state.isABS = false; }, {}],
    ['a denied request', () => {}, { requestStatus: 'denied' }],
    ['a book in the library', () => {}, { isAvailable: true }],
    ['a request in progress', () => {}, { requestStatus: 'downloading' }],
    ['an ebook request', () => {}, { requestType: 'ebook' as const }],
    ['a read-only context', () => {}, { hideRequestActions: true }],
  ])('hidden for %s', async (_label, arrange, props) => {
    arrange();
    await open(props);

    expect(box()).toBeNull();
  });

  it('hidden in Plex mode: Request sends explicit false', async () => {
    state.isABS = false;
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Request Audiobook' }));
    await act(async () => {});

    expect(createRequestMock).toHaveBeenCalledWith(expect.anything(), { explicit: false });
  });

  it('a marked request re-opened for a re-request starts checked and locked', async () => {
    await open({ requestId: 'req-1', requestStatus: 'failed', requestExplicit: true });

    expect(box()).toBeChecked();
    expect(box()).toBeDisabled();
    expect(screen.getByText('Only an admin can remove this')).toBeInTheDocument();
  });

  it('a requester can untick their own tick before sending: nothing is saved yet', async () => {
    await open();

    fireEvent.click(box()!);
    fireEvent.click(screen.getByRole('button', { name: 'Mark explicit' }));
    expect(box()).toBeChecked();
    expect(box()).toBeEnabled();
    expect(screen.queryByText('Only an admin can remove this')).toBeNull();

    fireEvent.click(box()!);
    expect(box()).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Request Audiobook' }));
    await act(async () => {});

    expect(createRequestMock).toHaveBeenCalledWith(expect.anything(), { explicit: false });
  });
});
