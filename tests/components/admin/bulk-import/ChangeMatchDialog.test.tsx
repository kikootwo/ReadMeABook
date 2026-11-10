/**
 * Component: Bulk Import - Change match dialog on its own (search overlap, long terms, closing, phones)
 * Documentation: documentation/features/bulk-import.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScannedBook } from '@/components/admin/bulk-import/types';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchWithAuthMock }));

const { ChangeMatchDialog } = await import('@/components/admin/bulk-import/ChangeMatchDialog');

const PICK = { asin: 'B0PICK0001', title: 'Pick Title', author: 'Pick Author', inLibrary: false, hasActiveRequest: false };
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

function book(over: Partial<ScannedBook> = {}): ScannedBook {
  return {
    index: 0, folderPath: '/downloads/Folder', folderName: 'Folder', relativePath: 'Folder', audioFileCount: 1, totalSizeBytes: 1,
    metadataSource: 'tags', searchTerm: 'scan term', audioFiles: ['01.m4b'],
    match: { asin: 'B0SCAN0001', title: 'Scan Guess', author: 'Guess Author' },
    inLibrary: false, hasActiveRequest: false, skipped: false, ...over,
  };
}

function open(over: Partial<ScannedBook> = {}) {
  const onClose = vi.fn();
  render(<ChangeMatchDialog book={book(over)} onChoose={vi.fn()} onClose={onClose} restoreFocus={() => {}} />);
  return { onClose, field: screen.getByRole('searchbox') as HTMLInputElement, overlay: screen.getByRole('dialog').parentElement! };
}

const queries = () => fetchWithAuthMock.mock.calls.map((c) => new URL(String(c[0]), 'http://x').searchParams.get('q'));

describe('ChangeMatchDialog', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a new search replaces the open search while it is still loading', async () => {
    fetchWithAuthMock.mockImplementation((url: string, init: RequestInit) =>
      url.includes('B0PICK0001')
        ? Promise.resolve(json({ kind: 'asin', asin: 'B0PICK0001', store: 'audible.com', results: [PICK] }))
        : new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    const { field } = open();
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('Searching…');

    fireEvent.change(field, { target: { value: 'B0PICK0001' } });
    const search = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement;
    expect(search.disabled).toBe(false);
    fireEvent.click(search);
    await act(async () => {});

    expect(queries()).toEqual(['scan term', 'B0PICK0001']);
    expect((fetchWithAuthMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('1 result');
  });

  it('cuts a scan term over 200 characters to fit before the first search', async () => {
    fetchWithAuthMock.mockResolvedValue(json({ kind: 'search', asin: null, store: 'audible.com', results: [PICK] }));
    const { field } = open({ searchTerm: `${'Long Title '.repeat(25)}Author` });
    await act(async () => {});

    expect(queries()[0]).toHaveLength(200);
    expect(field.value).toHaveLength(200);
    expect(field.maxLength).toBe(200);
    expect(screen.getByRole('status').textContent).toBe('1 result');
  });

  it('says nothing came back for a typed ASIN (true whether Audible has no such book or could not be reached)', async () => {
    fetchWithAuthMock.mockResolvedValue(json({ kind: 'asin', asin: 'B0MISS0001', store: 'audible.co.uk', results: [] }));
    const { field } = open({ match: null });
    fireEvent.change(field, { target: { value: 'B0MISS0001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await act(async () => {});

    expect(screen.getByRole('status').textContent).toBe('Nothing came back for B0MISS0001 from audible.co.uk');
  });

  it('says Audible could not be reached when the lookup failed', async () => {
    fetchWithAuthMock.mockResolvedValue(json({ error: 'Audible lookup failed' }, 502));
    open();
    await act(async () => {});

    expect(screen.getByRole('status').textContent).toBe("Couldn't reach Audible. Try again.");
  });

  it('closes on a click on the dimmed panel, not on a drag that started in the field', async () => {
    fetchWithAuthMock.mockResolvedValue(json({ kind: 'search', asin: null, store: 'audible.com', results: [] }));
    const { onClose, field, overlay } = open();
    await act(async () => {});

    fireEvent.mouseDown(field);
    fireEvent.mouseUp(overlay);
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('on a phone the field lets go of focus once results show (the keyboard would cover them)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} }));
    fetchWithAuthMock.mockResolvedValue(json({ kind: 'search', asin: null, store: 'audible.com', results: [PICK] }));
    const { field } = open();
    expect(document.activeElement).toBe(field);
    await act(async () => {});

    expect(screen.getByRole('status').textContent).toBe('1 result');
    expect(document.activeElement).not.toBe(field);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('on a wide screen the field keeps focus after results show', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    fetchWithAuthMock.mockResolvedValue(json({ kind: 'search', asin: null, store: 'audible.com', results: [PICK] }));
    const { field } = open();
    await act(async () => {});

    expect(document.activeElement).toBe(field);
  });
});
