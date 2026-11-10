/**
 * Component: Audiobook Details Modal, the Explicit tick on Interactive Search for an existing request (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * A requester's own failed request opened in the details modal: Interactive Search advances that
 * request (select-torrent), which carries no mark, so a confirmed tick is saved through
 * PUT /api/requests/:id/explicit when the pick is confirmed, before select-torrent. A failed save
 * starts nothing and says so in the open search modal. Real: the details modal, the search modal and
 * its confirm, useSetExplicit. Mocked: the request hooks, fetchWithAuth.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => vi.fn());
const selectTorrentMock = vi.hoisted(() => vi.fn());
const hook = (fn: unknown, key: string) => () => ({ [key]: fn, isLoading: false, error: null });

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1', username: 'user', role: 'user' } }) }));
vi.mock('@/contexts/PreferencesContext', () => ({ usePreferences: () => ({ squareCovers: false }) }));
vi.mock('@/lib/hooks/useExplicitMark', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/hooks/useExplicitMark')>()),
  useExplicitMarkEnabled: () => true,
}));
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchMock }));
vi.mock('@/lib/hooks/useAudiobooks', () => ({
  useAudiobookDetails: () => ({ audiobook: { asin: 'ASIN1', title: 'Book', author: 'Author', description: '' }, isLoading: false, error: null }),
}));
vi.mock('@/lib/hooks/useRequests', () => ({
  useCreateRequest: () => ({ createRequest: vi.fn(), isLoading: false }),
  useEbookStatus: () => ({ ebookStatus: null, revalidate: vi.fn() }),
  useDownloadStatus: () => ({ downloadAvailable: false, requestId: null }),
  useFetchEbookByAsin: () => ({ fetchEbook: vi.fn(), isLoading: false }),
  useInteractiveSearch: hook(searchMock, 'searchTorrents'),
  useSelectTorrent: hook(selectTorrentMock, 'selectTorrent'),
  useSearchTorrents: hook(vi.fn(), 'searchTorrents'),
  useRequestWithTorrent: hook(vi.fn(), 'requestWithTorrent'),
  useInteractiveSearchEbook: hook(vi.fn(), 'searchEbooks'),
  useSelectEbook: hook(vi.fn(), 'selectEbook'),
  useInteractiveSearchEbookByAsin: hook(vi.fn(), 'searchEbooks'),
  useSelectEbookByAsin: hook(vi.fn(), 'selectEbook'),
}));
vi.mock('@/lib/hooks/useReportedIssues', () => ({ useReplaceWithTorrent: hook(vi.fn(), 'replaceWithTorrent') }));
vi.mock('@/lib/hooks/useIgnoredAudiobooks', () => ({
  useIsIgnored: () => ({ isIgnored: false, ignoredId: null, isLoading: true }),
  useToggleIgnore: () => ({ addIgnore: vi.fn(), removeIgnore: vi.fn() }),
}));
vi.mock('next/image', () => ({ __esModule: true, default: () => null }));

const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

const release = { guid: 't-1', rank: 1, title: 'Release One', size: 1024 ** 3, score: 80, bonusPoints: 0, seeders: 9, indexer: 'Idx', format: 'M4B' };
const isMarkCall = (call: unknown[]) => String(call[0]).endsWith('/api/requests/req-1/explicit') && (call[1] as RequestInit)?.method === 'PUT';
const markCalls = () => fetchMock.mock.calls.filter(isMarkCall);
const box = () => screen.getByRole('checkbox', { name: /Explicit/ });

let markResponse: { ok: boolean; status: number; body: unknown };

async function openConfirm(props: Partial<React.ComponentProps<typeof AudiobookDetailsModal>> = {}, tick = true) {
  render(
    <AudiobookDetailsModal asin="ASIN1" isOpen={true} onClose={vi.fn()} requestId="req-1" requestStatus="failed" requestedByUserId="user-1" {...props} />
  );
  await act(async () => {});
  if (tick) {
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('button', { name: 'Mark explicit' }));
  }
  fireEvent.click(screen.getByTitle('Interactive Search'));
  fireEvent.click(await screen.findByRole('button', { name: 'Get' }));
  return screen.findByRole('button', { name: 'Download' });
}

async function pickRelease(props: Partial<React.ComponentProps<typeof AudiobookDetailsModal>> = {}, tick = true) {
  fireEvent.click(await openConfirm(props, tick));
}

/** The mark's PUT waits until the returned function is called. */
function holdTheSave() {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'PUT') return { ok: false, status: 403, json: async () => ({}) };
    await gate;
    return { ok: true, status: 200, json: async () => markResponse.body };
  });
  return finish;
}

beforeEach(() => {
  vi.clearAllMocks();
  markResponse = { ok: true, status: 200, body: { success: true, request: { id: 'req-1', explicit: true } } };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return { ok: markResponse.ok, status: markResponse.status, json: async () => markResponse.body };
    return { ok: false, status: 403, json: async () => ({}) }; // the admin blocklist lookup
  });
  searchMock.mockResolvedValue([release]);
  selectTorrentMock.mockResolvedValue(undefined);
});

describe('AudiobookDetailsModal Explicit tick on Interactive Search (existing request)', () => {
  it('saves the mark on the request when the pick is confirmed, before select-torrent', async () => {
    await pickRelease();

    await waitFor(() => expect(selectTorrentMock).toHaveBeenCalledWith('req-1', release));
    expect(searchMock).toHaveBeenCalledWith('req-1', undefined); // the advance path: the existing request
    expect(markCalls()).toHaveLength(1);
    expect(JSON.parse(String((markCalls()[0][1] as RequestInit).body))).toEqual({ explicit: true });
    const markOrder = fetchMock.mock.invocationCallOrder[fetchMock.mock.calls.findIndex(isMarkCall)];
    expect(markOrder).toBeLessThan(selectTorrentMock.mock.invocationCallOrder[0]);
  });

  it('a failed save starts nothing, says so, and keeps the search modal open', async () => {
    markResponse = { ok: false, status: 500, body: { error: 'UpdateError', message: 'Failed to update the explicit mark' } };

    await pickRelease();

    expect(await screen.findByText("The Explicit mark wasn't saved, so the download didn't start. Try again.")).toBeInTheDocument();
    expect(selectTorrentMock).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Find Audiobook' })).toBeInTheDocument();
  });

  it('a request already marked: no second save, the pick goes ahead', async () => {
    await pickRelease({ requestExplicit: true }, false);

    await waitFor(() => expect(selectTorrentMock).toHaveBeenCalledWith('req-1', release));
    expect(markCalls()).toHaveLength(0);
  });

  it('one click, one download: a second Download click while the mark saves sends nothing more', async () => {
    const finishSave = holdTheSave();
    const download = await openConfirm();

    fireEvent.click(download);
    fireEvent.click(download);
    expect(download).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => { finishSave(); });

    await waitFor(() => expect(selectTorrentMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(markCalls()).toHaveLength(1);
    expect(selectTorrentMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Esc', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['closing the search', () => fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!)],
  ])('backing out with %s while the mark saves starts no download', async (_how, backOut) => {
    const finishSave = holdTheSave();
    fireEvent.click(await openConfirm());

    backOut();
    await act(async () => { finishSave(); });
    await act(async () => {});

    expect(markCalls()).toHaveLength(1);
    expect(selectTorrentMock).not.toHaveBeenCalled();
  });

  it('no tick: no save', async () => {
    await pickRelease({}, false);

    await waitFor(() => expect(selectTorrentMock).toHaveBeenCalled());
    expect(markCalls()).toHaveLength(0);
  });
});
