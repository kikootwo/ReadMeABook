/**
 * Component: Multi-Disc Folder Rule Tests (pure)
 * Documentation: documentation/features/multi-disc-folders.md
 */

import { describe, expect, it } from 'vitest';
import {
  discBookFiles,
  discTrackTags,
  isGenericFolderName,
  isPermutation,
  orderDiscLayout,
  parseDiscFolderName,
  resolveDiscLayout,
  slashEntryProblem,
  stripDiscSuffix,
} from '@/lib/utils/disc-layout';

function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('disc folder names', () => {
  it.each([
    ['CD1', 'disc', 1], ['cd 01', 'disc', 1], ['CD-2', 'disc', 2], ['Disc 1', 'disc', 1], ['Disc_02', 'disc', 2],
    ['DISK 3', 'disc', 3], ['Disc 1 of 3', 'disc', 1], ['disc.10', 'disc', 10], ['  CD1 ', 'disc', 1],
    ['Part 1', 'part', 1], ['Part 02', 'part', 2], ['Part 1-2', 'part', 1], ['part3', 'part', 3],
  ])('%s is a %s folder numbered %d', (name, kind, number) => {
    expect(parseDiscFolderName(name)).toEqual({ kind, number });
  });

  it.each([
    'Vol 1', 'Volume 2', 'Book 1', '1', '2', 'Extras', 'Bonus', 'Sample', 'Artwork',
    'Part 1 - The Beginning', 'The Way of Kings Part 1', 'Book Title - CD1', 'CD1 (Bonus)', 'Disc One', 'CD1234',
  ])('%s is not a disc folder', (name) => {
    expect(parseDiscFolderName(name)).toBeNull();
  });

  it('generic search-term names are disc names plus volumes', () => {
    for (const name of ['CD1', 'Disc 2', 'Part 3', 'Volume 1', 'vol 2', 'Disc 1 of 3', 'CD-2']) {
      expect(isGenericFolderName(name)).toBe(true);
    }
    for (const name of ['The Gunslinger', 'Book 1', 'Extras']) {
      expect(isGenericFolderName(name)).toBe(false);
    }
  });

  it('names with any number of digits stay generic (not search terms), as before', () => {
    for (const name of ['CD 0001', 'Part 1000', 'cd1234', 'Volume 12']) {
      expect(isGenericFolderName(name)).toBe(true);
    }
  });

  it('strips a disc suffix from an album title, never Part N', () => {
    expect(stripDiscSuffix('Book (Disc 2)')).toBe('Book');
    expect(stripDiscSuffix('Book - CD 2')).toBe('Book');
    expect(stripDiscSuffix('Book [Disc 1 of 3]')).toBe('Book');
    expect(stripDiscSuffix('Book, Disc 10')).toBe('Book');
    expect(stripDiscSuffix('Book Part 2')).toBe('Book Part 2');
    expect(stripDiscSuffix('Book')).toBe('Book');
    expect(stripDiscSuffix('CD1')).toBe('CD1');
  });

  it('strips only after a separator or bracket: words ending in cd/disk are kept', () => {
    for (const title of ['OCD 1', 'Hard Disk 3', 'The Disk 2', 'Abcd 2']) {
      expect(stripDiscSuffix(title)).toBe(title);
    }
    expect(stripDiscSuffix('Book (Disc 2)')).toBe('Book');
    expect(stripDiscSuffix('Book - CD 2')).toBe('Book');
    expect(stripDiscSuffix('Book: Disc 2')).toBe('Book');
  });

  it('with the disc folder\'s number, a suffix after a plain space is stripped when its number is that one', () => {
    expect(stripDiscSuffix('The Hobbit Disc 1', 1)).toBe('The Hobbit');
    expect(stripDiscSuffix('The Hobbit CD2', 2)).toBe('The Hobbit');
    expect(stripDiscSuffix('Book Disc 1 of 3', 1)).toBe('Book');
    expect(stripDiscSuffix('The Hobbit Disc 2', 1)).toBe('The Hobbit Disc 2');
    expect(stripDiscSuffix('OCD 1', 1)).toBe('OCD 1');
    expect(stripDiscSuffix('Abcd 2', 2)).toBe('Abcd 2');
    expect(stripDiscSuffix('The Hobbit Disc 1')).toBe('The Hobbit Disc 1');
  });

  it('handles very long album titles quickly; whitespace runs collapse, titles over 500 characters stay as they are', () => {
    const spaces = ' \t'.repeat(1 << 19); // 1 MB of whitespace
    const dashes = `${'- '.repeat(1 << 19)}x Disc 1`;
    const started = performance.now();
    expect(stripDiscSuffix(`Book${spaces}(Disc 2)`)).toBe('Book');
    expect(stripDiscSuffix(`Book${spaces}Disc 2`, 2)).toBe('Book');
    expect(stripDiscSuffix(`a${spaces}b`)).toBe('a b');
    expect(stripDiscSuffix(dashes, 1)).toBe(dashes);
    expect(performance.now() - started).toBeLessThan(100);
    const long = `${'x'.repeat(600)} (Disc 2)`;
    expect(stripDiscSuffix(`  ${long}  `)).toBe(long);
    expect(stripDiscSuffix('The  Long\tBook (Disc 2)')).toBe('The Long Book');
  });
});

