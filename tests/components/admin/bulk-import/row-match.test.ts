/**
 * Component: Bulk Import review rows - effective match, Change match and Undo (pure helpers) tests
 * Documentation: documentation/features/bulk-import.md
 */

import { describe, expect, it } from 'vitest';
import {
  applyChosen, canChangeMatch, defaultSkipped, effectiveFlags, effectiveMatch, isImportable, matchLabel,
  sharedAsins, isSharedRow, toImportItem, undoChosen, formatDuration,
} from '@/components/admin/bulk-import/row-match';
import type { MatchCandidate, ScannedBook } from '@/components/admin/bulk-import/types';

const SCAN = { asin: 'B0SCAN0001', title: 'Scan Guess', author: 'Guess Author' };

function row(over: Partial<ScannedBook> = {}): ScannedBook {
  const base: ScannedBook = {
    index: 0, folderPath: '/downloads/Folder', folderName: 'Folder', relativePath: 'Folder', audioFileCount: 1,
    totalSizeBytes: 1, metadataSource: 'tags', searchTerm: 'folder', audioFiles: ['01.mp3'],
    match: SCAN, inLibrary: false, hasActiveRequest: false, skipped: false,
  };
  const book = { ...base, ...over };
  return { ...book, skipped: over.skipped ?? defaultSkipped(book) };
}

const candidate = (asin = 'B0PICK0001', flags: Partial<MatchCandidate> = {}): MatchCandidate => ({
  asin, title: 'Picked Title', author: 'Picked Author', narrator: 'Picked Narrator', coverArtUrl: 'http://img/p.jpg', durationMinutes: 300,
  inLibrary: false, hasActiveRequest: false, ...flags,
});

describe('canChangeMatch and matchLabel', () => {
  it.each([
    ['a matched row', row(), true, 'Change match'],
    ['a No Match row', row({ match: null }), true, 'Find match'],
    ['a Requested row', row({ hasActiveRequest: true }), true, 'Change match'],
    ['an In Library row', row({ inLibrary: true }), false, 'Change match'],
    ['a media-folder row', row({ inMediaFolder: true }), false, 'Change match'],
    ['a media-folder No Match row', row({ match: null, inMediaFolder: true }), false, 'Find match'],
  ])('%s', (_label, book, eligible, label) => {
    expect(canChangeMatch(book)).toBe(eligible);
    expect(matchLabel(book)).toBe(label);
  });
});

describe('applyChosen and undoChosen', () => {
  it('a No Match row (pre-skipped) takes the picked book and is included', () => {
    const before = row({ match: null });
    expect(before.skipped).toBe(true);

    const after = applyChosen(before, candidate());

    expect(after.chosen).toEqual({ match: { asin: 'B0PICK0001', title: 'Picked Title', author: 'Picked Author', narrator: 'Picked Narrator', coverArtUrl: 'http://img/p.jpg', durationMinutes: 300 } });
    expect(after.match).toBeNull();
    expect(after.skipped).toBe(false);
    expect(effectiveMatch(after)?.asin).toBe('B0PICK0001');
    expect(matchLabel(after)).toBe('Change match');
    expect(isImportable(after)).toBe(true);
  });

  it('a Requested row follows the picked book: no flags, included; Undo brings the flags and the skip back', () => {
    const requested = row({ hasActiveRequest: true });
    expect(requested.skipped).toBe(true);

    const changed = applyChosen(requested, candidate());
    expect(effectiveFlags(changed)).toEqual({ inLibrary: false, hasActiveRequest: false });
    expect(changed.skipped).toBe(false);

    const undone = undoChosen(changed);
    expect(undone.chosen).toBeUndefined();
    expect(effectiveFlags(undone)).toEqual({ inLibrary: false, hasActiveRequest: true });
    expect(undone.skipped).toBe(true);
    expect(isImportable(undone)).toBe(false);
  });

  it('Undo restores the scan match and the default skip of a matched row', () => {
    const undone = undoChosen(applyChosen(row({ skipped: true }), candidate()));
    expect(effectiveMatch(undone)).toEqual(SCAN);
    expect(undone.skipped).toBe(false);
  });

  it('picking the scan\'s own book (any case) is no change', () => {
    const after = applyChosen(applyChosen(row(), candidate()), candidate('b0scan0001'));
    expect(after.chosen).toBeUndefined();
    expect(effectiveMatch(after)).toEqual(SCAN);
  });
});

describe('toImportItem', () => {
  it('sends the picked ASIN (never the scan guess) and no extra fields', () => {
    expect(toImportItem(applyChosen(row(), candidate()))).toEqual({ folderPath: '/downloads/Folder', asin: 'B0PICK0001', audioFiles: ['01.mp3'] });
    expect(toImportItem(row())).toEqual({ folderPath: '/downloads/Folder', asin: 'B0SCAN0001', audioFiles: ['01.mp3'] });
  });
});

describe('sharedAsins', () => {
  it('marks included rows that share an effective ASIN, ignoring skipped rows', () => {
    const a = row({ index: 0 });
    const b = applyChosen(row({ index: 1, match: null }), candidate('b0scan0001'));
    const c = row({ index: 2, match: { ...SCAN, asin: 'B0OTHER001' } });
    const skipped = row({ index: 3, skipped: true, match: { ...SCAN, asin: 'B0OTHER001' } });

    const shared = sharedAsins([a, b, c, skipped]);

    expect([...shared]).toEqual(['B0SCAN0001']);
    expect([a, b, c, skipped].map((x) => isSharedRow(x, shared))).toEqual([true, true, false, false]);
  });
});

describe('formatDuration', () => {
  it.each([[undefined, ''], [0, ''], [45, '45m'], [485, '8h 5m']])('%s -> "%s"', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});
