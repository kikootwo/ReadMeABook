/**
 * Component: Watch Button Tests (Entire catalog / New releases only choice)
 * Documentation: documentation/features/watched-lists.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plain holders: the config's mockReset clears vi.fn implementations per test
const calls = vi.hoisted(() => ({ addAuthor: [] as unknown[][], addSeries: [] as unknown[][] }));

vi.mock('@/lib/hooks/useWatchedAuthors', () => ({
  useWatchedAuthors: () => ({ authors: [] }),
  useAddWatchedAuthor: () => ({ addAuthor: async (...args: unknown[]) => { calls.addAuthor.push(args); }, isLoading: false }),
  useDeleteWatchedAuthor: () => ({ deleteAuthor: async () => true, isLoading: false }),
}));
vi.mock('@/lib/hooks/useWatchedSeries', () => ({
  useWatchedSeries: () => ({ series: [] }),
  useAddWatchedSeries: () => ({ addSeries: async (...args: unknown[]) => { calls.addSeries.push(args); }, isLoading: false }),
  useDeleteWatchedSeries: () => ({ deleteSeries: async () => true, isLoading: false }),
}));

import { WatchAuthorButton, WatchSeriesButton } from '@/components/ui/WatchButton';

beforeEach(() => {
  calls.addAuthor = [];
  calls.addSeries = [];
});

describe('Watch confirm dialog', () => {
  it('preselects (and focuses) Entire catalog, and watches with it', async () => {
    render(<WatchAuthorButton authorAsin="B0AUTHOR01" authorName="Quillon Varrow" coverArtUrl="https://x/c.jpg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Author' }));

    const entire = screen.getByRole('radio', { name: /Entire catalog/ });
    expect(entire).toBeChecked();
    expect(entire).toHaveFocus();
    expect(screen.getByRole('radio', { name: /New releases only/ })).not.toBeChecked();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Watch' })); });
    expect(calls.addAuthor).toEqual([['B0AUTHOR01', 'Quillon Varrow', 'https://x/c.jpg', false]]);
  });

  it('watches new releases only when that option is picked', async () => {
    render(<WatchSeriesButton seriesAsin="B0SERIES01" seriesTitle="The Glass Orchard" />);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Series' }));
    fireEvent.click(screen.getByRole('radio', { name: /New releases only/ }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Watch' })); });
    expect(calls.addSeries).toEqual([['B0SERIES01', 'The Glass Orchard', undefined, true]]);
  });

  it('shows both options as one named radio group with their descriptions', () => {
    render(<WatchSeriesButton seriesAsin="B0SERIES01" seriesTitle="The Glass Orchard" />);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Series' }));

    const group = screen.getByRole('group', { name: 'What should be requested?' });
    const radios = screen.getAllByRole('radio');
    expect(group).toContainElement(radios[0]);
    expect(radios).toHaveLength(2);
    expect(radios[0].getAttribute('name')).toBe(radios[1].getAttribute('name'));
    expect(screen.getByText(/Request every book in "The Glass Orchard" that isn't in your library/)).toBeInTheDocument();
    expect(screen.getByText("Request only books released from today on. Older books aren't requested.")).toBeInTheDocument();
  });

  it('starts at Entire catalog again each time the dialog opens', () => {
    render(<WatchAuthorButton authorAsin="B0AUTHOR01" authorName="Quillon Varrow" />);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Author' }));
    fireEvent.click(screen.getByRole('radio', { name: /New releases only/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Watch Author' }));
    expect(screen.getByRole('radio', { name: /Entire catalog/ })).toBeChecked();
  });
});
