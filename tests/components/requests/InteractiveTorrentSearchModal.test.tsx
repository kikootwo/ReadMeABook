/**
 * Component: Interactive Torrent Search Modal Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const searchByRequestMock = vi.hoisted(() => vi.fn());
const selectTorrentMock = vi.hoisted(() => vi.fn());
const searchByAudiobookMock = vi.hoisted(() => vi.fn());
const requestWithTorrentMock = vi.hoisted(() => vi.fn());
const searchEbooksMock = vi.hoisted(() => vi.fn());
const selectEbookMock = vi.hoisted(() => vi.fn());
const searchEbooksByAsinMock = vi.hoisted(() => vi.fn());
const selectEbookByAsinMock = vi.hoisted(() => vi.fn());
const replaceWithTorrentMock = vi.hoisted(() => vi.fn());
const useIsTruncatedMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/lib/hooks/useReportedIssues', () => ({
  useReplaceWithTorrent: () => ({
    replaceWithTorrent: replaceWithTorrentMock,
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/lib/hooks/useIsTruncated', () => ({
  useIsTruncated: useIsTruncatedMock,
}));

vi.mock('@/lib/hooks/useRequests', () => ({
  useInteractiveSearch: () => ({
    searchTorrents: searchByRequestMock,
    isLoading: false,
    error: null,
  }),
  useSelectTorrent: () => ({
    selectTorrent: selectTorrentMock,
    isLoading: false,
    error: null,
  }),
  useSearchTorrents: () => ({
    searchTorrents: searchByAudiobookMock,
    isLoading: false,
    error: null,
  }),
  useRequestWithTorrent: () => ({
    requestWithTorrent: requestWithTorrentMock,
    isLoading: false,
    error: null,
  }),
  useInteractiveSearchEbook: () => ({
    searchEbooks: searchEbooksMock,
    isLoading: false,
    error: null,
  }),
  useSelectEbook: () => ({
    selectEbook: selectEbookMock,
    isLoading: false,
    error: null,
  }),
  useInteractiveSearchEbookByAsin: () => ({
    searchEbooks: searchEbooksByAsinMock,
    isLoading: false,
    error: null,
  }),
  useSelectEbookByAsin: () => ({
    selectEbook: selectEbookByAsinMock,
    isLoading: false,
    error: null,
  }),
}));

const baseResult = {
  guid: 'torrent-1',
  rank: 1,
  title: 'Test Torrent',
  size: 2.4 * 1024 ** 3,
  score: 88,
  bonusPoints: 5,
  seeders: 42,
  indexer: 'ProIndexer',
  format: 'M4B',
  infoUrl: 'https://example.com/torrent',
};

describe('InteractiveTorrentSearchModal', () => {
  it('searches by request id on open and confirms download', async () => {
    searchByRequestMock.mockResolvedValueOnce([baseResult]);
    selectTorrentMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const { InteractiveTorrentSearchModal } = await import('@/components/requests/InteractiveTorrentSearchModal');

    render(
      <InteractiveTorrentSearchModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
        requestId="req-123"
        audiobook={{ title: 'Test Book', author: 'Test Author' }}
      />
    );

    await waitFor(() => {
      expect(searchByRequestMock).toHaveBeenCalledWith('req-123', undefined);
    });

    expect(await screen.findByText('Test Torrent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Get' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    await waitFor(() => {
      expect(selectTorrentMock).toHaveBeenCalledWith('req-123', baseResult);
    });
    // When requestId is set, the modal must NOT fall into the create-new-request
    // branch — that's the routing fix for own-request advanceable states.
    expect(requestWithTorrentMock).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('searches by audiobook data and requests with torrent', async () => {
    searchByAudiobookMock.mockResolvedValueOnce([baseResult]);
    requestWithTorrentMock.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const fullAudiobook = { asin: 'ASIN-1', title: 'Test Book', author: 'Test Author' };
    const { InteractiveTorrentSearchModal } = await import('@/components/requests/InteractiveTorrentSearchModal');

    render(
      <InteractiveTorrentSearchModal
        isOpen={true}
        onClose={onClose}
        audiobook={{ title: 'Test Book', author: 'Test Author' }}
        fullAudiobook={fullAudiobook as any}
      />
    );

    await waitFor(() => {
      expect(searchByAudiobookMock).toHaveBeenCalledWith('Test Book', 'Test Author', 'ASIN-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Get' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    await waitFor(() => {
      expect(requestWithTorrentMock).toHaveBeenCalledWith(fullAudiobook, baseResult);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('uses a custom title when pressing Enter', async () => {
    searchByRequestMock.mockResolvedValueOnce([]);
    searchByRequestMock.mockResolvedValueOnce([]);
    const { InteractiveTorrentSearchModal } = await import('@/components/requests/InteractiveTorrentSearchModal');

    render(
      <InteractiveTorrentSearchModal
        isOpen={true}
        onClose={vi.fn()}
        requestId="req-456"
        audiobook={{ title: 'Original Title', author: 'Author' }}
      />
    );

    await waitFor(() => {
      expect(searchByRequestMock).toHaveBeenCalledWith('req-456', undefined);
    });

    const input = screen.getByPlaceholderText('Search title...');
    fireEvent.change(input, { target: { value: 'Custom Title' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(searchByRequestMock).toHaveBeenNthCalledWith(2, 'req-456', 'Custom Title');
    });
  });

  describe('title chips and chevron expand', () => {
    const renderWithResults = async (results: any[]) => {
      searchByRequestMock.mockResolvedValueOnce(results);
      const { InteractiveTorrentSearchModal } = await import('@/components/requests/InteractiveTorrentSearchModal');
      const utils = render(
        <InteractiveTorrentSearchModal
          isOpen={true}
          onClose={vi.fn()}
          requestId="req-chip"
          audiobook={{ title: 'Test Book', author: 'Author' }}
        />,
      );
      await waitFor(() => {
        expect(searchByRequestMock).toHaveBeenCalled();
      });
      return utils;
    };

    it('renders the title verbatim regardless of bracketed metadata', async () => {
      await renderWithResults([
        { ...baseResult, guid: 'verbatim', title: 'Foundation [German] [Unabridged]' },
      ]);
      const link = await screen.findByRole('link', { name: 'Foundation [German] [Unabridged]' });
      expect(link.textContent).toBe('Foundation [German] [Unabridged]');
      expect(link).toHaveAttribute('aria-label', 'Foundation [German] [Unabridged]');
      expect(link).toHaveAttribute('title', 'Foundation [German] [Unabridged]');
    });

    it('renders no chips when the title has no brackets', async () => {
      await renderWithResults([
        { ...baseResult, guid: 'no-brackets', title: 'Plain Title', format: undefined },
      ]);
      await screen.findByRole('link', { name: 'Plain Title' });
      // Slate-toned chip class is unique to title-tag chips
      expect(document.querySelectorAll('span.bg-slate-100').length).toBe(0);
    });

    it('renders a slate chip for each bracketed tag', async () => {
      await renderWithResults([
        { ...baseResult, guid: 'multi', title: 'Foundation [German] [Unabridged]', format: 'M4B' },
      ]);
      await screen.findByRole('link', { name: 'Foundation [German] [Unabridged]' });
      const german = screen.getByText('German');
      const unabridged = screen.getByText('Unabridged');
      expect(german.className).toMatch(/bg-slate-100/);
      expect(unabridged.className).toMatch(/bg-slate-100/);
    });

    it('filters a tag that matches displayFormat case-insensitively', async () => {
      await renderWithResults([
        { ...baseResult, guid: 'dedupe', title: 'Foundation [MP3]', format: 'mp3' },
      ]);
      await screen.findByRole('link', { name: 'Foundation [MP3]' });
      // The purple format pill renders the format (uppercased by CSS, raw text retained)
      expect(screen.getByText('mp3')).toBeInTheDocument();
      // No duplicate slate chip for MP3
      expect(document.querySelectorAll('span.bg-slate-100').length).toBe(0);
    });

    it('does not render the chevron when the title fits', async () => {
      useIsTruncatedMock.mockReturnValue(false);
      await renderWithResults([
        { ...baseResult, guid: 'fits', title: 'Foundation [German]' },
      ]);
      await screen.findByRole('link', { name: 'Foundation [German]' });
      expect(screen.queryByRole('button', { name: /show full title|hide full title/i })).not.toBeInTheDocument();
    });

    it('renders the chevron when the title is truncated', async () => {
      useIsTruncatedMock.mockReturnValue(true);
      await renderWithResults([
        { ...baseResult, guid: 'truncated', title: 'A Very Long Title That Overflows [German]' },
      ]);
      await screen.findByRole('link', { name: 'A Very Long Title That Overflows [German]' });
      const chevron = screen.getByRole('button', { name: 'Show full title' });
      expect(chevron).toHaveAttribute('aria-expanded', 'false');
    });

    it('toggles expansion when the chevron is clicked and keeps it visible while expanded', async () => {
      useIsTruncatedMock.mockReturnValue(true);
      await renderWithResults([
        { ...baseResult, guid: 'toggle', title: 'A Very Long Title That Overflows [German]' },
      ]);
      const link = await screen.findByRole('link', { name: 'A Very Long Title That Overflows [German]' });
      expect(link.className).toMatch(/truncate/);
      expect(link.className).not.toMatch(/break-words/);

      const chevron = screen.getByRole('button', { name: 'Show full title' });
      fireEvent.click(chevron);

      // After expand, the hook may report not-truncated; chevron must stay visible.
      useIsTruncatedMock.mockReturnValue(false);
      const collapse = screen.getByRole('button', { name: 'Hide full title' });
      expect(collapse).toHaveAttribute('aria-expanded', 'true');
      expect(link.className).toMatch(/break-words/);
      expect(link.className).not.toMatch(/truncate/);

      fireEvent.click(collapse);
      expect(screen.queryByRole('button', { name: 'Hide full title' })).not.toBeInTheDocument();
    });

    it('expands rows independently', async () => {
      useIsTruncatedMock.mockReturnValue(true);
      await renderWithResults([
        { ...baseResult, guid: 'row-a', title: 'A Title That Overflows [German]' },
        { ...baseResult, guid: 'row-b', title: 'B Title That Overflows [Spanish]' },
      ]);
      await screen.findByRole('link', { name: 'A Title That Overflows [German]' });

      const chevrons = screen.getAllByRole('button', { name: 'Show full title' });
      expect(chevrons.length).toBe(2);

      fireEvent.click(chevrons[0]);
      expect(screen.getAllByRole('button', { name: 'Hide full title' }).length).toBe(1);
      expect(screen.getAllByRole('button', { name: 'Show full title' }).length).toBe(1);
    });

    it('clicking the title link does not toggle expansion', async () => {
      useIsTruncatedMock.mockReturnValue(true);
      await renderWithResults([
        { ...baseResult, guid: 'link-click', title: 'A Very Long Title [German]' },
      ]);
      const link = await screen.findByRole('link', { name: 'A Very Long Title [German]' });
      expect(link).toHaveAttribute('href', 'https://example.com/torrent');

      fireEvent.click(link);
      expect(screen.getByRole('button', { name: 'Show full title' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('falls back gracefully on malformed brackets without crashing', async () => {
      useIsTruncatedMock.mockReturnValue(false);
      await renderWithResults([
        { ...baseResult, guid: 'malformed', title: 'Foundation [unclosed' },
      ]);
      const link = await screen.findByRole('link', { name: 'Foundation [unclosed' });
      expect(link.textContent).toBe('Foundation [unclosed');
    });

    it('resets expansion state when the modal closes and reopens', async () => {
      useIsTruncatedMock.mockReturnValue(true);
      searchByRequestMock.mockResolvedValueOnce([
        { ...baseResult, guid: 'reset', title: 'A Long Title That Overflows [German]' },
      ]);
      const { InteractiveTorrentSearchModal } = await import('@/components/requests/InteractiveTorrentSearchModal');

      const { rerender } = render(
        <InteractiveTorrentSearchModal
          isOpen={true}
          onClose={vi.fn()}
          requestId="req-reset"
          audiobook={{ title: 'Test Book', author: 'Author' }}
        />,
      );

      await screen.findByRole('link', { name: 'A Long Title That Overflows [German]' });
      fireEvent.click(screen.getByRole('button', { name: 'Show full title' }));
      expect(screen.getByRole('button', { name: 'Hide full title' })).toHaveAttribute('aria-expanded', 'true');

      // Close
      rerender(
        <InteractiveTorrentSearchModal
          isOpen={false}
          onClose={vi.fn()}
          requestId="req-reset"
          audiobook={{ title: 'Test Book', author: 'Author' }}
        />,
      );

      // Reopen — search runs again
      searchByRequestMock.mockResolvedValueOnce([
        { ...baseResult, guid: 'reset', title: 'A Long Title That Overflows [German]' },
      ]);
      rerender(
        <InteractiveTorrentSearchModal
          isOpen={true}
          onClose={vi.fn()}
          requestId="req-reset"
          audiobook={{ title: 'Test Book', author: 'Author' }}
        />,
      );

      await screen.findByRole('link', { name: 'A Long Title That Overflows [German]' });
      expect(screen.getByRole('button', { name: 'Show full title' })).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
