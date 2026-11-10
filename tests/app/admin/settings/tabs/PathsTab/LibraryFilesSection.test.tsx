/**
 * Component: Paths Tab - Library Files (File placement + Metadata) Tests
 * Documentation: documentation/features/library-placement.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PathsSettings } from '@/app/admin/settings/lib/types';

vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: vi.fn() }));

import { PathsTab } from '@/app/admin/settings/tabs/PathsTab/PathsTab';
import { pathsPlacementConflict } from '@/app/admin/settings/lib/helpers';

const BASE: PathsSettings = {
  downloadDir: '/downloads',
  mediaDir: '/media/audiobooks',
  metadataTaggingEnabled: true,
  plexFormatCoercionEnabled: true,
  chapterMergingEnabled: false,
  fileRenameEnabled: false,
  filePlacement: 'copy',
  metadataOpfEnabled: false,
  linkFallbackLast: null,
};

/** The last paths the tab handed to onChange (or the initial ones). */
const seen: { paths: PathsSettings } = { paths: BASE };
function Harness({ initial, backendMode }: { initial: PathsSettings; backendMode: 'plex' | 'audiobookshelf' }) {
  const [paths, setPaths] = useState(initial);
  return <PathsTab paths={paths} backendMode={backendMode} onChange={(p) => { seen.paths = p; setPaths(p); }} onValidationChange={() => undefined} />;
}
const renderTab = (initial: PathsSettings, backendMode: 'plex' | 'audiobookshelf') => {
  seen.paths = initial;
  return render(<Harness initial={initial} backendMode={backendMode} />);
};

const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement;
const merge = () => screen.getByRole('checkbox', { name: /Auto-merge chapters to M4B/ }) as HTMLInputElement;
const conflict = (paths: PathsSettings, backendMode: 'plex' | 'audiobookshelf') =>
  pathsPlacementConflict({ backendMode, paths } as Parameters<typeof pathsPlacementConflict>[0]);

describe('PathsTab Library files', () => {
  it('Audiobookshelf mode shows both settings with the exact words, and replaces the tagging checkbox', () => {
    renderTab(BASE, 'audiobookshelf');
    expect(screen.getByText('Library files')).toBeTruthy();
    for (const label of ['Copy', 'Hard link (copy if not possible)', "Hard link only (don't import if not possible)",
      'Tags in the audio files', 'OPF file (metadata.opf)', 'None (leave files as they are)']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy();
    }
    expect(screen.queryByLabelText(/Auto-tag audio files with metadata/)).toBeNull();
    expect(screen.getAllByRole('checkbox', { name: /Auto-merge chapters/ })).toHaveLength(1);
  });

  it('Plex mode is unchanged: no Library files, the tagging and merge checkboxes stay', () => {
    renderTab({ ...BASE, filePlacement: 'hardlink', metadataOpfEnabled: true }, 'plex');
    expect(screen.queryByText('Library files')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    const tagging = screen.getByLabelText(/Auto-tag audio files with metadata/) as HTMLInputElement;
    expect(tagging.disabled).toBe(false);
    expect(merge().disabled).toBe(false);
  });

  it('guards both ways: hard links disabled while Tags or merge is on; Tags and merge disabled while linking', () => {
    renderTab(BASE, 'audiobookshelf');
    expect(radio(/^Hard link \(copy/).disabled).toBe(true);
    expect(radio(/^Hard link only/).disabled).toBe(true);
    expect(screen.getByText('Needs Metadata: OPF file or None, and chapter merge off.')).toBeTruthy();

    fireEvent.click(radio(/^OPF file/));
    expect(seen.paths).toMatchObject({ metadataTaggingEnabled: false, metadataOpfEnabled: true });
    expect(radio(/^Hard link \(copy/).disabled).toBe(false);

    fireEvent.click(radio(/^Hard link \(copy/));
    expect(seen.paths.filePlacement).toBe('hardlink');
    expect(radio(/^Tags in the audio files/).disabled).toBe(true);
    expect(merge().disabled).toBe(true);
    expect(screen.getByText(/Don't use Audiobookshelf's Embed Metadata on linked books: it changes the download too, and the download client may later undo it\./)).toBeTruthy();
    expect(conflict(seen.paths, 'audiobookshelf')).toBeNull();

    fireEvent.click(radio(/^None/));
    expect(seen.paths).toMatchObject({ metadataTaggingEnabled: false, metadataOpfEnabled: false });
  });

  it('merge on disables the hard links too', () => {
    renderTab({ ...BASE, metadataTaggingEnabled: false, chapterMergingEnabled: true }, 'audiobookshelf');
    expect(radio(/^Hard link only/).disabled).toBe(true);
    fireEvent.click(merge());
    expect(radio(/^Hard link only/).disabled).toBe(false);
  });

  it('a stored conflict (after ticking tagging in Plex mode) shows as stored, explains itself and blocks the save', () => {
    const stored = { ...BASE, filePlacement: 'hardlink' as const, metadataTaggingEnabled: true, metadataOpfEnabled: true };
    expect(conflict(stored, 'plex')).toBeNull();
    renderTab(stored, 'audiobookshelf');
    expect(radio(/^Hard link \(copy/).checked).toBe(true);
    expect(radio(/^Tags in the audio files/).checked).toBe(true);
    expect(radio(/^OPF file/).checked).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('Needs Metadata: OPF file or None, and chapter merge off.');
    expect(conflict(seen.paths, 'audiobookshelf')).toBe('Hard links need Metadata set to OPF file or None.');
    fireEvent.click(radio(/^OPF file/));
    expect(conflict(seen.paths, 'audiobookshelf')).toBeNull();
  });

  it('shows the last copy fallback while a hard link is selected', () => {
    const linkFallbackLast = { title: 'A Book', reason: 'the download and library folders are separate mounts (EXDEV)', at: '2026-11-10T12:00:00.000Z' };
    renderTab({ ...BASE, metadataTaggingEnabled: false, filePlacement: 'hardlink', linkFallbackLast }, 'audiobookshelf');
    expect(screen.getByTestId('link-fallback-last').textContent).toMatch(
      /^Last book copied instead of linked: A Book \(the download and library folders are separate mounts \(EXDEV\)\), /
    );
  });
});
