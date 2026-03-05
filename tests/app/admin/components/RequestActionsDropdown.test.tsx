/**
 * Component: Request Actions Dropdown Tests
 * Documentation: documentation/admin-features/request-deletion.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RequestActionsDropdown } from '@/app/admin/components/RequestActionsDropdown';

vi.mock('@/hooks/useSmartDropdownPosition', () => ({
  useSmartDropdownPosition: () => ({
    containerRef: { current: null },
    dropdownRef: { current: null },
    positionAbove: false,
    style: { position: 'fixed', top: 0, left: 0, minWidth: 120 },
  }),
}));

vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({
  InteractiveTorrentSearchModal: ({
    isOpen,
    audiobook,
  }: {
    isOpen: boolean;
    audiobook: { title: string; author: string };
  }) => (isOpen ? <div>Interactive search for {audiobook.title}</div> : null),
}));

vi.mock('@/app/admin/components/AdjustSearchTermsModal', () => ({
  AdjustSearchTermsModal: () => null,
}));

describe('RequestActionsDropdown', () => {
  it('exposes manual search, interactive search, cancel, and delete actions', async () => {
    const onManualSearch = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn();

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <RequestActionsDropdown
        request={{
          requestId: 'req-1',
          title: 'Pending Book',
          author: 'Author',
          status: 'pending',
        }}
        onManualSearch={onManualSearch}
        onCancel={onCancel}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByTitle('Actions'));

    expect(screen.getByText('Manual Search')).toBeInTheDocument();
    expect(screen.getByText('Interactive Search')).toBeInTheDocument();
    expect(screen.getByText('Cancel Request')).toBeInTheDocument();
    expect(screen.getByText('Delete Request')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Manual Search'));
    await waitFor(() => expect(onManualSearch).toHaveBeenCalledWith('req-1'));

    fireEvent.click(screen.getByTitle('Actions'));
    fireEvent.click(screen.getByText('Interactive Search'));
    expect(screen.getByText('Interactive search for Pending Book')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Actions'));
    fireEvent.click(screen.getByText('Cancel Request'));
    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('req-1'));

    fireEvent.click(screen.getByTitle('Actions'));
    fireEvent.click(screen.getByText('Delete Request'));
    expect(onDelete).toHaveBeenCalledWith('req-1', 'Pending Book');
  });

  it('uses configured base URL for ebook View Source link', () => {
    render(
      <RequestActionsDropdown
        request={{
          requestId: 'req-ebook',
          title: 'Ebook Title',
          author: 'Author',
          status: 'downloaded',
          type: 'ebook',
          torrentUrl: JSON.stringify(['https://annas-archive.gl/slow_download/abc123def456abc123def456abc123de/0/5']),
        }}
        onManualSearch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn()}
        annasArchiveBaseUrl="https://custom-mirror.org"
      />
    );

    fireEvent.click(screen.getByTitle('Actions'));
    const viewSourceLink = screen.getByText('View Source').closest('a');
    expect(viewSourceLink).toHaveAttribute('href', 'https://custom-mirror.org/md5/abc123def456abc123def456abc123de');
  });

  it('shows view source and ebook fetch when available', async () => {
    const onFetchEbook = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn();

    render(
      <RequestActionsDropdown
        request={{
          requestId: 'req-2',
          title: 'Downloaded Book',
          author: 'Author',
          status: 'downloaded',
          torrentUrl: 'https://example.com/torrent',
        }}
        onManualSearch={vi.fn().mockResolvedValue(undefined)}
        onCancel={vi.fn().mockResolvedValue(undefined)}
        onDelete={onDelete}
        onFetchEbook={onFetchEbook}
        ebookSidecarEnabled
      />
    );

    fireEvent.click(screen.getByTitle('Actions'));

    expect(screen.getByText('View Source')).toBeInTheDocument();
    expect(screen.getByText('Grab Ebook')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Grab Ebook'));
    await waitFor(() => expect(onFetchEbook).toHaveBeenCalledWith('req-2'));
  });
});
