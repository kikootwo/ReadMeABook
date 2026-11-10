/**
 * Component: Library view test fixtures
 * Documentation: documentation/features/library-view.md
 */

import type { LibraryRowRecord, RequestRecord } from '@/lib/library-view/types';

let seq = 0;
const uuid = (prefix: string) => {
  seq += 1;
  const n = seq.toString(16).padStart(12, '0');
  return `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${n}`;
};

export const USERS = {
  admin: { id: '00000000-0000-4000-8000-00000000a001', plexUsername: 'admin', deletedAt: null },
  alice: { id: '00000000-0000-4000-8000-00000000a002', plexUsername: 'alice', deletedAt: null },
  bob: { id: '00000000-0000-4000-8000-00000000a003', plexUsername: 'bob', deletedAt: null },
  goneCarol: { id: '00000000-0000-4000-8000-00000000a004', plexUsername: 'carol', deletedAt: new Date('2026-10-01T00:00:00Z') },
  carol: { id: '00000000-0000-4000-8000-00000000a005', plexUsername: 'carol', deletedAt: null },
};

export function row(overrides: Partial<LibraryRowRecord> = {}): LibraryRowRecord {
  return {
    id: uuid('11111111'),
    plexGuid: `abs-item-${seq}`,
    title: 'Library Title',
    author: 'Library Author',
    narrator: 'Library Narrator',
    duration: BigInt(3_600_000),
    year: 2020,
    asin: null,
    addedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    cachedLibraryCoverPath: null,
    ...overrides,
  };
}

type RequestOverrides = Partial<Omit<RequestRecord, 'audiobook' | 'user'>> & {
  audiobook?: Partial<RequestRecord['audiobook']>;
  user?: RequestRecord['user'];
};

export function request(overrides: RequestOverrides = {}): RequestRecord {
  const audiobookId = overrides.audiobookId ?? overrides.audiobook?.id ?? uuid('22222222');
  const { audiobook, user, ...rest } = overrides;
  return {
    id: uuid('33333333'),
    audiobookId,
    type: 'audiobook',
    status: 'pending',
    progress: 0,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    completedAt: null,
    releaseDate: null,
    errorMessage: null,
    deletedAt: null,
    ...rest,
    user: user ?? USERS.alice,
    audiobook: {
      id: audiobookId,
      audibleAsin: null,
      title: 'Requested Title',
      author: 'Requested Author',
      narrator: 'Requested Narrator',
      series: null,
      seriesPart: null,
      year: 2021,
      plexGuid: null,
      absItemId: null,
      libraryAsin: null,
      coverArtUrl: null,
      ...audiobook,
    },
  };
}
