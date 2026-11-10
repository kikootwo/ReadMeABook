/**
 * Component: Library view ASIN rule tests (parity table vs findPlexMatch)
 * Documentation: documentation/features/library-view.md
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../../helpers/prisma';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

interface Row { plexGuid: string; asin: string | null; plexRatingKey: string | null; title: string; author: string }

/** The DB prefilter findPlexMatch runs, emulated as Postgres does it: case-sensitive equals/contains. */
function emulateDb(rows: Row[]) {
  prismaMock.plexLibrary.findMany.mockImplementation(async ({ where }: any) => {
    const [byAsin, byGuid] = where.OR;
    return rows.filter((r) => r.asin === byAsin.asin || r.plexGuid.includes(byGuid.plexGuid.contains));
  });
}

const lib = (plexGuid: string, asin: string | null): Row => ({ plexGuid, asin, plexRatingKey: null, title: 't', author: 'a' });

// [case, library row, requested ASIN, findPlexMatch matches, Library rule matches]
const TABLE: [string, Row, string, boolean, boolean][] = [
  ['asin field equal, same case', lib('abs-1', 'B0ABCDEFGH'), 'B0ABCDEFGH', true, true],
  ['asin field equal, case differs (documented divergence)', lib('abs-1', 'b0abcdefgh'), 'B0ABCDEFGH', false, true],
  ['guid contains the ASIN, same case', lib('com.plexapp.agents.audible://B0ABCDEFGH?lang=en', null), 'B0ABCDEFGH', true, true],
  ['guid contains the ASIN, case differs (documented divergence)', lib('com.plexapp.agents.audible://b0abcdefgh?lang=en', null), 'B0ABCDEFGH', false, true],
  ['guid contains the ASIN inside a longer run', lib('plex://album/XB0ABCDEFGHY', null), 'B0ABCDEFGH', true, true],
  ['ISBN-10 style ASIN in the field', lib('abs-2', '1250301696'), '1250301696', true, true],
  ['different ASIN', lib('abs-3', 'B0ZZZZZZZZ'), 'B0ABCDEFGH', false, false],
  ['guid shares only a prefix', lib('com.plexapp.agents.audible://B0ABCDEFGX', null), 'B0ABCDEFGH', false, false],
  ['blank requested ASIN', lib('abs-4', 'B0ABCDEFGH'), '  ', false, false],
  ['not ASIN-shaped value inside a guid (documented)', lib('xx-B0ABC-yy', null), 'B0ABC', true, false],
];

describe('Library ASIN rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(TABLE)('%s', async (_name, row, asin, plexMatches, libraryMatches) => {
    emulateDb([row]);
    const { findPlexMatch } = await import('@/lib/utils/audiobook-matcher');
    const { buildAsinIndex, matchByAsin } = await import('@/lib/library-view/asin-rule');

    const plex = await findPlexMatch({ asin, title: 't', author: 'a' } as any);
    expect(!!plex).toBe(plexMatches);
    expect(!!matchByAsin(buildAsinIndex([row]), asin)).toBe(libraryMatches);
  });

  it('prefers an asin field match over a guid match, like findPlexMatch', async () => {
    const { buildAsinIndex, matchByAsin } = await import('@/lib/library-view/asin-rule');
    const viaGuid = lib('com.plexapp.agents.audible://B0ABCDEFGH', 'B0OTHEROTH');
    const viaField = lib('plex://album/5d07', 'B0ABCDEFGH');
    expect(matchByAsin(buildAsinIndex([viaGuid, viaField]), 'B0ABCDEFGH')).toBe(viaField);
  });

  it('the first row in load order wins a shared key', async () => {
    const { buildAsinIndex, matchByAsin } = await import('@/lib/library-view/asin-rule');
    const first = lib('abs-a', 'B0ABCDEFGH');
    const second = lib('abs-b', 'B0ABCDEFGH');
    expect(matchByAsin(buildAsinIndex([first, second]), 'B0ABCDEFGH')).toBe(first);
  });

  it('indexes every 10-character window of alphanumeric runs only', async () => {
    const { guidAsinWindows } = await import('@/lib/library-view/asin-rule');
    expect(guidAsinWindows('com.plexapp.agents.audible://B0ABCDEFGH?lang=en')).toEqual(['B0ABCDEFGH']);
    expect(guidAsinWindows('ab-cdefghijkl')).toEqual(['CDEFGHIJKL']);
    expect(guidAsinWindows('short-ids-only')).toEqual([]);
  });
});
