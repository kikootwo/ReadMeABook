/**
 * Component: Request Actions Dropdown - the Add Torrent item (admin)
 * Documentation: documentation/phase3/manual-torrent-download.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({ InteractiveTorrentSearchModal: () => null }));
vi.mock('@/app/admin/components/AdjustSearchTermsModal', () => ({ AdjustSearchTermsModal: () => null }));
vi.mock('@/app/admin/components/AddTorrentDialog', () => ({
  AddTorrentDialog: ({ requestId, bookTitle }: { requestId: string; bookTitle: string }) => <div>Add Torrent dialog for {requestId}: {bookTitle}</div>,
}));

function openMenu(status: string, type?: 'audiobook' | 'ebook') {
  render(
    <RequestActionsDropdown
      request={{ requestId: 'req-1', title: 'Generated Title', author: 'Author', status, type }}
      onManualSearch={vi.fn()}
      onCancel={vi.fn()}
      onDelete={vi.fn()}
    />
  );
  fireEvent.click(screen.getByTitle('Actions'));
}

describe('RequestActionsDropdown: Add Torrent', () => {
  it.each(['pending', 'failed', 'awaiting_search', 'awaiting_release'])('is offered on an audiobook request that is %s, right after Interactive Search', (status) => {
    openMenu(status, 'audiobook');
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent?.trim());
    expect(items.indexOf('Add Torrent')).toBe(items.indexOf('Interactive Search') + 1);
  });

  it.each(['awaiting_approval', 'denied', 'searching', 'downloading', 'processing', 'downloaded', 'available', 'cancelled'])('is not offered on a request that is %s', (status) => {
    openMenu(status);
    expect(screen.queryByText('Add Torrent')).toBeNull();
  });

  it('is not offered on an ebook request', () => {
    openMenu('failed', 'ebook');
    expect(screen.queryByText('Add Torrent')).toBeNull();
  });

  it('opens the dialog for this request, outside the closed menu', () => {
    openMenu('failed');
    expect(screen.queryByText(/Add Torrent dialog/)).toBeNull();
    fireEvent.click(screen.getByText('Add Torrent'));
    expect(screen.getByText('Add Torrent dialog for req-1: Generated Title')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
