/**
 * Component: Ebook Size Cap Ranking Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * rankEbookTorrents skips ebooks over EBOOK_MAX_SIZE_MB by default (automatic
 * search). Interactive search turns the cap off so large results stay listed.
 */

import { describe, expect, it } from 'vitest';
import { EBOOK_MAX_SIZE_MB, rankEbookTorrents } from '@/lib/utils/ranking-algorithm';

const MB = 1024 * 1024;
const EBOOK = { title: 'Big Picture Book', author: 'Jane Writer', preferredFormat: 'pdf' };

function result(guid: string, size: number) {
  return {
    indexer: 'Indexer',
    indexerId: 1,
    title: `Jane Writer - Big Picture Book (pdf) ${guid}`,
    size,
    seeders: 10,
    publishDate: new Date('2024-01-01T00:00:00Z'),
    downloadUrl: `magnet:?xt=urn:btih:${guid}`,
    guid,
  };
}

const guids = (ranked: { guid: string }[]) => ranked.map((r) => r.guid).sort();

describe('rankEbookTorrents size cap', () => {
  it('keeps the cap at 20 MB', () => {
    expect(EBOOK_MAX_SIZE_MB).toBe(20);
  });

  it('skips a 35 MB result by default and lists it when the cap is off', () => {
    const torrents = [result('big', 35 * MB), result('small', 5 * MB)];

    expect(guids(rankEbookTorrents(torrents, EBOOK))).toEqual(['small']);
    expect(guids(rankEbookTorrents(torrents, EBOOK, { enforceSizeCap: true }))).toEqual(['small']);

    const listed = rankEbookTorrents(torrents, EBOOK, { enforceSizeCap: false });
    expect(guids(listed)).toEqual(['big', 'small']);
    const big = listed.find((r) => r.guid === 'big')!;
    expect(big.size).toBe(35 * MB);
    expect(big.breakdown.sizeScore).toBe(0);
    expect(big.breakdown.notes).toContain('⚠️ Over 20 MB (automatic search skips it)');
  });

  it('scores a 5 MB result the same with or without the cap', () => {
    const torrents = [result('small', 5 * MB)];
    const capped = rankEbookTorrents(torrents, EBOOK);
    const uncapped = rankEbookTorrents(torrents, EBOOK, { enforceSizeCap: false });

    expect(capped).toHaveLength(1);
    expect(uncapped).toHaveLength(1);
    expect(uncapped[0].finalScore).toBe(capped[0].finalScore);
    expect(uncapped[0].breakdown).toEqual(capped[0].breakdown);
  });

  it('keeps exactly the cap and skips one byte over it only when capped', () => {
    const torrents = [result('at-cap', 20 * MB), result('over-cap', 20 * MB + 1)];

    expect(guids(rankEbookTorrents(torrents, EBOOK))).toEqual(['at-cap']);
    expect(guids(rankEbookTorrents(torrents, EBOOK, { enforceSizeCap: false }))).toEqual(['at-cap', 'over-cap']);
  });
});