describe('resolveDiscLayout', () => {
  it('two disc folders with audio directly inside are a multi-disc layout', () => {
    const layout = resolveDiscLayout(['Disc 1/01.m4a', 'Disc 2/01.m4a', 'Intro.m4a', 'Extras/x.m4a']);
    expect(layout?.discs.map((d) => d.name).sort()).toEqual(['Disc 1', 'Disc 2']);
    expect(layout?.rootFiles).toEqual(['Intro.m4a']);
    expect(layout?.otherFiles).toEqual(['Extras/x.m4a']);
  });

  it('a single disc folder, a nested folder or non-disc folders are not', () => {
    expect(resolveDiscLayout(['CD1/01.mp3', 'CD1/02.mp3'])).toBeNull();
    expect(resolveDiscLayout(['Unabridged/01.mp3', 'Unabridged/02.mp3'])).toBeNull();
    expect(resolveDiscLayout(['Vol 1/01.mp3', 'Vol 2/01.mp3'])).toBeNull();
    expect(resolveDiscLayout(['01.mp3', '02.mp3'])).toBeNull();
  });

  it('a disc folder counts only for audio directly inside it (deeper layouts keep today\'s path)', () => {
    expect(resolveDiscLayout(['CD1/Unabridged/01.mp3', 'CD2/Unabridged/01.mp3'])).toBeNull();
    const mixed = resolveDiscLayout(['CD1/01.mp3', 'CD2/01.mp3', 'CD2/Bonus/b.mp3']);
    expect(mixed?.otherFiles).toEqual(['CD2/Bonus/b.mp3']);
  });

  it('strips a shared wrapper folder first (Book/Book/CD1)', () => {
    const layout = resolveDiscLayout(['Book/CD1/01.mp3', 'Book/CD2/01.mp3']);
    expect(layout?.prefix).toBe('Book/');
    expect(layout?.discs).toHaveLength(2);
  });
});

