/**
 * Component: Bulk Import wizard - Change match / Find match on the review screen (#189)
 * Documentation: documentation/features/bulk-import.md
 *
 * Real wizard, review step and dialog; only fetchWithAuth is faked (scan SSE, match search, execute).
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchWithAuthMock }));

const SCAN = { asin: 'B0SCAN0001', title: 'Scan Guess', author: 'Guess Author', narrator: 'Guess Narrator' };
const FREE = { asin: 'B0FREE0001', title: 'Free Pick', author: 'Pick Author', narrator: 'Pick Narrator', coverArtUrl: '/free.jpg', durationMinutes: 485, inLibrary: false, hasActiveRequest: false };
const OWNED = { asin: 'B0OWND0001', title: 'Owned Book', author: 'Owned Author', inLibrary: true, hasActiveRequest: false };
const ASKED = { asin: 'B0ASKD0001', title: 'Asked Book', author: 'Asked Author', inLibrary: false, hasActiveRequest: true };
const TYPED = { asin: 'B0TYPD0001', title: 'Typed Pick', author: 'Typed Author', inLibrary: false, hasActiveRequest: false };

const base = { audioFileCount: 1, totalSizeBytes: 10, metadataSource: 'tags', audioFiles: ['01.m4b'] };
const ROWS = [
  { ...base, index: 0, folderPath: '/downloads/Wrong', folderName: 'Wrong', relativePath: 'Wrong', searchTerm: 'wrong term', match: SCAN, inLibrary: false, hasActiveRequest: false, inMediaFolder: false },
  { ...base, index: 1, folderPath: '/downloads/Unknown', folderName: 'Unknown', relativePath: 'Unknown', searchTerm: 'unknown term', match: null, inLibrary: false, hasActiveRequest: false, inMediaFolder: false },
  { ...base, index: 2, folderPath: '/downloads/Asked', folderName: 'Asked', relativePath: 'Asked', searchTerm: 'asked term', match: { ...ASKED }, inLibrary: false, hasActiveRequest: true, inMediaFolder: false },
  { ...base, index: 3, folderPath: '/downloads/Owned', folderName: 'Owned', relativePath: 'Owned', searchTerm: 'owned term', match: { ...OWNED }, inLibrary: true, hasActiveRequest: false, inMediaFolder: false },
  { ...base, index: 4, folderPath: '/media/Delivered', folderName: 'Delivered', relativePath: 'Delivered', searchTerm: 'delivered term', match: { asin: 'B0MDIA0001', title: 'Delivered Book', author: 'Media Author' }, inLibrary: false, hasActiveRequest: false, inMediaFolder: true },
];

const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

function sseResponse(rows: unknown[]) {
  const text = [
    ...rows.map((r) => `event: book_matched\ndata: ${JSON.stringify(r)}\n\n`),
    `event: complete\ndata: {}\n\n`,
  ].join('');
  let sent = false;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: new TextEncoder().encode(text) };
        },
      }),
    },
  };
}

let executeBody: { imports: { folderPath: string; asin: string; audioFiles: string[] }[] } | null;
let executeAnswer: (body: typeof executeBody) => Promise<unknown>;

function answer(url: string, init?: RequestInit) {
  if (url === '/api/admin/filesystem/browse') return json({ roots: [{ name: 'Downloads', path: '/downloads', icon: 'download' }] });
  if (url.startsWith('/api/admin/filesystem/browse?')) return json({ path: '/downloads', entries: [] });
  if (url === '/api/admin/bulk-import/scan') return sseResponse(ROWS);
  if (url.startsWith('/api/admin/bulk-import/match?')) {
    const q = new URL(url, 'http://x').searchParams.get('q');
    if (q === 'B0TYPD0001' || q === 'b0typd0001') return json({ kind: 'asin', asin: 'B0TYPD0001', store: 'audible.com', results: [TYPED] });
    if (q === 'B0MISS0001') return json({ kind: 'asin', asin: 'B0MISS0001', store: 'audible.com', results: [] });
    return json({ kind: 'search', asin: null, store: 'audible.com', results: [FREE, OWNED, ASKED] });
  }
  if (url === '/api/admin/bulk-import/execute') {
    executeBody = JSON.parse(String(init?.body));
    return executeAnswer(executeBody).then((b) => json(b));
  }
  return json({ error: 'unexpected' }, false);
}

const matchCalls = () => fetchWithAuthMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/bulk-import/match'));
const backdrop = () => document.body.querySelector<HTMLElement>('div.fixed.inset-0')!;
const rowOf = (name: string) => screen.getAllByTestId('bulk-import-row').find((r) => within(r).queryAllByText(name).length > 0)!;

async function openReview() {
  const { BulkImportWizard } = await import('@/components/admin/BulkImportWizard');
  const onClose = vi.fn();
  render(<BulkImportWizard isOpen onClose={onClose} />);
  await act(async () => {});
  fireEvent.click(screen.getByText('Downloads'));
  await act(async () => {});
  fireEvent.click(screen.getByText('Scan for Audiobooks'));
  await act(async () => {});
  await screen.findByText('Start Import');
  return { onClose };
}

async function pick(buttonName: string, resultTitle: string) {
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  await act(async () => {});
  // A No Match row does not search on open
  if (!screen.getByRole('status').textContent) {
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await act(async () => {});
  }
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(resultTitle) }));
  await act(async () => {});
}

describe('Bulk Import review: Change match / Find match', () => {
  beforeEach(() => {
    executeBody = null;
    executeAnswer = async (body) => ({ success: true, results: body!.imports.map((i) => ({ ...i, success: true, requestId: 'r' })), summary: { total: body!.imports.length, succeeded: body!.imports.length, failed: 0 } });
    fetchWithAuthMock.mockImplementation(async (url: string, init?: RequestInit) => answer(url, init));
  });

  it('offers Change match on matched and Requested rows, Find match on No Match rows, nothing on In Library or media-folder rows', async () => {
    await openReview();

    expect(screen.getByRole('button', { name: 'Change match for Wrong' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find match for Unknown' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change match for Asked' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /match for Owned/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /match for Delivered/ })).toBeNull();
  });

  it('a skipped row dims its cover and text, never Find match, Change match or Undo', async () => {
    await openReview();
    const findButton = screen.getByRole('button', { name: 'Find match for Unknown' });
    const body = within(rowOf('Unknown')).getByTestId('bulk-import-row-body');

    expect(body.className).toContain('opacity-40');
    expect(findButton.closest('[class*="opacity-40"]')).toBeNull();

    // A changed row the admin then skips: Undo and Change match stay at full strength too
    await pick('Change match for Asked', 'Free Pick');
    const changed = rowOf('Free Pick');
    fireEvent.click(within(changed).getByTitle('Click to skip this book'));
    expect(within(changed).getByTestId('bulk-import-row-body').className).toContain('opacity-40');
    expect(screen.getByRole('button', { name: 'Undo change for Asked' }).closest('[class*="opacity-40"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change match for Asked' }).closest('[class*="opacity-40"]')).toBeNull();
  });

  it('a matched row searches its scan term on open; disabled hits cannot be picked; a pick shows the book with Undo, and Undo restores the scan match', async () => {
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: 'Change match for Wrong' }));
    await act(async () => {});
    const dialog = screen.getByRole('dialog', { name: 'Change match' });
    expect(matchCalls()).toEqual(['/api/admin/bulk-import/match?q=wrong%20term']);
    expect(within(dialog).getByRole('status').textContent).toBe('3 results');
    expect((within(dialog).getByRole('button', { name: /Owned Book/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole('button', { name: /Asked Book/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText('In Library')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: /Free Pick/ }));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(rowOf('Free Pick')).getByText(/Pick Author/)).toBeTruthy();
    expect(screen.queryByText('Scan Guess')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change match for Wrong' }));

    fireEvent.click(screen.getByRole('button', { name: 'Undo change for Wrong' }));
    expect(screen.getByText('Scan Guess')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo change for Wrong' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change match for Wrong' }));
  });

  it('a No Match row waits for a search; a typed ASIN finds one book; an unknown ASIN says so with the store', async () => {
    await openReview();

    fireEvent.click(screen.getByRole('button', { name: 'Find match for Unknown' }));
    await act(async () => {});
    const dialog = screen.getByRole('dialog', { name: 'Find match' });
    const field = within(dialog).getByRole('searchbox') as HTMLInputElement;
    expect(matchCalls()).toEqual([]);
    expect(field.value).toBe('unknown term');
    expect(document.activeElement).toBe(field);
    expect(field.className).toContain('text-base');

    fireEvent.change(field, { target: { value: 'B0MISS0001' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Search' }));
    await act(async () => {});
    expect(within(dialog).getByRole('status').textContent).toBe('Nothing came back for B0MISS0001 from audible.com');

    fireEvent.change(field, { target: { value: 'b0typd0001' } });
    fireEvent.submit(field.closest('form')!);
    await act(async () => {});
    fireEvent.click(within(dialog).getByRole('button', { name: /Typed Pick/ }));
    await act(async () => {});

    const row = rowOf('Typed Pick');
    expect(within(row).queryByText('No Match')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Change match for Unknown' })).toBeTruthy();
    expect(within(row).getByTestId('bulk-import-row-body').className).not.toContain('opacity-40');
  });

  it('Esc and the close button close the dialog without a change', async () => {
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Find match for Unknown' }));
    await act(async () => {});
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Find match for Unknown' }));

    fireEvent.click(screen.getByRole('button', { name: 'Find match for Unknown' }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('No Match')).toBeTruthy();
  });

  it('Tab stays inside the dialog', async () => {
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Find match for Unknown' }));
    await act(async () => {});
    const close = screen.getByRole('button', { name: 'Close' });
    const search = screen.getByRole('button', { name: 'Search' });

    search.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(search);
  });

  it('a changed Requested row loses the badge, its toggle turns on, and it is imported with the picked ASIN', async () => {
    await openReview();
    expect(within(rowOf('Asked')).getByText('Requested')).toBeTruthy();

    await pick('Change match for Asked', 'Free Pick');

    const row = rowOf('Free Pick');
    expect(within(row).queryByText('Requested')).toBeNull();
    const toggle = within(row).getByTitle('Click to skip this book') as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);

    fireEvent.click(screen.getByText('Start Import'));
    await act(async () => {});
    expect(executeBody!.imports).toEqual([
      { folderPath: '/downloads/Wrong', asin: 'B0SCAN0001', audioFiles: ['01.m4b'] },
      { folderPath: '/downloads/Asked', asin: 'B0FREE0001', audioFiles: ['01.m4b'] },
      { folderPath: '/media/Delivered', asin: 'B0MDIA0001', audioFiles: ['01.m4b'] },
    ]);
  });

  describe('two rows for the same book', () => {
    const MARK = 'Same book as another row: change or skip one';
    const footer = () => screen.getByText(/to import/).textContent;

    it('marks both rows, says what to do, leaves them out of the count and the import, and lists them as not queued', async () => {
      await openReview();
      expect(footer()).toBe('2 books to import (3 skipped)');
      await pick('Find match for Unknown', 'Free Pick');
      expect(screen.queryAllByText(MARK)).toHaveLength(0);

      await pick('Change match for Wrong', 'Free Pick');

      expect(within(rowOf('Wrong')).getByText(MARK)).toBeTruthy();
      expect(within(rowOf('Unknown')).getByText(MARK)).toBeTruthy();
      expect(within(rowOf('Delivered')).queryByText(MARK)).toBeNull();
      expect(footer()).toBe('1 book to import (2 skipped)');

      fireEvent.click(screen.getByText('Start Import'));
      await act(async () => {});
      expect(executeBody!.imports.map((i) => i.folderPath)).toEqual(['/media/Delivered']);
      expect(screen.getByText('Import Started')).toBeTruthy();
      const list = screen.getByRole('list', { name: 'Books not queued' });
      expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'WrongSame book as another row', 'UnknownSame book as another row',
      ]);
      expect(screen.getByText('2 books could not be queued.')).toBeTruthy();
    });

    it('with only marked rows included, Start Import is disabled', async () => {
      await openReview();
      await pick('Find match for Unknown', 'Free Pick');
      await pick('Change match for Wrong', 'Free Pick');
      fireEvent.click(within(rowOf('Delivered')).getByTitle('Click to skip this book'));

      expect(footer()).toBe('0 books to import (3 skipped)');
      expect((screen.getByText('Start Import') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByText('Start Import'));
      await act(async () => {});
      expect(executeBody).toBeNull();
    });
  });

  it('the finished screen does not say Import Started when nothing was queued', async () => {
    executeAnswer = async (body) => ({
      success: true,
      results: body!.imports.map((i) => ({ ...i, success: false, error: 'Already requested' })),
      summary: { total: body!.imports.length, succeeded: 0, failed: body!.imports.length },
    });
    await openReview();

    fireEvent.click(screen.getByText('Start Import'));
    await act(async () => {});

    expect(screen.queryByText('Import Started')).toBeNull();
    expect(screen.getByText('Nothing Queued')).toBeTruthy();
    expect(screen.getByText('2 books could not be queued.')).toBeTruthy();
    expect(screen.queryByText(/Files will be organized/)).toBeNull();
  });

  it('the finished screen lists each refused row with its reason, matched by position', async () => {
    executeAnswer = async (body) => ({
      success: true,
      results: body!.imports.map((i, n) => (n === 1 ? { ...i, success: false, error: 'Already requested' } : { ...i, success: true, requestId: 'r' })),
      summary: { total: 3, succeeded: 2, failed: 1 },
    });
    await openReview();
    await pick('Change match for Asked', 'Free Pick');

    fireEvent.click(screen.getByText('Start Import'));
    await act(async () => {});

    expect(screen.getByText('1 book could not be queued.')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Books not queued' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['AskedAlready requested']);
  });

  it('controls are disabled while the import runs', async () => {
    let finish: (v: unknown) => void = () => {};
    executeAnswer = () => new Promise((resolve) => { finish = resolve; });
    await openReview();
    await pick('Change match for Asked', 'Free Pick');

    fireEvent.click(screen.getByText('Start Import'));
    await act(async () => {});

    expect((screen.getByRole('button', { name: 'Change match for Wrong' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Undo change for Asked' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ success: true, results: [], summary: { total: 0, succeeded: 0, failed: 0 } }));
  });

  describe('backdrop', () => {
    it('closes the wizard when nothing was changed', async () => {
      const { onClose } = await openReview();
      fireEvent.click(backdrop());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does nothing while the dialog is open', async () => {
      const { onClose } = await openReview();
      fireEvent.click(screen.getByRole('button', { name: 'Find match for Unknown' }));
      await act(async () => {});

      fireEvent.click(backdrop());

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('does nothing while a row is changed, and closes again after Undo', async () => {
      const { onClose } = await openReview();
      await pick('Change match for Wrong', 'Free Pick');

      fireEvent.click(backdrop());
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText('Free Pick')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Undo change for Wrong' }));
      fireEvent.click(backdrop());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes the wizard from the finished screen even when a row was changed', async () => {
      const { onClose } = await openReview();
      await pick('Change match for Wrong', 'Free Pick');
      fireEvent.click(screen.getByText('Start Import'));
      await act(async () => {});
      expect(screen.getByText('Import Started')).toBeTruthy();

      fireEvent.click(backdrop());
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
