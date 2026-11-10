/**
 * Component: Requester Tag Backfill Processor (#232)
 * Documentation: documentation/features/requester-tags.md
 *
 * Plex mode and tagging off skip; every listed eligible item is tagged once and a second run writes
 * nothing; 3 failures in a row stop it; turning tagging off stops it; ABS failures never throw; the
 * result counts; the Explicit flag only while its setting is on (#542). Real: the processor, requester-tags. Mocked: prisma (in-memory holder), config,
 * the library service, writeABSItem (a fake ABS tag and Explicit store, #542).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createLibraryDb, resetLibraryDb, wireLibraryDb, type Row } from '../helpers/library-link-db';
import type { LibraryItem } from '@/lib/services/library/ILibraryService';

const prismaMock = createPrismaMock();
const abs = vi.hoisted(() => ({
  tags: new Map<string, string[]>(),
  writes: [] as string[],
  explicit: new Set<string>(),
  fail: null as null | ((itemId: string) => boolean),
  mode: 'audiobookshelf',
  config: {} as Record<string, string>,
  onGet: null as null | ((key: string) => void),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getBackendMode: async () => abs.mode,
    get: async (key: string) => {
      abs.onGet?.(key);
      return abs.config[key] ?? null;
    },
    clearCache: () => {},
  }),
}));
vi.mock('@/lib/services/library', () => ({
  getLibraryService: async () => ({
    getLibraryItems: async (): Promise<LibraryItem[]> => [...abs.tags].map(([id, tags]) => ({
      id, externalId: id, title: id, author: 'A', addedAt: new Date(), updatedAt: new Date(), tags: [...tags],
    })),
  }),
}));
vi.mock('@/lib/services/audiobookshelf/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/audiobookshelf/api')>()),
  writeABSItem: async (itemId: string, want: { tags?: string[]; explicit?: true }) => {
    const none = { tags: want.tags ? 'failed' : 'none', addedTags: [], explicit: want.explicit ? 'failed' : 'none' };
    if (abs.fail?.(itemId)) return { ...none, error: 'ABS API error: 500 Internal Server Error', httpStatus: 500 };
    const current = abs.tags.get(itemId) ?? [];
    const missing = (want.tags ?? []).filter((t) => !current.includes(t));
    const setExplicit = want.explicit === true && !abs.explicit.has(itemId);
    if (missing.length > 0) abs.tags.set(itemId, [...current, ...missing]);
    if (setExplicit) abs.explicit.add(itemId);
    if (missing.length > 0 || setExplicit) abs.writes.push(itemId);
    return {
      tags: want.tags ? (missing.length > 0 ? 'added' : 'present') : 'none',
      addedTags: missing,
      explicit: want.explicit ? (setExplicit ? 'set' : 'present') : 'none',
    };
  },
  canKeyUserSeeExplicit: async () => true,
}));

const db = createLibraryDb();

function item(n: number, userId: string, over: Row = {}) {
  db.audiobooks.push({ id: `b${n}`, title: `Book ${n}`, absItemId: `item-${n}` });
  db.requests.push({ id: `r${n}`, audiobookId: `b${n}`, userId, type: 'audiobook', status: 'available', deletedAt: null, approvalBypassedBy: null, ...over });
  abs.tags.set(`item-${n}`, ['keep']);
}

async function runJob() {
  const { processBackfillRequesterTags } = await import('@/lib/processors/backfill-requester-tags.processor');
  return processBackfillRequesterTags({ jobId: 'job-1' });
}

describe('backfill_requester_tags (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLibraryDb(db);
    wireLibraryDb(prismaMock, db, '/media');
    abs.tags = new Map();
    abs.writes = [];
    abs.explicit = new Set();
    abs.fail = null;
    abs.onGet = null;
    abs.mode = 'audiobookshelf';
    abs.config = { 'audiobookshelf.tag_requester': 'true', 'audiobookshelf.library_id': 'lib-1' };
    db.users.push(
      { id: 'u-alice', plexUsername: 'alice', deletedAt: null, registrationStatus: 'approved' },
      { id: 'u-gone', plexUsername: 'gone', deletedAt: new Date(), registrationStatus: 'approved' },
      { id: 'u-pat', plexUsername: 'pat', deletedAt: null, registrationStatus: 'pending_approval' },
      { id: 'u-admin', plexUsername: 'admin', deletedAt: null, registrationStatus: null, role: 'admin' },
    );
  });

  it('Plex mode: skipped, nothing written', async () => {
    abs.mode = 'plex';
    item(1, 'u-alice');

    expect(await runJob()).toEqual({ skipped: true, reason: 'not_audiobookshelf' });
    expect(abs.writes).toEqual([]);
  });

  it('tagging off: skipped', async () => {
    abs.config = { 'audiobookshelf.library_id': 'lib-1' };

    expect(await runJob()).toEqual({ skipped: true, reason: 'disabled' });
  });

  it('tags each listed eligible item once (keeping its tags), counts the rest; a second run writes nothing', async () => {
    item(1, 'u-alice');
    item(2, 'u-alice');
    item(3, 'u-gone');
    item(4, 'u-pat');
    item(5, 'u-alice', { approvalBypassedBy: 'manual_import:denied' });
    item(6, 'u-admin'); // an admin's import nobody requested (no download record)

    const first = await runJob();

    expect(first).toEqual({
      considered: 6, tagged: 2, alreadyTagged: 0, failed: 0,
      skippedNoTag: 0, skippedShared: 0, skippedUser: 2, skippedUnapproved: 1, skippedImported: 1,
      markedExplicit: 0, explicitHeldBack: 0, stoppedEarly: false,
    });
    expect(abs.tags.get('item-1')).toEqual(['keep', 'req:alice']);
    expect(abs.tags.get('item-5')).toEqual(['keep']);
    expect(abs.tags.get('item-6')).toEqual(['keep']);
    expect(abs.writes.sort()).toEqual(['item-1', 'item-2']);

    abs.writes = [];
    const second = await runJob();

    expect(second).toMatchObject({ tagged: 0, alreadyTagged: 2 });
    expect(abs.writes).toEqual([]);
  });

  it('marks the items of marked requests explicit, whatever the tag rules say (#542); a second run writes nothing', async () => {
    abs.config['audiobookshelf.explicit_mark_enabled'] = 'true';
    item(1, 'u-alice', { explicit: true });
    item(2, 'u-pat', { explicit: true }); // not taggable, still marked
    item(3, 'u-alice');

    const first = await runJob();

    expect(first).toMatchObject({ tagged: 2, markedExplicit: 2 });
    expect([...abs.explicit].sort()).toEqual(['item-1', 'item-2']);
    expect(abs.tags.get('item-2')).toEqual(['keep']);

    abs.writes = [];
    expect(await runJob()).toMatchObject({ tagged: 0, markedExplicit: 0 });
    expect(abs.writes).toEqual([]);
  });

  it('the Explicit mark setting off (absent): marked items get their tag, never the flag (#542)', async () => {
    item(1, 'u-alice', { explicit: true });
    item(2, 'u-pat', { explicit: true });

    expect(await runJob()).toMatchObject({ tagged: 1, markedExplicit: 0, explicitHeldBack: 0 });
    expect([...abs.explicit]).toEqual([]);
    expect(abs.writes).toEqual(['item-1']);
  });

  it('stops after 3 failures in a row and never throws', async () => {
    for (let n = 1; n <= 6; n++) item(n, 'u-alice');
    abs.fail = () => true;

    const result = await runJob();

    expect(result).toMatchObject({ failed: 3, tagged: 0, stoppedEarly: true });
  });

  it('stops when tagging is turned off mid-run (re-read every 25 items)', async () => {
    for (let n = 1; n <= 60; n++) item(n, 'u-alice');
    let reads = 0;
    abs.onGet = (key) => {
      if (key !== 'audiobookshelf.tag_requester') return;
      reads++;
      if (reads === 2) abs.config['audiobookshelf.tag_requester'] = 'false'; // turned off after the start check
    };

    const result = await runJob();

    expect(result).toMatchObject({ tagged: 25, stoppedEarly: true });
  });
});
