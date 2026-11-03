/**
 * Component: Shelves Section Tests (Goodreads feeds ended notice, #514)
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Goodreads no longer serves shelf RSS feeds, so every Goodreads shelf card says so, in a
 * full-width row, with a neutral sync status. Hardcover cards do not change.
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GenericShelf } from '@/lib/hooks/useShelves';

// Plain holder: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({ shelves: [] as GenericShelf[] }));

vi.mock('@/lib/hooks/useShelves', () => ({
  useShelves: () => ({ shelves: state.shelves, isLoading: false }),
  useSyncShelves: () => ({ syncShelves: async () => {}, isSyncing: false }),
}));
vi.mock('@/lib/hooks/useGoodreadsShelves', () => ({
  useDeleteGoodreadsShelf: () => ({ deleteShelf: async () => {}, isLoading: false }),
  useUpdateGoodreadsShelf: () => ({ updateShelf: async () => {} }),
}));
vi.mock('@/lib/hooks/useHardcoverShelves', () => ({
  useDeleteHardcoverShelf: () => ({ deleteShelf: async () => {}, isLoading: false }),
  useUpdateHardcoverShelf: () => ({ updateShelf: async () => {} }),
}));
vi.mock('@/contexts/PreferencesContext', () => ({ usePreferences: () => ({ squareCovers: false }) }));
vi.mock('@/components/ui/AddShelfModal', () => ({ AddShelfModal: () => null }));
vi.mock('@/components/ui/ManageShelfModal', () => ({ ManageShelfModal: () => null }));
vi.mock('@/components/audiobooks/AudiobookDetailsModal', () => ({ AudiobookDetailsModal: () => null }));

import { ShelvesSection } from '@/components/profile/ShelvesSection';

const SYNCED = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const NOTICE = /^Goodreads no longer serves shelf RSS feeds, so this shelf has stopped syncing/;

const shelf = (
  id: string, type: GenericShelf['type'], name: string, lastSyncAt: string | null = SYNCED,
): GenericShelf => ({
  id, type, name, sourceId: id, lastSyncAt, createdAt: SYNCED, bookCount: 12, autoRequest: true, books: [],
});

const card = (name: string) => screen.getByRole('heading', { name: new RegExp(`^${name} `) }).closest('.group') as HTMLElement;

describe('ShelvesSection', () => {
  it('shows the feeds-ended notice on every Goodreads shelf and on no Hardcover list', () => {
    state.shelves = [
      shelf('g1', 'goodreads', 'Read'),
      shelf('h1', 'hardcover', 'Want to Read'),
      shelf('g2', 'goodreads', 'Currently Reading'),
    ];
    render(<ShelvesSection />);

    expect(screen.getAllByRole('note')).toHaveLength(2);
    expect(within(card('Read')).getByRole('note')).toHaveTextContent(NOTICE);
    expect(within(card('Currently Reading')).getByRole('note')).toHaveTextContent(NOTICE);
    expect(within(card('Want to Read')).queryByRole('note')).not.toBeInTheDocument();
  });

  it('shows no notice when only Hardcover lists are connected', () => {
    state.shelves = [shelf('h1', 'hardcover', 'Want to Read')];
    render(<ShelvesSection />);

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.queryByText(/Goodreads no longer serves/)).not.toBeInTheDocument();
  });

  it('puts the notice in its own row of the card, not in the info column beside the actions', () => {
    state.shelves = [shelf('g1', 'goodreads', 'Read')];
    render(<ShelvesSection />);

    const goodreadsCard = card('Read');
    const infoColumn = screen.getByRole('heading', { name: /^Read / }).parentElement as HTMLElement;
    const note = within(goodreadsCard).getByRole('note');
    expect(infoColumn.contains(note)).toBe(false);
    expect(note.parentElement).toBe(goodreadsCard);
  });

  it('gives Goodreads shelves a neutral status: no green dot, no endless "Syncing" pulse', () => {
    state.shelves = [shelf('g1', 'goodreads', 'Read'), shelf('g2', 'goodreads', 'To Read', null)];
    render(<ShelvesSection />);

    const synced = card('Read');
    expect(within(synced).getByText(/Synced 3d ago/)).toBeInTheDocument();
    expect(synced.querySelector('.rounded-full.bg-gray-300')).not.toBeNull();
    expect(synced.querySelector('.bg-emerald-500')).toBeNull();

    const neverSynced = card('To Read');
    expect(within(neverSynced).queryByText(/Syncing/)).not.toBeInTheDocument();
    expect(within(neverSynced).getByText(/Never synced/)).toBeInTheDocument();
    expect(neverSynced.querySelector('.bg-emerald-500')).toBeNull();
    expect(neverSynced.querySelector('.animate-ping, .animate-pulse')).toBeNull();
  });

  it('keeps the Hardcover status as it was: green when synced, "Syncing" before the first sync', () => {
    state.shelves = [shelf('h1', 'hardcover', 'Want to Read'), shelf('h2', 'hardcover', 'Owned', null)];
    render(<ShelvesSection />);

    const synced = card('Want to Read');
    expect(within(synced).getByText(/Synced 3d ago/)).toBeInTheDocument();
    expect(synced.querySelector('.bg-emerald-500')).not.toBeNull();
    const pending = card('Owned');
    expect(within(pending).getByText(/Syncing/)).toBeInTheDocument();
    expect(pending.querySelector('.animate-ping')).not.toBeNull();
  });
});
