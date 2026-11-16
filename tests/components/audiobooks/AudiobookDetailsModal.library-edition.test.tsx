/**
 * Component: Audiobook Details Modal Tests, the library's edition of a delivered request (#325)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * With a different `libraryAsin`, the details show that edition and name the requested one, while
 * every action (ebook, Report Issue, both searches, Manual Import, Ignore, download, request) keeps
 * the requested ASIN and record.
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Lookup = { audiobook: Record<string, unknown> | null; isLoading: boolean; error: unknown };
const lookups = vi.hoisted(() => new Map<string, Lookup>());
const calls = vi.hoisted(() => ({ details: [] as (string | null)[], detailArgs: [] as unknown[][], ebook: [] as (string | null)[], download: [] as (string | null)[], ignored: [] as (string | null)[] }));
const user = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const fetchEbookMock = vi.hoisted(() => vi.fn());
const createRequestMock = vi.hoisted(() => vi.fn());
const addIgnoreMock = vi.hoisted(() => vi.fn());
const searchProps = vi.hoisted(() => [] as Record<string, unknown>[]);
const reportProps = vi.hoisted(() => [] as Record<string, unknown>[]);
const importProps = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: user.value }) }));
vi.mock('@/contexts/PreferencesContext', () => ({ usePreferences: () => ({ squareCovers: false }) }));
vi.mock('@/lib/hooks/useExplicitMark', () => ({ useExplicitMarkEnabled: () => false, useSetExplicit: () => ({ setExplicit: vi.fn() }) }));
vi.mock('@/lib/hooks/useAudiobooks', () => ({
  useAudiobookDetails: (...args: [string | null, unknown?]) => {
    const [asin] = args;
    calls.details.push(asin);
    calls.detailArgs.push(args);
    return { audibleBaseUrl: 'https://www.audible.com', ...((asin && lookups.get(asin)) || { audiobook: null, isLoading: false, error: null }) };
  },
}));
vi.mock('@/lib/hooks/useRequests', () => ({
  useCreateRequest: () => ({ createRequest: createRequestMock, isLoading: false }),
  useEbookStatus: (asin: string | null) => {
    calls.ebook.push(asin);
    return { ebookStatus: { ebookSourcesEnabled: true, hasActiveEbookRequest: false }, revalidate: vi.fn() };
  },
  useDownloadStatus: (asin: string | null) => {
    calls.download.push(asin);
    return { downloadAvailable: false, requestId: null };
  },
  useFetchEbookByAsin: () => ({ fetchEbook: fetchEbookMock, isLoading: false }),
}));
vi.mock('@/lib/hooks/useIgnoredAudiobooks', () => ({
  useIsIgnored: (asin: string | null) => {
    calls.ignored.push(asin);
    return { isIgnored: false, ignoredId: null, isLoading: false };
  },
  useToggleIgnore: () => ({ addIgnore: addIgnoreMock, removeIgnore: vi.fn() }),
}));
vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({
  InteractiveTorrentSearchModal: (props: Record<string, unknown>) => { searchProps.push(props); return null; },
}));
vi.mock('@/components/audiobooks/ReportIssueModal', () => ({
  ReportIssueModal: (props: Record<string, unknown>) => { reportProps.push(props); return null; },
}));
vi.mock('@/components/audiobooks/ManualImportBrowser', () => ({
  ManualImportBrowser: (props: Record<string, unknown>) => { importProps.push(props); return null; },
}));
// eslint-disable-next-line @next/next/no-img-element -- a plain <img> stands in for next/image so the cover src can be read
vi.mock('next/image', () => ({ __esModule: true, default: ({ src }: { src: string }) => <img src={src} alt="" /> }));

const { AudiobookDetailsModal } = await import('@/components/audiobooks/AudiobookDetailsModal');

const X = 'B082BHJMFF';
const Y = 'B072R1CY4P';
const requested = {
  asin: X, title: 'Requested Title', author: 'Requested Author', narrator: 'Requested Narrator',
  description: 'Requested summary', durationMinutes: 653, coverArtUrl: 'https://img.example/requested.jpg',
};
const library = {
  asin: Y, title: 'Library Title', author: 'Library Author', narrator: 'Library Narrator',
  description: 'Library summary', durationMinutes: 535, coverArtUrl: 'https://img.example/library.jpg',
};
const found = (audiobook: Record<string, unknown>): Lookup => ({ audiobook, isLoading: false, error: null });

async function open(props: Record<string, unknown>) {
  render(<AudiobookDetailsModal asin={X} isOpen onClose={vi.fn()} {...props} />);
  await act(async () => {});
}

const actionAsins = () => [...calls.ebook, ...calls.download, ...calls.ignored].filter(Boolean);
const lookedUp = () => calls.details.filter(Boolean);

beforeEach(() => {
  lookups.clear();
  lookups.set(X, found(requested));
  lookups.set(Y, found(library));
  for (const list of Object.values(calls)) list.length = 0;
  for (const list of [searchProps, reportProps, importProps]) list.length = 0;
  for (const mock of [fetchEbookMock, createRequestMock, addIgnoreMock]) mock.mockReset();
  fetchEbookMock.mockResolvedValue({ needsApproval: false });
  createRequestMock.mockResolvedValue(undefined);
  addIgnoreMock.mockResolvedValue(undefined);
  user.value = { id: 'user-1', username: 'reader', role: 'user' };
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('AudiobookDetailsModal: a library edition that differs from the request (#325)', () => {
  it('shows the library edition and names the requested one', async () => {
    await open({ libraryAsin: Y, isAvailable: true, requestStatus: 'available' });

    expect(screen.getByRole('heading', { name: 'Library Title' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Requested Title' })).toBeNull();
    expect(screen.getByText('Library Author')).toBeInTheDocument();
    expect(screen.getByText('Narrated by Library Narrator')).toBeInTheDocument();
    expect(screen.getByText('8h 55m')).toBeInTheDocument();
    expect(screen.getByText('Library summary')).toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute('src', library.coverArtUrl);
    expect(screen.getByRole('link', { name: /Audible/ })).toHaveAttribute('href', `https://www.audible.com/pd/${Y}`);

    const asinButton = screen.getByRole('button', { name: Y });
    fireEvent.click(asinButton);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(Y);

    expect(screen.getByTestId('requested-edition')).toHaveTextContent(
      `Requested edition: Requested Title · narrated by Requested Narrator · ${X}`,
    );
  });

  it('keeps every action of a delivered request on the requested ASIN', async () => {
    await open({ libraryAsin: Y, isAvailable: true, requestStatus: 'available' });
    expect(screen.getByRole('heading', { name: 'Library Title' })).toBeInTheDocument();

    expect(actionAsins().length).toBeGreaterThan(0);
    expect(new Set(actionAsins())).toEqual(new Set([X]));

    await act(async () => { fireEvent.click(screen.getByTitle('Grab Ebook')); });
    expect(fetchEbookMock).toHaveBeenCalledWith(X);

    fireEvent.click(screen.getByRole('button', { name: 'Report Issue' }));
    expect(reportProps.at(-1)).toMatchObject({ asin: X, bookTitle: 'Requested Title', bookAuthor: 'Requested Author', coverArtUrl: requested.coverArtUrl });

    fireEvent.click(screen.getByTitle('Search Ebook Sources'));
    expect(searchProps.at(-1)).toMatchObject({ searchMode: 'ebook', asin: X, audiobook: { title: 'Requested Title', author: 'Requested Author' } });

    await act(async () => { fireEvent.click(screen.getByTitle('Ignore from Auto-Requests')); });
    expect(addIgnoreMock).toHaveBeenCalledWith(expect.objectContaining({ asin: X, title: 'Requested Title', author: 'Requested Author' }));
  });

  it('keeps Interactive Search, Manual Import and Request on the requested record', async () => {
    user.value = { id: 'admin-1', username: 'admin', role: 'admin' };
    await open({ libraryAsin: Y, isAvailable: false });
    expect(screen.getByRole('heading', { name: 'Library Title' })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Interactive Search'));
    expect(searchProps.at(-1)).toMatchObject({ audiobook: { title: 'Requested Title', author: 'Requested Author' }, fullAudiobook: requested });

    fireEvent.click(screen.getByTitle('Manual Import'));
    expect(importProps.at(-1)).toMatchObject({ audiobook: { asin: X, title: 'Requested Title', author: 'Requested Author' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Request Audiobook' })); });
    expect(createRequestMock).toHaveBeenCalledWith(requested, expect.anything());
  });

  it('a library edition that cannot be looked up: the requested edition plus the library ASIN', async () => {
    lookups.set(Y, { audiobook: null, isLoading: false, error: new Error('Not found') });
    await open({ libraryAsin: Y, isAvailable: true, requestStatus: 'available' });

    expect(screen.getByRole('heading', { name: 'Requested Title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: X })).toBeInTheDocument();
    expect(screen.getByTestId('requested-edition')).toHaveTextContent(`Your library holds a different edition (ASIN ${Y})`);
    expect(within(screen.getByTestId('requested-edition')).queryByText(/Requested edition/)).toBeNull();
  });

  it('a library lookup in error while it loads again: the requested edition plus the library ASIN, no spinner', async () => {
    lookups.set(Y, { audiobook: null, isLoading: true, error: new Error('Not found') });
    await open({ libraryAsin: Y, isAvailable: true, requestStatus: 'available' });

    expect(screen.getByRole('heading', { name: 'Requested Title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Report Issue' })).toBeInTheDocument();
    expect(screen.getByTestId('requested-edition')).toHaveTextContent(`Your library holds a different edition (ASIN ${Y})`);
  });

  it('looks the library edition up with retry after an error off, and the requested one as before', async () => {
    await open({ libraryAsin: Y, isAvailable: true, requestStatus: 'available' });

    const optionsFor = (asin: string) => calls.detailArgs.filter(([a]) => a === asin).map((args) => args.slice(1));
    expect(optionsFor(Y)).not.toHaveLength(0);
    for (const options of optionsFor(Y)) expect(options).toEqual([{ retryOnError: false }]);
    expect(optionsFor(X)).not.toHaveLength(0);
    for (const options of optionsFor(X)) expect(options).toEqual([]);
  });

  it('waits for the library edition before showing the details (no swap)', async () => {
    lookups.set(Y, { audiobook: null, isLoading: true, error: null });
    await open({ libraryAsin: Y, isAvailable: true, requestStatus: 'available' });

    expect(screen.queryByRole('heading', { name: 'Requested Title' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Report Issue' })).toBeNull();
  });
});

describe('AudiobookDetailsModal: no different library edition (#325)', () => {
  it.each([
    ['no library ASIN', null],
    ['the same ASIN in another case', X.toLowerCase()],
  ])('%s: one lookup, the requested edition, no extra line', async (_label, libraryAsin) => {
    await open({ libraryAsin, isAvailable: true, requestStatus: 'available' });

    expect(new Set(lookedUp())).toEqual(new Set([X]));
    expect(screen.getByRole('heading', { name: 'Requested Title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: X })).toBeInTheDocument();
    expect(screen.queryByTestId('requested-edition')).toBeNull();
  });
});
