/**
 * Component: Interactive search shows failed indexer searches (#522)
 * Documentation: documentation/phase3/prowlarr.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchFailureSummary } from '@/lib/utils/indexer-search-failures';

const searchByRequestMock = vi.hoisted(() => vi.fn());
const failures = vi.hoisted(() => ({ current: null as SearchFailureSummary | null }));
const idle = { isLoading: false, error: null };

vi.mock('@/lib/hooks/useReportedIssues', () => ({ useReplaceWithTorrent: () => ({ replaceWithTorrent: vi.fn(), ...idle }) }));
vi.mock('@/lib/hooks/useRequests', () => ({
  useInteractiveSearch: () => ({ searchTorrents: searchByRequestMock, ...idle, searchFailures: failures.current }),
  useSelectTorrent: () => ({ selectTorrent: vi.fn(), ...idle }),
  useSearchTorrents: () => ({ searchTorrents: vi.fn(), ...idle }),
  useRequestWithTorrent: () => ({ requestWithTorrent: vi.fn(), ...idle }),
  useInteractiveSearchEbook: () => ({ searchEbooks: vi.fn(), ...idle }),
  useSelectEbook: () => ({ selectEbook: vi.fn(), ...idle }),
  useInteractiveSearchEbookByAsin: () => ({ searchEbooks: vi.fn(), ...idle }),
  useSelectEbookByAsin: () => ({ selectEbook: vi.fn(), ...idle }),
}));

const result = {
  guid: 'torrent-1', rank: 1, title: 'Working Indexer Result', size: 2 * 1024 ** 3, score: 88,
  bonusPoints: 0, seeders: 4, indexer: 'Indexer', format: 'M4B',
};

async function openModal() {
  const { InteractiveTorrentSearchModal } = await import('@/components/requests/InteractiveTorrentSearchModal');
  render(
    <InteractiveTorrentSearchModal isOpen onClose={vi.fn()} requestId="req-1" audiobook={{ title: 'Book', author: 'Author' }} />
  );
  await waitFor(() => expect(searchByRequestMock).toHaveBeenCalled());
}

describe('interactive search: failed indexer searches (#522)', () => {
  beforeEach(() => {
    searchByRequestMock.mockReset();
    failures.current = null;
  });

  it('some fail: the warning sits above the results that came back', async () => {
    failures.current = { failed: 2, total: 5, errors: ['Request failed with status code 400'] };
    searchByRequestMock.mockResolvedValue([result]);

    await openModal();

    expect(await screen.findByText('Working Indexer Result')).toBeInTheDocument();
    const notice = screen.getByTestId('search-failure-notice');
    expect(notice).toHaveTextContent('2 of 5 indexer searches failed, so results may be incomplete.');
    expect(notice).toHaveTextContent('Error: Request failed with status code 400');
    expect(notice.compareDocumentPosition(screen.getByText('Working Indexer Result')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Search Again' })).not.toBeInTheDocument();
  });

  it('every search fails: the warning replaces "No results found", with Search Again', async () => {
    failures.current = { failed: 2, total: 2, errors: ['Request failed with status code 400'] };
    searchByRequestMock.mockResolvedValue([]);

    await openModal();

    expect(await screen.findByText('All 2 indexer searches failed, so no indexer results could be fetched.')).toBeInTheDocument();
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search Again' }));
    await waitFor(() => expect(searchByRequestMock).toHaveBeenCalledTimes(2));
  });

  it('none fail: no warning, the empty state as before', async () => {
    searchByRequestMock.mockResolvedValue([]);

    await openModal();

    expect(await screen.findByText('No results found')).toBeInTheDocument();
    expect(screen.queryByTestId('search-failure-notice')).not.toBeInTheDocument();
  });
});
