/**
 * Component: Download Category Field, Note and Card Line
 * Documentation: documentation/phase3/download-clients.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadClientModal } from '@/components/admin/download-clients/DownloadClientModal';
import { DownloadClientCard } from '@/components/admin/download-clients/DownloadClientCard';

const fetchMock = vi.fn();

/** Wizard-mode modal; Test passes and the client lists `names` */
function openModal(type: 'qbittorrent' | 'sabnzbd' | 'deluge', names: string[], initialClient?: Record<string, unknown>) {
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (url.includes('categories') ? { success: true, categories: names } : { success: true, message: 'Connected' }),
  }));
  const onSave = vi.fn(async () => undefined);
  render(
    <DownloadClientModal
      isOpen
      onClose={() => undefined}
      mode={initialClient ? 'edit' : 'add'}
      clientType={type}
      initialClient={initialClient as never}
      onSave={onSave}
      apiMode="wizard"
      downloadDir="/downloads"
    />
  );
  fireEvent.change(screen.getByPlaceholderText(/localhost/), { target: { value: 'http://client:1234' } });
  if (type === 'sabnzbd') fireEvent.change(screen.getByPlaceholderText(/API Key/), { target: { value: 'key' } });
  return onSave;
}

async function testConnection() {
  fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));
  await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('categories'), expect.anything()));
}

const typeCategory = (value: string) => fireEvent.change(screen.getByPlaceholderText('readmeabook'), { target: { value } });

describe('Category field in the modal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches suggestions after Test for a usenet client too, without "*"', async () => {
    openModal('sabnzbd', ['books', 'tv']);
    await testConnection();
    await waitFor(() => expect(document.querySelectorAll('datalist option')).toHaveLength(2));
  });

  it('qBittorrent: a name already in the client shows the note; the field stays editable', async () => {
    openModal('qbittorrent', ['Books']);
    await testConnection();
    typeCategory('books');
    expect(screen.getByText("Already in qBittorrent. ReadMeABook won't change it; files still go to /downloads.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText('readmeabook')).not.toBeDisabled();
  });

  it('SABnzbd: the note and the "Downloads to" line name its folder', async () => {
    openModal('sabnzbd', ['books']);
    await testConnection();
    typeCategory('Books');
    expect(screen.getByText("Already in SABnzbd. ReadMeABook won't change it; downloads use its folder and settings.")).toBeInTheDocument();
    expect(screen.getByText("Downloads to: SABnzbd's “books” folder (ReadMeABook must be able to read it)")).toBeInTheDocument();
  });

  it('no note for the default, a new name, or ReadMeABook\'s own category', async () => {
    openModal('qbittorrent', ['readmeabook', 'audiobooks'], {
      id: 'c1', type: 'qbittorrent', name: 'qBittorrent', url: 'http://client:1234', password: 'p', enabled: true,
      disableSSLVerify: false, remotePathMappingEnabled: false, category: 'audiobooks', ownedCategory: 'audiobooks',
    });
    await testConnection();
    expect(screen.queryByText(/Already in/)).not.toBeInTheDocument();
    typeCategory('readmeabook');
    expect(screen.queryByText(/Already in/)).not.toBeInTheDocument();
    typeCategory('brand-new');
    expect(screen.queryByText(/Already in/)).not.toBeInTheDocument();
  });

  it('edit mode: a saved category that is not ReadMeABook\'s own shows the note before any Test', () => {
    openModal('sabnzbd', [], {
      id: 'c1', type: 'sabnzbd', name: 'SABnzbd', url: 'http://client:1234', password: 'key', enabled: true,
      disableSSLVerify: false, remotePathMappingEnabled: false, category: 'books',
    });
    expect(screen.getByText("Already in SABnzbd. ReadMeABook won't change it; downloads use its folder and settings.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    typeCategory('readmeabook');
    expect(screen.queryByText(/Already in/)).not.toBeInTheDocument();
  });

  it('a late answer from an earlier Test never replaces a newer one', async () => {
    openModal('qbittorrent', []);
    const answers: Array<(names: string[]) => void> = [];
    fetchMock.mockImplementation(async (url: string) => url.includes('categories')
      ? { ok: true, json: () => new Promise((resolve) => answers.push((categories) => resolve({ success: true, categories }))) }
      : { ok: true, json: async () => ({ success: true, message: 'Connected' }) });
    fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));
    await waitFor(() => expect(answers).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));
    await waitFor(() => expect(answers).toHaveLength(2));
    answers[1](['Books']);
    await waitFor(() => expect(document.querySelectorAll('datalist option')).toHaveLength(1));
    answers[0](['old-a', 'old-b', 'old-c']);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([...document.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))).toEqual(['Books']);
  });

  it('the save carries the trimmed name and the display-only preview', async () => {
    const onSave = openModal('qbittorrent', ['Books']);
    await testConnection();
    typeCategory('  books ');
    fireEvent.click(screen.getByRole('button', { name: /Add Client/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ category: 'books', categoryInClient: true })));
  });

  it('an empty name and a label Deluge rejects are field errors before anything is sent', async () => {
    openModal('deluge', []);
    typeCategory('  ');
    fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));
    expect(await screen.findByText('Category is required')).toBeInTheDocument();
    typeCategory('Audio Books');
    fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));
    expect(await screen.findByText(/Deluge labels can only use/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Category line on the card', () => {
  const base = { id: 'c1', name: 'qBittorrent', url: 'http://qbit:8080', enabled: true };
  const card = (client: Record<string, unknown>) =>
    render(<DownloadClientCard client={{ ...base, type: 'qbittorrent', ...client } as never} onEdit={() => undefined} onDelete={() => undefined} />);

  it('no line for the default', () => {
    card({ category: 'readmeabook' });
    expect(screen.queryByText(/Category:/)).not.toBeInTheDocument();
  });

  it('ReadMeABook\'s own custom category: the line, no amber suffix', () => {
    card({ category: 'audiobooks', ownedCategory: 'audiobooks' });
    expect(screen.getByText('Category: audiobooks')).toBeInTheDocument();
    expect(screen.queryByText('(existing, left as is)')).not.toBeInTheDocument();
  });

  it('a category that already existed: the suffix in its own non-shrinking span', () => {
    card({ category: 'audiobooks-readarr' });
    const suffix = screen.getByText('(existing, left as is)');
    expect(suffix.className).toContain('flex-shrink-0');
    expect(screen.getByText('Category: audiobooks-readarr').className).toContain('truncate');
  });

  it('the wizard preview decides before ownership is known', () => {
    card({ category: 'audiobooks', categoryInClient: false });
    expect(screen.queryByText('(existing, left as is)')).not.toBeInTheDocument();
  });

  it('the wizard preview for a name already in the client shows the suffix', () => {
    card({ category: 'Books', ownedCategory: 'Books', categoryInClient: true });
    expect(screen.getByText('(existing, left as is)')).toBeInTheDocument();
  });

  it('label clients never show the suffix', () => {
    card({ type: 'deluge', category: 'audiobooks' });
    expect(screen.getByText('Category: audiobooks')).toBeInTheDocument();
    expect(screen.queryByText('(existing, left as is)')).not.toBeInTheDocument();
  });
});
