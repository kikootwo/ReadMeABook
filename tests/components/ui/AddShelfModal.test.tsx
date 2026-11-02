/**
 * Component: Add Shelf Modal Tests (Goodreads feeds ended notice, #514)
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * The Goodreads tab says the feeds are gone before the user submits; the Hardcover tab does not.
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Plain holder: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({ goodreadsError: null as string | null }));

vi.mock('@/lib/hooks/useGoodreadsShelves', () => ({
  useAddGoodreadsShelf: () => ({ addShelf: async () => ({}), isLoading: false, error: state.goodreadsError }),
}));
vi.mock('@/lib/hooks/useHardcoverShelves', () => ({
  useAddHardcoverShelf: () => ({ addShelf: async () => ({}), isLoading: false, error: null }),
}));
vi.mock('@/components/ui/HardcoverForm', () => ({ HardcoverForm: () => null }));

import { AddShelfModal } from '@/components/ui/AddShelfModal';
import { GOODREADS_FEEDS_ENDED_ADD_MESSAGE } from '@/lib/utils/goodreads-rss-url';

describe('AddShelfModal', () => {
  it('says Goodreads feeds are gone on the Goodreads tab, before submitting, and not on Hardcover', () => {
    state.goodreadsError = null;
    render(<AddShelfModal isOpen onClose={() => {}} />);

    expect(screen.getByRole('note')).toHaveTextContent(GOODREADS_FEEDS_ENDED_ADD_MESSAGE);

    fireEvent.click(screen.getByRole('button', { name: 'Hardcover' }));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Goodreads' }));
    expect(screen.getByRole('note')).toHaveTextContent(GOODREADS_FEEDS_ENDED_ADD_MESSAGE);
  });

  it('shows the message once when the add itself fails with it', () => {
    state.goodreadsError = GOODREADS_FEEDS_ENDED_ADD_MESSAGE;
    render(<AddShelfModal isOpen onClose={() => {}} />);

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getAllByText(GOODREADS_FEEDS_ENDED_ADD_MESSAGE)).toHaveLength(1);
  });
});
