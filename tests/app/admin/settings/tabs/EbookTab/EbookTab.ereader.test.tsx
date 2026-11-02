/**
 * Component: E-book Settings Tab - E-Reader Delivery Toggle Tests
 * Documentation: documentation/settings-pages.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EbookTab } from '@/app/admin/settings/tabs/EbookTab/EbookTab';

vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: vi.fn() }));

const ebook = {
  annasArchiveEnabled: true,
  indexerSearchEnabled: false,
  baseUrl: 'https://annas-archive.gl',
  flaresolverrUrl: '',
  preferredFormat: 'epub',
  autoGrabEnabled: true,
  kindleFixEnabled: false,
  ereaderAutoSendEnabled: false,
};

function renderTab(backendMode: 'plex' | 'audiobookshelf', onChange = vi.fn()) {
  render(
    <EbookTab
      ebook={ebook}
      backendMode={backendMode}
      onChange={onChange}
      onSuccess={vi.fn()}
      onError={vi.fn()}
      markAsSaved={vi.fn()}
    />
  );
  return onChange;
}

describe('EbookTab e-reader delivery', () => {
  it('offers e-reader delivery in Audiobookshelf mode', () => {
    const onChange = renderTab('audiobookshelf');

    fireEvent.click(screen.getByLabelText('Send ebooks to e-readers'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ereaderAutoSendEnabled: true }));
  });

  it('hides it in Plex mode, where there are no Audiobookshelf devices', () => {
    renderTab('plex');

    expect(screen.queryByLabelText('Send ebooks to e-readers')).not.toBeInTheDocument();
  });
});
