/**
 * Component: Watch Mode Control Tests (Profile watched lists)
 * Documentation: documentation/features/watched-lists.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Plain holders: the config's mockReset clears vi.fn implementations per test
const calls = vi.hoisted(() => ({ author: [] as unknown[][], series: [] as unknown[][], fail: false }));

vi.mock('@/lib/hooks/useWatchedAuthors', () => ({
  useUpdateWatchedAuthor: () => ({
    setNewReleasesOnly: async (...args: unknown[]) => {
      if (calls.fail) throw new Error('Could not save');
      calls.author.push(args);
    },
    isLoading: false,
  }),
}));
vi.mock('@/lib/hooks/useWatchedSeries', () => ({
  useUpdateWatchedSeries: () => ({ setNewReleasesOnly: async (...args: unknown[]) => { calls.series.push(args); }, isLoading: false }),
}));

import { WatchModeControl } from '@/components/profile/WatchModeControl';

const SINCE = '2026-10-26T18:00:00.000Z';
const BACKLOG = /The next watched-list check requests every book by "Quillon Varrow" that isn't in your library/;

const TZ = process.env.TZ;

beforeEach(() => {
  calls.author = [];
  calls.series = [];
  calls.fail = false;
});

afterEach(() => {
  process.env.TZ = TZ;
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
    expect(screen.queryByText(/The next watched-list check/)).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(calls.series).toEqual([['ws-1', true]]);
  });

  it('shows the cutoff as its UTC day, the day the release check uses', () => {
    process.env.TZ = 'America/New_York';
    render(<WatchModeControl kind="author" id="wa-1" name="Quillon Varrow" newReleasesOnly newReleasesSince="2026-10-27T01:00:00.000Z" />);
    const oct27 = new Date('2026-10-27T12:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    expect(screen.getByText(`New releases since ${oct27}`)).toBeInTheDocument();
  });

  it('announces a failed save and keeps the dialog open', async () => {
    calls.fail = true;
    render(<WatchModeControl kind="author" id="wa-1" name="Quillon Varrow" newReleasesOnly newReleasesSince={SINCE} />);
    fireEvent.click(screen.getByRole('button', { name: /Change what is requested/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Entire catalog/ }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('keeps the selected option tinted on hover: only unselected options get a hover background', () => {
    render(<WatchModeControl kind="series" id="ws-1" name="The Glass Orchard" newReleasesOnly={false} newReleasesSince={null} />);
    fireEvent.click(screen.getByRole('button', { name: /Change what is requested/ }));
    const card = (name: RegExp) => screen.getByRole('radio', { name }).closest('label')!;
    expect(card(/Entire catalog/).className).not.toMatch(/hover:bg-/);
    expect(card(/New releases only/).className).toMatch(/hover:bg-gray-50/);
  });
});
