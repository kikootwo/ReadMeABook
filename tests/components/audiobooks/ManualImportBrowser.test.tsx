/**
 * Component: Manual Import Browser Tests (request type flows to the browse and import APIs, #278)
 * Documentation: documentation/features/manual-import.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchWithAuthMock }));
vi.mock('next/image', () => ({ __esModule: true, default: () => null }));

const book = { asin: 'B0E2E27801', title: 'Book', author: 'Author' };
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

function answer(url: string) {
  if (url === '/api/admin/filesystem/browse') return json({ roots: [{ name: 'Downloads', path: '/downloads', icon: 'download' }] });
  if (url.startsWith('/api/admin/filesystem/browse?')) {
    return json({
      path: '/downloads',
      entries: [],
      ...(url.includes('type=ebook')
        ? { ebookFiles: [{ name: 'Book.epub', size: 2048 }] }
        : { audioFiles: [{ name: 'Book.mp3', size: 4096 }] }),
    });
  }
  if (url === '/api/admin/manual-import') return json({ success: true, requestId: 'r' });
  return json({ error: 'unexpected' }, false);
}

async function openAndImport(props: Record<string, unknown>) {
  const { ManualImportBrowser } = await import('@/components/audiobooks/ManualImportBrowser');
  const onSuccess = vi.fn();
  render(<ManualImportBrowser isOpen onClose={vi.fn()} onSuccess={onSuccess} audiobook={book} {...props} />);
  await act(async () => {});
  fireEvent.click(screen.getByText('Downloads'));
  await act(async () => {});
  return { onSuccess };
}

const browseUrl = () => fetchWithAuthMock.mock.calls.map((c) => c[0] as string).find((u) => u.includes('?path='));
const importBody = () => {
  const call = fetchWithAuthMock.mock.calls.find((c) => c[0] === '/api/admin/manual-import');
  return call ? JSON.parse(call[1].body) : undefined;
};

describe('ManualImportBrowser', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    fetchWithAuthMock.mockImplementation(async (url: string) => answer(url));
  });

  it('an ebook import lists ebook files and imports for the ebook request', async () => {
    const { onSuccess } = await openAndImport({ requestType: 'ebook', requestId: 'req-eb' });

    expect(browseUrl()).toBe('/api/admin/filesystem/browse?path=%2Fdownloads&type=ebook');
    expect(screen.getByText('Book.epub')).toBeInTheDocument();
    expect(screen.queryByText('Book.mp3')).toBeNull();
    expect(screen.getByText(/ebook file in this folder/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Select This Folder/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Import' }));
    await act(async () => {});

    expect(importBody()).toEqual({
      asin: book.asin, folderPath: '/downloads', selectedFiles: ['Book.epub'], cleanupSource: false,
      requestId: 'req-eb', requestType: 'ebook',
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it('an audiobook import is unchanged: audio listing, no type or request id sent', async () => {
    await openAndImport({});

    expect(browseUrl()).toBe('/api/admin/filesystem/browse?path=%2Fdownloads');
    expect(screen.getByText('Book.mp3')).toBeInTheDocument();
    expect(screen.getByText(/audio file in this folder/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Select This Folder/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start Import' }));
    await act(async () => {});

    expect(importBody()).toEqual({ asin: book.asin, folderPath: '/downloads', selectedFiles: ['Book.mp3'], cleanupSource: false });
  });
});
