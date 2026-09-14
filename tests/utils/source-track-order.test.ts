/**
 * Component: Source Folder Track Ordering Tests
 * Documentation: documentation/features/source-track-order.md
 */
import { describe, expect, it } from 'vitest';
import { resolveSourceTrackOrder, sourceOrderedFilename } from '@/lib/utils/source-track-order';

const files = (names: string[]) => names.map(path => ({ path: `/book/${path}` }));
const order = (names: string[]) => resolveSourceTrackOrder(files(names));

describe('source track ordering', () => {
  it('leaves single-folder imports unchanged even with unreliable tags', () => {
    expect(resolveSourceTrackOrder(files(['02.mp3', '01.mp3']).map(f => ({ ...f, trackNumber: 1 })))).toBeNull();
    expect(order([])).toBeNull();
  });
  it('orders every Morning Star-style file, including the unique last file of part one', () => {
    const names = ['Part 3/002.mp3', 'Part 1-2/034.mp3', 'Part 3/001.mp3',
      ...Array.from({ length: 33 }, (_, i) => `Part 1-2/${String(i + 1).padStart(3, '0')}.mp3`)];
    const ordered = order(names)!;
    expect(ordered[33].path).toBe('/book/Part 1-2/034.mp3');
    expect(ordered[34].path).toBe('/book/Part 3/001.mp3');
    expect(ordered[34].sourcePosition).toEqual({ disc: 2, track: 1 });
    expect(ordered).toEqual(order([...names].reverse()));
  });
  it('orders the full Morning Star release folder names and all 67 tagged tracks', () => {
    const title = 'Morning Star Book III of the Red Rising Trilogy (Unabridged)';
    const input = [34, 33].flatMap((count, disc) => Array.from({ length: count }, (_, i) => ({
      path: `/book/Pierce Brown - ${title} Part ${disc === 0 ? '1-2' : '3'}/${title} - ${String(i + 1).padStart(3, '0')}.mp3`,
      trackNumber: i + 1,
    })));
    const result = resolveSourceTrackOrder([...input].reverse())!;
    expect(result.map(file => file.path)).toEqual(input.map(file => file.path));
    expect(result[33].sourcePosition).toEqual({ disc: 1, track: 34 });
    expect(result[34].sourcePosition).toEqual({ disc: 2, track: 1 });
  });
  it.each(['CD', 'Disc', 'Disk', 'Part'])('recognizes trailing %s labels after a shared numeric book title', label => {
    expect(order([`1984 - ${label} 2/01.mp3`, `1984 - ${label} 1/01.mp3`])!.map(f => f.sourcePosition.disc)).toEqual([1, 2]);
  });
  it.each([
    ['Different Book Part 1/01.mp3', 'Another Book Part 2/01.mp3'],
    ['Book Part 1 extras/01.mp3', 'Book Part 2 extras/01.mp3'],
    ['Book 1/01.mp3', 'Book 2/01.mp3'],
    ['Book Part 1-2/01.mp3', 'Book Part 2/01.mp3'],
    ['Book Part 1/01.mp3', 'Book Part 3/01.mp3'],
  ])('does not infer ambiguous trailing labels %j', (...names) => {
    expect(() => order(names)).toThrow('Audio ordering needs review');
  });
  it.each(['CD', 'Disc ', 'Disk ', 'Part ', ''])('naturally sorts %s sections and zero-padded tracks', prefix => {
    const names = Array.from({ length: 12 }, (_, i) => `${prefix}${i + 1}/01.mp3`);
    expect(order([...names].reverse())!.map(f => f.path)).toEqual(files(names).map(f => f.path));
  });
  it('uses consistent disc tags for otherwise unnumbered sibling folders', () => {
    const input = [
      { path: '/book/b/first.mp3', discNumber: 2, trackNumber: 1 },
      { path: '/book/a/second.mp3', discNumber: 1, trackNumber: 2 },
      { path: '/book/a/first.mp3', discNumber: 1, trackNumber: 1 },
    ];
    expect(resolveSourceTrackOrder(input)!.map(f => f.path)).toEqual([input[2].path, input[1].path, input[0].path]);
  });
  it('preserves globally numbered tracks inside ordered folders', () => {
    expect(order(['CD2/03.mp3', 'CD1/02.mp3', 'CD1/01.mp3'])!.map(f => f.sourcePosition))
      .toEqual([{ disc: 1, track: 1 }, { disc: 1, track: 2 }, { disc: 2, track: 3 }]);
  });
  it.each([
    ['intro.mp3', 'CD1/01.mp3'],
    ['CD1/01.mp3', 'music/song.mp3'],
    ['Part 1-2/01.mp3', 'Part 2/01.mp3'],
    ['CD1/01.mp3', 'Disc 1/01.mp3'],
    ['CD1/01.mp3', 'CD1/03.mp3', 'CD2/01.mp3'],
    ['CD1/a.mp3', 'CD1/b.mp3', 'CD2/a.mp3'],
    ['CD1/01-a.mp3', 'CD1/01-b.mp3', 'CD2/01.mp3'],
    ['first/01.mp3', 'second/01.mp3'],
    ['CD1/01.mp3', 'nested/CD2/01.mp3'],
    ['CD1/01.mp3', 'CD3/01.mp3'],
    ['CD2/01.mp3', 'CD3/01.mp3'],
    ['CD1/10000.mp3', 'CD2/01.mp3'],
  ])('rejects ambiguous layout %j', (...names) => {
    expect(() => order(names)).toThrow('Audio ordering needs review');
  });
  it('rejects misleading metadata instead of overwriting it', () => {
    const input = files(['CD1/01.mp3', 'CD1/02.mp3', 'CD2/01.mp3']);
    expect(() => resolveSourceTrackOrder(input.map(f => ({ ...f, trackNumber: 1 })))).toThrow('conflict');
    expect(() => resolveSourceTrackOrder(input.map(f => ({ ...f, discNumber: 2 })))).toThrow('conflict');
    expect(() => resolveSourceTrackOrder(input.map((f, i) => ({ ...f, trackNumber: [2, 1, 1][i] })))).toThrow('disagree');
  });
  it('rejects inconsistent discs within a folder', () => {
    const input = files(['CD1/01.mp3', 'CD1/02.mp3', 'CD2/01.mp3']);
    expect(() => resolveSourceTrackOrder(input.map((f, i) => ({ ...f, discNumber: i + 1 })))).toThrow('conflicting disc tags');
  });
  it('rejects section counts beyond the supported prefix width', () => {
    expect(() => order(Array.from({ length: 100 }, (_, i) => `CD${i + 1}/01.mp3`))).toThrow('more than 99');
  });
  it('uses a standard padded disc prefix for every copied file', () => {
    expect(sourceOrderedFilename('034.mp3', { disc: 1, track: 34 })).toBe('Disc 01 - 0034 - 034.mp3');
    expect(sourceOrderedFilename('custom.mp3', { disc: 2, track: 1 })).toBe('Disc 02 - 0001 - custom.mp3');
  });
});