describe('orderDiscLayout', () => {
  const keys = [
    'Intro.m4a', 'Disc 1/01.m4a', 'Disc 1/02.m4a', 'Disc 1/10.m4a', 'Disc 2/01.m4a', 'Disc 2/02.m4a',
    'Disc 10/01.m4a', 'Extras/x.m4a',
  ];
  const expected = [
    'Intro.m4a', 'Disc 1/01.m4a', 'Disc 1/02.m4a', 'Disc 1/10.m4a', 'Disc 2/01.m4a', 'Disc 2/02.m4a',
    'Disc 10/01.m4a', 'Extras/x.m4a',
  ];

  it('root files, then discs by number (2 before 10), natural order inside, other files last', () => {
    expect(orderDiscLayout(resolveDiscLayout(keys)!).order).toEqual(expected);
  });

  it('shuffled input gives the same order', () => {
    for (const seed of [1, 7, 42, 99]) {
      expect(orderDiscLayout(resolveDiscLayout(shuffle(keys, seed))!).order).toEqual(expected);
    }
  });

  it('per-disc track tags that run 1..n win inside that disc only', () => {
    const tracks: Record<string, number> = { 'CD1/a.mp3': 2, 'CD1/b.mp3': 1, 'CD2/a.mp3': 1, 'CD2/b.mp3': 1 };
    const { order, notes } = orderDiscLayout(resolveDiscLayout(Object.keys(tracks))!, (k) => tracks[k]);
    // CD1 by its tags (b, a); CD2's duplicate numbers fall back to natural order
    expect(order).toEqual(['CD1/b.mp3', 'CD1/a.mp3', 'CD2/a.mp3', 'CD2/b.mp3']);
    expect(notes.byTracks).toEqual(['CD1']);
  });

  it('a missing tag (a failed probe) falls back to natural order, never a throw', () => {
    const tracks: Record<string, number | undefined> = { 'CD1/02.mp3': 1, 'CD1/01.mp3': undefined, 'CD2/01.mp3': 1 };
    const { order } = orderDiscLayout(resolveDiscLayout(Object.keys(tracks))!, (k) => tracks[k]);
    expect(order).toEqual(['CD1/01.mp3', 'CD1/02.mp3', 'CD2/01.mp3']);
  });

  it('track tags that run 1..N across the book win over names in every disc (each disc continues the last)', () => {
    // Chapter-title names that do not sort in play order: CD1 tagged 1-10, CD2 tagged 11-20
    const tracks: Record<string, number> = {};
    const playOrder: string[] = [];
    for (let t = 1; t <= 20; t++) {
      const key = `CD${t <= 10 ? 1 : 2}/Chapter ${String.fromCharCode(84 - t)}.mp3`;
      tracks[key] = t;
      playOrder.push(key);
    }
    const { order, notes } = orderDiscLayout(resolveDiscLayout(shuffle(playOrder, 5))!, (k) => tracks[k]);
    expect(order).toEqual(playOrder);
    expect(notes.byTracks).toEqual(['CD1', 'CD2']);
  });

  it('a book-wide run with a gap: each disc whose tags are distinct orders by them', () => {
    const tracks: Record<string, number> = { 'CD1/b.mp3': 1, 'CD1/a.mp3': 2, 'CD2/b.mp3': 4, 'CD2/a.mp3': 5 };
    const { order, notes } = orderDiscLayout(resolveDiscLayout(Object.keys(tracks))!, (k) => tracks[k]);
    expect(order).toEqual(['CD1/b.mp3', 'CD1/a.mp3', 'CD2/b.mp3', 'CD2/a.mp3']);
    expect(notes.byTracks).toEqual(['CD1', 'CD2']);
  });

  it('every file tagged 1..N, root files included: tag order (a root intro tagged 1, the discs continuing)', () => {
    const tracks: Record<string, number> = {
      'Opening Credits.mp3': 1, 'CD1/The Shire.mp3': 2, 'CD1/A Party.mp3': 3, 'CD1/Riders.mp3': 4,
      'CD2/Bree.mp3': 5, 'CD2/Weathertop.mp3': 6, 'CD2/Flight.mp3': 7,
    };
    const layout = resolveDiscLayout(shuffle(Object.keys(tracks), 3))!;
    const { order } = orderDiscLayout(layout, (k) => tracks[k]);
    expect(order).toEqual(Object.keys(tracks));
    expect(discTrackTags(layout, order).get('CD1/The Shire.mp3')).toEqual({ disc: '1/2', track: '2/7' });
  });

  it('a root outro tagged N plays last and takes the last disc', () => {
    const tracks: Record<string, number> = { 'Afterword.mp3': 5, 'CD1/Zeal.mp3': 1, 'CD1/Mercy.mp3': 2, 'CD2/Hope.mp3': 3, 'CD2/Ash.mp3': 4 };
    const layout = resolveDiscLayout(Object.keys(tracks))!;
    const { order } = orderDiscLayout(layout, (k) => tracks[k]);
    expect(order).toEqual(['CD1/Zeal.mp3', 'CD1/Mercy.mp3', 'CD2/Hope.mp3', 'CD2/Ash.mp3', 'Afterword.mp3']);
    expect(discTrackTags(layout, order).get('Afterword.mp3')).toEqual({ disc: '2/2', track: '5/5' });
  });

  it('one failed probe in a book tagged across the discs: every other disc keeps its tag order', () => {
    const tracks: Record<string, number | undefined> = {
      'CD1/Gamma.mp3': 1, 'CD1/Beta.mp3': 2, 'CD1/Alpha.mp3': 3,
      'CD2/Zeta.mp3': 4, 'CD2/Eta.mp3': undefined, 'CD2/Delta.mp3': 6,
      'CD3/Omega.mp3': 7, 'CD3/Nu.mp3': 8, 'CD3/Mu.mp3': 9,
    };
    const { order, notes } = orderDiscLayout(resolveDiscLayout(Object.keys(tracks))!, (k) => tracks[k]);
    expect(order).toEqual([
      'CD1/Gamma.mp3', 'CD1/Beta.mp3', 'CD1/Alpha.mp3',
      'CD2/Delta.mp3', 'CD2/Eta.mp3', 'CD2/Zeta.mp3',
      'CD3/Omega.mp3', 'CD3/Nu.mp3', 'CD3/Mu.mp3',
    ]);
    expect(notes.byTracks).toEqual(['CD1', 'CD3']);
  });

  it('a disc tagged 1, 2, 3, 5 orders by its tags', () => {
    const tracks: Record<string, number> = { 'CD1/d.mp3': 1, 'CD1/c.mp3': 2, 'CD1/b.mp3': 3, 'CD1/a.mp3': 5, 'CD2/a.mp3': 1 };
    const { order } = orderDiscLayout(resolveDiscLayout(Object.keys(tracks))!, (k) => tracks[k]);
    expect(order).toEqual(['CD1/d.mp3', 'CD1/c.mp3', 'CD1/b.mp3', 'CD1/a.mp3', 'CD2/a.mp3']);
  });

  it('no disc values when a disc is numbered 0, or when they would go down along the order; the track still runs', () => {
    const zero = resolveDiscLayout(['CD 0/01.mp3', 'CD 1/01.mp3'])!;
    expect([...discTrackTags(zero, orderDiscLayout(zero).order).values()]).toEqual([{ track: '1/2' }, { track: '2/2' }]);
    // Tags 1..N that put CD2 before CD1
    const tracks: Record<string, number> = { 'CD2/a.mp3': 1, 'CD1/a.mp3': 2 };
    const swapped = resolveDiscLayout(Object.keys(tracks))!;
    const { order } = orderDiscLayout(swapped, (k) => tracks[k]);
    expect(order).toEqual(['CD2/a.mp3', 'CD1/a.mp3']);
    expect([...discTrackTags(swapped, order).values()]).toEqual([{ track: '1/2' }, { track: '2/2' }]);
  });

  it('disc and track tags: track n/N across the book, disc d/D, root files on the first disc, others on the last', () => {
    const layout = resolveDiscLayout(['Intro.mp3', 'Disc 2/01.mp3', 'Disc 3/01.mp3', 'Disc 3/Bonus/b.mp3'])!;
    const { order } = orderDiscLayout(layout);
    expect(Object.fromEntries(discTrackTags(layout, order))).toEqual({
      'Intro.mp3': { disc: '2/3', track: '1/4' },
      'Disc 2/01.mp3': { disc: '2/3', track: '2/4' },
      'Disc 3/01.mp3': { disc: '3/3', track: '3/4' },
      'Disc 3/Bonus/b.mp3': { disc: '3/3', track: '4/4' },
    });
  });

  it('disc folders sharing a number are ordered by name and noted', () => {
    const { order, notes } = orderDiscLayout(resolveDiscLayout(['Disc 1/01.mp3', 'CD1/01.mp3', 'CD2/01.mp3'])!);
    expect(order).toEqual(['CD1/01.mp3', 'Disc 1/01.mp3', 'CD2/01.mp3']);
    expect(notes.tiedNumbers).toEqual([1]);
  });

  it('gaps in disc numbers are fine', () => {
    expect(orderDiscLayout(resolveDiscLayout(['CD3/01.mp3', 'CD1/01.mp3'])!).order).toEqual(['CD1/01.mp3', 'CD3/01.mp3']);
  });

  it('the book set leaves other folders out', () => {
    expect(discBookFiles(resolveDiscLayout(keys)!)).toEqual(expected.slice(0, -1));
  });

  it('isPermutation: same length and same items only', () => {
    expect(isPermutation(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(isPermutation(['a', 'b'], ['a'])).toBe(false);
    expect(isPermutation(['a', 'b'], ['a', 'a'])).toBe(false);
    expect(isPermutation(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

describe('slashEntryProblem (Manual Import selectedFiles with a /)', () => {
  const book = new Set(['Disc 1/01.m4a', 'Disc 2/01.m4a']);

  it('accepts members of the book set exactly', () => {
    expect(slashEntryProblem('Disc 1/01.m4a', book)).toBeNull();
  });

  it.each([
    ['Disc 1/../Disc 2/01.m4a'], ['../x.m4a'], ['/abs/Disc 1/01.m4a'], ['C:/Disc 1/01.m4a'], ['Disc 1\\01.m4a'],
    ['./Disc 1/01.m4a'], ['Disc 1//01.m4a'], ['Disc 1/01.m4a\0'], ['Extras/x.m4a'], ['disc 1/01.m4a'], ['Disc 1/01.m4a/'],
  ])('refuses %j', (entry) => {
    expect(slashEntryProblem(entry, book)).not.toBeNull();
  });
});
