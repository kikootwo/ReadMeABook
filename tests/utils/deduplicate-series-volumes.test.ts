/**
 * Component: Audiobook Deduplication Tests (series volumes, #599)
 * Documentation: documentation/integrations/audible.md
 *
 * Fixture: the issue's five German light-novel volumes. Vols 1-3 share one title,
 * one narrator and near-equal runtimes; the series page labels tell them apart.
 */

import { describe, expect, it } from 'vitest';
import { deduplicateAndCollectGroups } from '@/lib/utils/deduplicate-audiobooks';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

const SERIES = 'B0H3C5X19W';
const TITLE = 'Die Tagebücher der Apothekerin';
const NARRATOR = 'Narrator One';
const VOLS: Array<[string, string, number]> = [
  ['B0H36S85HC', TITLE, 506],
  ['B0H6N477LX', TITLE, 500],
  ['B0H6N6TH8T', TITLE, 500],
  ['B0HQZV8WC6', `${TITLE} 4`, 500],
  ['B0HR12DG1S', `${TITLE} 5`, 500],
];

function vol(i: number, overrides: Partial<AudibleAudiobook> = {}): AudibleAudiobook {
  const [asin, title, durationMinutes] = VOLS[i];
  return { asin, title, author: 'Author', narrator: NARRATOR, durationMinutes, ...overrides };
}

describe('deduplicateAndCollectGroups: series volumes (#599)', () => {
  it('keeps vols 1-3 apart when the series page carries their positions', () => {
    const books = [0, 1, 2, 3, 4].map((i) => vol(i, { seriesAsin: SERIES, seriesPart: String(i + 1) }));
    const { books: out, groups } = deduplicateAndCollectGroups(books);
    expect(out.map((b) => b.asin)).toEqual(VOLS.map(([asin]) => asin));
    expect(groups).toEqual([]);
  });

  it('keeps vols 1-3 apart on their "Band N" subtitles alone', () => {
    const books = [0, 1, 2].map((i) => vol(i, { subtitle: `${TITLE} (Light Novels), Band ${i + 1}` }));
    expect(deduplicateAndCollectGroups(books).books).toHaveLength(3);
  });

  it('merges positionless series rows for display only (group not persistable)', () => {
    const books = [0, 1, 2].map((i) => vol(i, { seriesAsin: SERIES }));
    const { books: out, groups } = deduplicateAndCollectGroups(books);
    expect(out).toHaveLength(1);
    expect(groups).toHaveLength(1);
    expect(groups[0].persistable).toBe(false);
  });

  it('keeps a re-listing pair merged and persistable (same position or no series)', () => {
    const samePos = [vol(0, { seriesAsin: SERIES, seriesPart: '1' }), vol(1, { seriesAsin: SERIES, seriesPart: '1.0', durationMinutes: 506 })];
    const r1 = deduplicateAndCollectGroups(samePos);
    expect(r1.books).toHaveLength(1);
    expect(r1.groups).toHaveLength(1);
    expect(r1.groups[0].persistable).toBe(true);

    const noSeries = deduplicateAndCollectGroups([vol(0), vol(1, { durationMinutes: 506 })]);
    expect(noSeries.books).toHaveLength(1);
    expect(noSeries.groups[0].persistable).toBe(true);
  });

  it('checks a newcomer against every member: R (unknown), v1, v2 never puts v2 with v1', () => {
    const books = [
      vol(0, { asin: 'B0RELIST01', seriesAsin: SERIES }),
      vol(0, { seriesAsin: SERIES, seriesPart: '1' }),
      vol(1, { seriesAsin: SERIES, seriesPart: '2' }),
    ];
    const { books: out, groups } = deduplicateAndCollectGroups(books);
    expect(out).toHaveLength(2);
    expect(groups).toHaveLength(1);
    expect(groups[0].allAsins).toEqual(['B0RELIST01', 'B0H36S85HC']);
    expect(out.map((b) => b.asin)).toContain('B0H6N477LX');
  });
});
