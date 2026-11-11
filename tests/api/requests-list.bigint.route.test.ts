/**
 * Component: Requests List API Route Tests (BigInt columns)
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

type AuthHandler = (req: unknown) => unknown;
let authRequest: { user: { id: string; role: string }; nextUrl: URL };

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/services/download-selection-guard', () => ({ stripProwlarrKeyFromResults: async (r: unknown) => r }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => ({ addSearchJob: vi.fn(), addNotificationJob: vi.fn() }) }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn() }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ getAudiobookDetails: vi.fn() }) }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ getBackendMode: async () => 'audiobookshelf' }) }));

const SIZE = 1_234_567_890;

/** A request shaped like the Prisma result, with a BigInt size on its audiobook. */
function request(id: string, fileSizeBytes: bigint | null) {
  return {
    id,
    userId: 'user-1',
    type: 'audiobook',
    status: 'downloaded',
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    selectedTorrent: null,
    placedEbookFiles: null,
    audiobook: { id: `ab-${id}`, title: 'Big Book', libraryAsin: null, absItemId: null, filePath: '/media/a/b', fileSizeBytes },
    user: { id: 'user-1', plexUsername: 'reader' },
  };
}

async function getRequests() {
  const { GET } = await import('@/app/api/requests/route');
  return GET({ nextUrl: authRequest.nextUrl } as never);
}

describe('GET /api/requests with BigInt columns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', role: 'user' }, nextUrl: new URL('http://localhost/api/requests?myOnly=true') };
    requireAuthMock.mockImplementation((_req: unknown, handler: AuthHandler) => handler(authRequest));
    prismaMock.request.count.mockResolvedValue(2);
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
  });

  it('returns 200 with the audiobook size as a number', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([request('req-1', BigInt(SIZE)), request('req-2', null)]);

    const response = await getRequests();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.requests[0].audiobook.fileSizeBytes).toBe(SIZE);
    expect(payload.requests[1].audiobook.fileSizeBytes).toBeNull();
    expect(payload.counts.all).toBe(2);
  });
});
