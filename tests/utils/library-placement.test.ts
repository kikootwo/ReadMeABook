/**
 * Component: Library Placement Settings Tests
 * Documentation: documentation/features/library-placement.md
 */

import { describe, expect, it } from 'vitest';
import {
  LINK_NEEDS_MERGE_OFF,
  LINK_NEEDS_OPF_OR_NONE,
  effectiveLibrarySettings,
  metadataModeOf,
  parseFilePlacement,
  parseLinkFallbackNote,
  placementConflict,
  type FilePlacement,
} from '@/lib/utils/library-placement';

const ABS = 'audiobookshelf';

describe('parseFilePlacement', () => {
  it('reads the three values and treats anything else as copy', () => {
    expect(parseFilePlacement('copy')).toBe('copy');
    expect(parseFilePlacement('hardlink')).toBe('hardlink');
    expect(parseFilePlacement('hardlink_only')).toBe('hardlink_only');
    for (const other of [undefined, null, '', 'symlink', 'move', 'HARDLINK', 1]) {
      expect(parseFilePlacement(other)).toBe('copy');
    }
  });
});

describe('metadataModeOf', () => {
  it('maps the two keys, with tags winning when both are stored', () => {
    expect(metadataModeOf(true, false)).toBe('tags');
    expect(metadataModeOf(false, true)).toBe('opf');
    expect(metadataModeOf(false, false)).toBe('none');
    expect(metadataModeOf(true, true)).toBe('tags');
  });
});

describe('placementConflict', () => {
  const state = (placement: FilePlacement, tagging: boolean, merge: boolean, backendMode = ABS) =>
    placementConflict({ backendMode, placement, tagging, merge });

  it('refuses a hard link with tags or with chapter merge in Audiobookshelf mode', () => {
    for (const placement of ['hardlink', 'hardlink_only'] as const) {
      expect(state(placement, true, false)).toBe(LINK_NEEDS_OPF_OR_NONE);
      expect(state(placement, true, true)).toBe(LINK_NEEDS_OPF_OR_NONE);
      expect(state(placement, false, true)).toBe(LINK_NEEDS_MERGE_OFF);
      expect(state(placement, false, false)).toBeNull();
    }
  });

  it('never refuses copy', () => {
    expect(state('copy', true, true)).toBeNull();
  });

  it('is a no-op in Plex mode, where placement is hidden', () => {
    expect(state('hardlink', true, true, 'plex')).toBeNull();
    expect(state('hardlink_only', true, false, 'plex')).toBeNull();
  });
});

describe('effectiveLibrarySettings', () => {
  const run = (placement: FilePlacement, tagging: boolean, opf: boolean, backendMode = ABS) =>
    effectiveLibrarySettings({ backendMode, placement, tagging, opf });

  it('copy keeps the Metadata choice', () => {
    expect(run('copy', true, false)).toMatchObject({ placement: 'copy', tagging: true, opf: false, notes: [] });
    expect(run('copy', false, true)).toMatchObject({ placement: 'copy', tagging: false, opf: true });
    expect(run('copy', false, false)).toMatchObject({ placement: 'copy', tagging: false, opf: false });
    // Tags and OPF both stored read as Tags
    expect(run('copy', true, true)).toMatchObject({ tagging: true, opf: false });
  });

  it('a hard link with OPF or None links untagged', () => {
    expect(run('hardlink', false, true)).toMatchObject({ placement: 'hardlink', tagging: false, opf: true, notes: [] });
    expect(run('hardlink_only', false, false)).toMatchObject({ placement: 'hardlink_only', tagging: false, opf: false });
  });

  it('a stored hard link with Tags drops the tags with a note (imported as Metadata None)', () => {
    const effective = run('hardlink', true, true);
    expect(effective).toMatchObject({ placement: 'hardlink', tagging: false, opf: false });
    expect(effective.notes[0]).toContain('not written to linked books');
  });

  it('Plex mode always copies, tags per the tagging key, never an OPF', () => {
    expect(run('hardlink', true, true, 'plex')).toEqual({ placement: 'copy', tagging: true, opf: false, notes: [] });
    expect(run('hardlink_only', false, true, 'plex')).toEqual({ placement: 'copy', tagging: false, opf: false, notes: [] });
    // An unset backend mode is Plex (config.service default)
    expect(effectiveLibrarySettings({ backendMode: undefined, placement: 'hardlink', tagging: false, opf: true }))
      .toMatchObject({ placement: 'copy', opf: false });
  });

  it('Audiobookshelf -> Plex (tick tagging) -> Audiobookshelf stays deterministic', () => {
    // Stored in ABS mode: hard link + OPF
    let stored = { placement: 'hardlink' as FilePlacement, tagging: false, opf: true, merge: false };
    expect(placementConflict({ backendMode: ABS, ...stored })).toBeNull();
    // Plex mode: the tagging checkbox is ticked; nothing a Plex admin sees refuses it
    stored = { ...stored, tagging: true };
    expect(placementConflict({ backendMode: 'plex', ...stored })).toBeNull();
    expect(effectiveLibrarySettings({ backendMode: 'plex', ...stored })).toMatchObject({ placement: 'copy', tagging: true, opf: false });
    // Back in ABS mode: shown as Tags, refused until changed, imported linked without tags
    expect(metadataModeOf(stored.tagging, stored.opf)).toBe('tags');
    expect(placementConflict({ backendMode: ABS, ...stored })).toBe(LINK_NEEDS_OPF_OR_NONE);
    expect(effectiveLibrarySettings({ backendMode: ABS, ...stored })).toMatchObject({ placement: 'hardlink', tagging: false, opf: false });
  });
});

describe('parseLinkFallbackNote', () => {
  it('reads a stored note and ignores anything else', () => {
    const note = { title: 'A Book', reason: 'separate mounts (EXDEV)', at: '2026-11-10T12:00:00.000Z' };
    expect(parseLinkFallbackNote(JSON.stringify(note))).toEqual(note);
    expect(parseLinkFallbackNote(undefined)).toBeNull();
    expect(parseLinkFallbackNote('not json')).toBeNull();
    expect(parseLinkFallbackNote(JSON.stringify({ title: 1 }))).toBeNull();
  });
});
