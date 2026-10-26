/**
 * Component: Watch Mode Control Tests (Profile watched lists)
 * Documentation: documentation/features/watched-lists.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plain holders: the config's mockReset clears vi.fn implementations per test
const calls = vi.hoisted(() => ({ author: [] as unknown[][], series: [] as unknown[][] }));

vi.mock('@/lib/hooks/useWatchedAuthors', () => ({
  useUpdateWatchedAuthor: () => ({ setNewReleasesOnly: async (...args: unknown[]) => { calls.author.push(args); }, isLoading: false }),
}));
vi.mock('@/lib/hooks/useWatchedSeries', () => ({
  useUpdateWatchedSeries: () => ({ setNewReleasesOnly: async (...args: unknown[]) => { calls.series.push(args); }, isLoading: false }),
}));

import { WatchModeControl } from '@/components/profile/WatchModeControl';

const SINCE = '2026-10-26T18:00:00.000Z';
const BACKLOG = /The next daily check requests every book by "Quillon Varrow" that isn't in your library/;

beforeEach(() => {
  calls.author = [];
  calls.series = [];
});

describe('WatchModeControl', () => {
  it('switching a new-only watch back to the entire catalog warns about the backlog, then saves', async () => {
    render(<WatchModeControl kind="author" id="wa-1" name="Quillon Varrow" newReleasesOnly newReleasesSince={SINCE} />);
    expect(screen.getByText(/^New releases since /)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Change what is requested/ }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.queryByText(BACKLOG)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Entire catalog/ }));
    const warning = screen.getByText(BACKLOG);
    expect(warning.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(calls.author).toEqual([['wa-1', false]]);
  });

  it('switching an entire-catalog watch to new-only shows no backlog warning and saves', async () => {
    render(<WatchModeControl kind="series" id="ws-1" name="The Glass Orchard" newReleasesOnly={false} newReleasesSince={null} />);
    expect(screen.getByText('Entire catalog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Change what is requested/ }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /New releases only/ }));
    expect(screen.queryByText(/The next daily check/)).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(calls.series).toEqual([['ws-1', true]]);
  });
});
