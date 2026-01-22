/**
 * Component: BookDate Book Picker Modal Tests
 * Documentation: documentation/features/bookdate.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const books = [
  { id: 'book-1', title: 'First Book', author: 'Author One', coverUrl: null },
  { id: 'book-2', title: 'Second Book', author: 'Author Two', coverUrl: null },
];

describe('BookPickerModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('loads books and confirms the selection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ books }),
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('accessToken', 'token-123');
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { BookPickerModal } = await import('@/components/bookdate/BookPickerModal');

    render(
      <BookPickerModal
        isOpen={true}
        onClose={onClose}
        selectedIds={[]}
        onConfirm={onConfirm}
        maxSelection={5}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/bookdate/library', {
        headers: { Authorization: 'Bearer token-123' },
      });
    });

    const firstBookButton = await screen.findByRole('button', { name: /First Book/ });
    fireEvent.click(firstBookButton);

    fireEvent.click(screen.getByRole('button', { name: /Confirm Selection/ }));

    expect(onConfirm).toHaveBeenCalledWith(['book-1']);
    expect(onClose).toHaveBeenCalled();
  });

  it('disables additional selections once the max is reached', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ books }),
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('accessToken', 'token-456');
    const { BookPickerModal } = await import('@/components/bookdate/BookPickerModal');

    render(
      <BookPickerModal
        isOpen={true}
        onClose={vi.fn()}
        selectedIds={[]}
        onConfirm={vi.fn()}
        maxSelection={1}
      />
    );

    const firstBookButton = await screen.findByRole('button', { name: /First Book/ });
    fireEvent.click(firstBookButton);

    expect(screen.getByText(/Maximum reached/)).toBeInTheDocument();

    const secondBookButton = screen.getByRole('button', { name: /Second Book/ });
    expect(secondBookButton).toBeDisabled();
  });

  it('shows an error when loading books fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { BookPickerModal } = await import('@/components/bookdate/BookPickerModal');

    render(
      <BookPickerModal
        isOpen={true}
        onClose={vi.fn()}
        selectedIds={[]}
        onConfirm={vi.fn()}
        maxSelection={5}
      />
    );

    expect(await screen.findByText('Failed to load library books')).toBeInTheDocument();
  });

  it('shows an empty search state when no books match', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ books }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { BookPickerModal } = await import('@/components/bookdate/BookPickerModal');

    render(
      <BookPickerModal
        isOpen={true}
        onClose={vi.fn()}
        selectedIds={[]}
        onConfirm={vi.fn()}
        maxSelection={5}
      />
    );

    await screen.findByRole('button', { name: /First Book/ });

    fireEvent.change(screen.getByPlaceholderText('Search books...'), { target: { value: 'missing' } });

    expect(screen.getByText('No books match your search')).toBeInTheDocument();
  });

  it('clears selection and disables confirm', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ books }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { BookPickerModal } = await import('@/components/bookdate/BookPickerModal');

    render(
      <BookPickerModal
        isOpen={true}
        onClose={vi.fn()}
        selectedIds={['book-1']}
        onConfirm={vi.fn()}
        maxSelection={5}
      />
    );

    await screen.findByRole('button', { name: /First Book/ });

    const clearButton = screen.getByRole('button', { name: 'Clear Selection' });
    fireEvent.click(clearButton);

    expect(screen.getByRole('button', { name: /Confirm Selection/ })).toBeDisabled();
  });
});
