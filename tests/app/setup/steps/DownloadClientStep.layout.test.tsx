/**
 * Component: Setup Download Client Step: Add Download Client card layout and intro text (#581)
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadClientStep } from '@/app/setup/steps/DownloadClientStep';
import { DownloadClientManagement } from '@/components/admin/download-clients/DownloadClientManagement';
import { CLIENT_DISPLAY_NAMES } from '@/lib/interfaces/download-client.interface';

const CLIENT_NAMES = Object.values(CLIENT_DISPLAY_NAMES);

const renderStep = () =>
  render(<DownloadClientStep downloadClients={[]} onUpdate={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} />);

/** The grid that holds the Add Download Client cards */
const addCardGrid = () => {
  const grid = screen.getByRole('heading', { name: 'Add Download Client' }).nextElementSibling as HTMLElement;
  expect(grid.className).toMatch(/\bgrid\b/);
  return grid;
};

/** jsdom has no layout, so the rule is pinned by class: the grid caps at three columns */
const expectAtMostThreeColumns = (grid: HTMLElement) => {
  const classes = grid.className.split(/\s+/);
  expect(classes).toEqual(expect.arrayContaining(['grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3']));
  expect(classes.filter((c) => /grid-cols-(?:[4-9]|\d{2,})$/.test(c))).toEqual([]);
};

/**
 * Each card's name and badge share one row that wraps the badge below the name only when it can't fit;
 * the name block grows from a zero basis, so its description wraps before the badge does
 */
const expectWrappingHeaders = () => {
  for (const name of CLIENT_NAMES) {
    const heading = screen.getByRole('heading', { level: 4, name });
    expect(heading.parentElement!.className.split(/\s+/), name).toContain('flex-1');
    const row = heading.parentElement!.parentElement as HTMLElement;
    const badge = row.querySelector(':scope > span') as HTMLElement;
    expect(badge?.textContent, name).toMatch(/^(Torrent|Usenet)$/);
    expect(row.className.split(/\s+/), name).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'gap-x-2']));
  }
};

describe('Add Download Client cards (#581)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ clients: [] }), { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wizard: five cards in a grid of at most three columns, badges wrap instead of overlapping', () => {
    renderStep();
    const grid = addCardGrid();
    expect(grid.children).toHaveLength(CLIENT_NAMES.length);
    expectAtMostThreeColumns(grid);
    expectWrappingHeaders();
  });

  it('settings: the same grid and card rows', async () => {
    render(<DownloadClientManagement mode="settings" />);
    await waitFor(() => expect(screen.getByText('No download clients configured yet')).toBeInTheDocument());
    expectAtMostThreeColumns(addCardGrid());
    expectWrappingHeaders();
  });

  it('the intro names every supported client by protocol', () => {
    renderStep();
    const intro = screen.getByText(/^Add at least one download client\./);
    expect(intro.textContent).toContain(
      'a torrent client (qBittorrent, Transmission, or Deluge) and/or a usenet client (SABnzbd or NZBGet)'
    );
    for (const name of CLIENT_NAMES) expect(intro.textContent, name).toContain(name);
  });
});
