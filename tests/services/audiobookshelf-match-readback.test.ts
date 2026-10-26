/**
 * Component: Audiobookshelf ASIN match + read-back tests (#287)
 * Documentation: documentation/fixes/file-hash-matching.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const absApiMock = vi.hoisted(() => ({
  triggerABSItemMatch: vi.fn(),
  getABSItem: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/audiobookshelf/api', () => absApiMock);

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

const item = (id: string, asin?: string) => ({ id, externalId: id, title: `Book ${id}`, author: 'A', asin } as any);
const matched = (asin: unknown, extra: Record<string, unknown> = {}) => ({
  status: 'matched' as const,
  updated: true,
  libraryItem: { id: 'x', media: { metadata: { asin, ...extra } } },
});

describe('matchItemsWithoutAsin / storeMatchedAsin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    absApiMock.getABSItem.mockResolvedValue({ media: { audioFiles: [] } });
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    prismaMock.plexLibrary.findUnique.mockResolvedValue({ asin: null });
    prismaMock.plexLibrary.updateMany.mockResolvedValue({ count: 1 });
  });

  it('skips items that already have an ASIN', async () => {
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a', 'B0HAVE0000')], logger);

    expect(result.considered).toBe(0);
    expect(absApiMock.triggerABSItemMatch).not.toHaveBeenCalled();
  });

  it('stores the ASIN from the match response', async () => {
    absApiMock.triggerABSItemMatch.mockResolvedValue(matched('B0TEST1234'));
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a')], logger);

    expect(result).toMatchObject({ considered: 1, fuzzyMatchCount: 1, asinsStored: 1, asinsChanged: 0 });
    expect(prismaMock.plexLibrary.updateMany).toHaveBeenCalledWith({
      where: { plexGuid: 'a' },
      data: { asin: 'B0TEST1234', updatedAt: expect.any(Date) },
    });
  });

  it('no match ({warning}): no write, and the next item is still matched', async () => {
    absApiMock.triggerABSItemMatch
      .mockResolvedValueOnce({ status: 'no_match', warning: 'No audible match found' })
      .mockResolvedValueOnce(matched('B0SECOND00'));
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a'), item('b')], logger);

    expect(result.asinsStored).toBe(1);
    expect(prismaMock.plexLibrary.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.plexLibrary.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { plexGuid: 'b' } }));
  });

  it('timeout / error outcome: no write, and the next item is still matched', async () => {
    absApiMock.triggerABSItemMatch
      .mockResolvedValueOnce({ status: 'error', error: 'The operation was aborted due to timeout' })
      .mockResolvedValueOnce(matched('B0SECOND00'));
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a'), item('b')], logger);

    expect(absApiMock.triggerABSItemMatch).toHaveBeenCalledTimes(2);
    expect(prismaMock.plexLibrary.updateMany).toHaveBeenCalledTimes(1);
    expect(result.asinsStored).toBe(1);
  });

  it('a failing write is caught per item and the loop continues', async () => {
    absApiMock.triggerABSItemMatch.mockResolvedValue(matched('B0TEST1234'));
    prismaMock.plexLibrary.updateMany
      .mockRejectedValueOnce(new Error('db write failed'))
      .mockResolvedValueOnce({ count: 1 });
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a'), item('b')], logger);

    expect(prismaMock.plexLibrary.updateMany).toHaveBeenCalledTimes(2);
    expect(result.asinsStored).toBe(1);
    // The failed store does not count item 'a' as a second fuzzy match (2 items, 2 fuzzy matches)
    expect(result.fuzzyMatchCount).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to store the matched ASIN for "Book a"'));
  });

  it('a failing item fetch is caught per item and the loop continues', async () => {
    absApiMock.getABSItem.mockRejectedValueOnce(new Error('ABS API error: 404 Not Found'));
    absApiMock.triggerABSItemMatch.mockResolvedValue(matched('B0SECOND00'));
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a'), item('b')], logger);

    expect(absApiMock.triggerABSItemMatch).toHaveBeenCalledTimes(1);
    expect(absApiMock.triggerABSItemMatch).toHaveBeenCalledWith('b', undefined);
    expect(result.asinsStored).toBe(1);
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['whitespace', '   '],
    ['ISBN-13', '9780000000001'],
    ['hyphenated ISBN', '978-0-00-000000-1'],
    ['non-string', 12345],
  ])('never writes or blanks an ASIN for %s', async (_label, value) => {
    prismaMock.plexLibrary.findUnique.mockResolvedValue({ asin: 'B0GOOD0000' });
    absApiMock.triggerABSItemMatch.mockResolvedValue(matched(value));
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a')], logger);

    expect(result.asinsStored).toBe(0);
    expect(prismaMock.plexLibrary.updateMany).not.toHaveBeenCalled();
  });

  it('never reads the ISBN as an ASIN', async () => {
    absApiMock.triggerABSItemMatch.mockResolvedValue(matched(null, { isbn: '1234567890' }));
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    await matchItemsWithoutAsin([item('a')], logger);

    expect(prismaMock.plexLibrary.updateMany).not.toHaveBeenCalled();
  });

  it('a response without libraryItem.media.metadata writes nothing', async () => {
    absApiMock.triggerABSItemMatch.mockResolvedValue({ status: 'matched', updated: false, libraryItem: { id: 'a' } });
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    await matchItemsWithoutAsin([item('a')], logger);

    expect(prismaMock.plexLibrary.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a numeric (ISBN-10 style) Audible ASIN and trims it', async () => {
    absApiMock.triggerABSItemMatch.mockResolvedValue(matched(' 1774241757 '));
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    await matchItemsWithoutAsin([item('a')], logger);

    expect(prismaMock.plexLibrary.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ asin: '1774241757' }) }));
  });

  it('replaces a different existing ASIN (what the next scan would write) and counts it', async () => {
    prismaMock.plexLibrary.findUnique.mockResolvedValue({ asin: 'B0OLD00000' });
    absApiMock.triggerABSItemMatch.mockResolvedValue(matched('B0NEW00000'));
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a')], logger);

    expect(result).toMatchObject({ asinsStored: 1, asinsChanged: 1 });
    expect(prismaMock.plexLibrary.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ asin: 'B0NEW00000' }) }));
  });

  it('does not rewrite an unchanged ASIN', async () => {
    prismaMock.plexLibrary.findUnique.mockResolvedValue({ asin: 'B0SAME0000' });
    absApiMock.triggerABSItemMatch.mockResolvedValue(matched('B0SAME0000'));
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a')], logger);

    expect(result.asinsStored).toBe(0);
    expect(prismaMock.plexLibrary.updateMany).not.toHaveBeenCalled();
  });

  it('skips the write when the library row does not exist (yet)', async () => {
    prismaMock.plexLibrary.findUnique.mockResolvedValue(null);
    absApiMock.triggerABSItemMatch.mockResolvedValue(matched('B0TEST1234'));
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a')], logger);

    expect(result.asinsStored).toBe(0);
    expect(prismaMock.plexLibrary.updateMany).not.toHaveBeenCalled();
  });

  it('file-hash path: stores only what ABS reports, never the ASIN RMAB sent', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ audibleAsin: 'B0SENT0000', title: 'Downloaded' });
    absApiMock.getABSItem.mockResolvedValue({ media: { audioFiles: [{ metadata: { filename: 'Chapter 01.mp3' } }] } });
    absApiMock.triggerABSItemMatch.mockResolvedValue({ status: 'no_match', warning: 'No audible match found' });
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a')], logger);

    expect(absApiMock.triggerABSItemMatch).toHaveBeenCalledWith('a', 'B0SENT0000');
    expect(result).toMatchObject({ fileMatchCount: 1, asinsStored: 0 });
    expect(prismaMock.plexLibrary.updateMany).not.toHaveBeenCalled();
  });

  it('reads the ASIN whatever provider produced the match (custom-provider shape)', async () => {
    absApiMock.triggerABSItemMatch.mockResolvedValue({
      status: 'matched',
      updated: true,
      libraryItem: { id: 'a', media: { metadata: { title: 'T', asin: 'B0CUSTOM00', isbn: null, publisher: 'Custom' } } },
    });
    const { matchItemsWithoutAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    const result = await matchItemsWithoutAsin([item('a')], logger);

    expect(result.asinsStored).toBe(1);
  });

  it('readMatchedAsin ignores undefined outcomes (mocked or missing)', async () => {
    const { readMatchedAsin } = await import('@/lib/services/audiobookshelf/match-missing-asins');

    expect(readMatchedAsin(undefined)).toBeNull();
    expect(readMatchedAsin({ status: 'error', error: 'x' })).toBeNull();
    expect(readMatchedAsin(matched('B0TEST1234'))).toBe('B0TEST1234');
  });
});
