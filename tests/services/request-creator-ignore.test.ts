/**
 * Component: Request Creator Ignore Tests
 * Documentation: documentation/features/ignored-audiobooks.md
 *
 * Tests the per-user ignore list check in createRequestForUser,
 * including direct ASIN match, works-system sibling expansion,
 * and the bypassIgnore option.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// Mock findPlexMatch to return null (not in library)
vi.mock('@/lib/utils/audiobook-matcher', () => ({
  findPlexMatch: vi.fn().mockResolvedValue(null),
}));

// Mock AudibleService (default = no Audnexus data)
const audibleServiceMock = vi.hoisted(() => ({
  getAudiobookDetails: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

// Mock job queue (shared across tests so we can assert addSearchJob calls)
const jobQueueAddSearchJob = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const jobQueueAddNotificationJob = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => ({
    addSearchJob: jobQueueAddSearchJob,
    addNotificationJob: jobQueueAddNotificationJob,
  }),
}));

// Mock config service for indexer.skip_unreleased setting
const configServiceGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: configServiceGet }),
}));

// Mock getSiblingAsins from works.service
const mockGetSiblingAsins = vi.fn().mockResolvedValue(new Map());
const mockSeedAsin = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/services/works.service', () => ({
  getSiblingAsins: (...args: any[]) => mockGetSiblingAsins(...args),
  seedAsin: (...args: any[]) => mockSeedAsin(...args),
}));

const TEST_AUDIOBOOK = {
  asin: 'B00TEST001',
  title: 'Test Book',
  author: 'Test Author',
};

const TEST_USER_ID = 'user-123';

describe('createRequestForUser — ignore list', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Restore mock return values cleared by clearAllMocks
    jobQueueAddSearchJob.mockResolvedValue(undefined);
    jobQueueAddNotificationJob.mockResolvedValue(undefined);

    // Default: no existing requests, no library matches
    prismaMock.request.findFirst.mockResolvedValue(null);
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    prismaMock.audiobook.create.mockResolvedValue({
      id: 'audiobook-1',
      audibleAsin: TEST_AUDIOBOOK.asin,
      title: TEST_AUDIOBOOK.title,
      author: TEST_AUDIOBOOK.author,
      narrator: null,
    });
    prismaMock.request.create.mockResolvedValue({
      id: 'request-1',
      userId: TEST_USER_ID,
      audiobookId: 'audiobook-1',
      status: 'pending',
      audiobook: { id: 'audiobook-1', title: 'Test Book' },
      user: { id: TEST_USER_ID, plexUsername: 'testuser' },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'user',
      autoApproveRequests: true,
      plexUsername: 'testuser',
    });

    // Default: not ignored
    prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
    prismaMock.ignoredAudiobook.findFirst.mockResolvedValue(null);
    mockGetSiblingAsins.mockResolvedValue(new Map());
    mockSeedAsin.mockResolvedValue(undefined);

    // Default Audnexus + config behaviour
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
    configServiceGet.mockResolvedValue(null); // default → setting ON
  });

  it('blocks auto-request when ASIN is directly ignored', async () => {
    prismaMock.ignoredAudiobook.findUnique.mockResolvedValue({
      id: 'ignored-1',
      userId: TEST_USER_ID,
      asin: TEST_AUDIOBOOK.asin,
    });

    const { createRequestForUser } = await import('@/lib/services/request-creator.service');
    const result = await createRequestForUser(TEST_USER_ID, TEST_AUDIOBOOK);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ignored');
      expect(result.message).toContain('ignore list');
    }

    // Should NOT create a request
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('blocks auto-request when sibling ASIN is ignored', async () => {
    // Direct ASIN not ignored
    prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);

    // But a sibling is ignored
    mockGetSiblingAsins.mockResolvedValue(new Map([
      [TEST_AUDIOBOOK.asin, ['B00SIBLING']],
    ]));
    prismaMock.ignoredAudiobook.findFirst.mockResolvedValue({
      id: 'ignored-sibling',
      userId: TEST_USER_ID,
      asin: 'B00SIBLING',
    });

    const { createRequestForUser } = await import('@/lib/services/request-creator.service');
    const result = await createRequestForUser(TEST_USER_ID, TEST_AUDIOBOOK);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ignored');
    }

    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('allows manual request with bypassIgnore even when ignored', async () => {
    prismaMock.ignoredAudiobook.findUnique.mockResolvedValue({
      id: 'ignored-1',
      userId: TEST_USER_ID,
      asin: TEST_AUDIOBOOK.asin,
    });

    const { createRequestForUser } = await import('@/lib/services/request-creator.service');
    const result = await createRequestForUser(TEST_USER_ID, TEST_AUDIOBOOK, {
      bypassIgnore: true,
    });

    expect(result.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalled();

    // Should NOT have even checked the ignore list
    expect(prismaMock.ignoredAudiobook.findUnique).not.toHaveBeenCalled();
  });

  it('allows request when ASIN is not ignored', async () => {
    prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
    prismaMock.ignoredAudiobook.findFirst.mockResolvedValue(null);

    const { createRequestForUser } = await import('@/lib/services/request-creator.service');
    const result = await createRequestForUser(TEST_USER_ID, TEST_AUDIOBOOK);

    expect(result.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalled();
  });

  it('falls through gracefully when works expansion fails', async () => {
    prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
    mockGetSiblingAsins.mockRejectedValue(new Error('DB error'));

    const { createRequestForUser } = await import('@/lib/services/request-creator.service');
    const result = await createRequestForUser(TEST_USER_ID, TEST_AUDIOBOOK);

    // Should still succeed since direct check passed and expansion is best-effort
    expect(result.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalled();
  });

  it('does not check siblings when no sibling ASINs exist', async () => {
    prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
    mockGetSiblingAsins.mockResolvedValue(new Map());

    const { createRequestForUser } = await import('@/lib/services/request-creator.service');
    const result = await createRequestForUser(TEST_USER_ID, TEST_AUDIOBOOK);

    expect(result.success).toBe(true);
    // Should not have queried findFirst for sibling check since map was empty
    expect(prismaMock.ignoredAudiobook.findFirst).not.toHaveBeenCalled();
  });
});

describe('createRequestForUser — release-date gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueAddSearchJob.mockResolvedValue(undefined);
    jobQueueAddNotificationJob.mockResolvedValue(undefined);
    prismaMock.request.findFirst.mockResolvedValue(null);
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    prismaMock.audiobook.create.mockResolvedValue({
      id: 'audiobook-1',
      audibleAsin: TEST_AUDIOBOOK.asin,
      title: TEST_AUDIOBOOK.title,
      author: TEST_AUDIOBOOK.author,
      narrator: null,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'user',
      autoApproveRequests: true,
      plexUsername: 'testuser',
    });
    prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
    prismaMock.ignoredAudiobook.findFirst.mockResolvedValue(null);
    mockGetSiblingAsins.mockResolvedValue(new Map());
    mockSeedAsin.mockResolvedValue(undefined);
  });

  it('creates request in awaiting_release with no search when book is unreleased and setting ON', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ releaseDate: future });
    configServiceGet.mockResolvedValue(null); // default → ON

    prismaMock.request.create.mockResolvedValue({
      id: 'request-future-on',
      userId: TEST_USER_ID,
      audiobookId: 'audiobook-1',
      status: 'awaiting_release',
      audiobook: { id: 'audiobook-1', title: 'Test Book' },
      user: { id: TEST_USER_ID, plexUsername: 'testuser' },
    });

    const { createRequestForUser } = await import('@/lib/services/request-creator.service');
    const result = await createRequestForUser(TEST_USER_ID, TEST_AUDIOBOOK);

    expect(result.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'awaiting_release',
          releaseDate: expect.any(Date),
        }),
      })
    );
    expect(jobQueueAddSearchJob).not.toHaveBeenCalled();
  });

  it('creates pending request and runs search when book is already released and setting ON', async () => {
    const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ releaseDate: past });
    configServiceGet.mockResolvedValue('true');

    prismaMock.request.create.mockResolvedValue({
      id: 'request-past-on',
      userId: TEST_USER_ID,
      audiobookId: 'audiobook-1',
      status: 'pending',
      audiobook: { id: 'audiobook-1', title: 'Test Book' },
      user: { id: TEST_USER_ID, plexUsername: 'testuser' },
    });

    const { createRequestForUser } = await import('@/lib/services/request-creator.service');
    const result = await createRequestForUser(TEST_USER_ID, TEST_AUDIOBOOK);

    expect(result.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
        }),
      })
    );
    expect(jobQueueAddSearchJob).toHaveBeenCalled();
  });

  it('creates pending request and runs search when book is unreleased but setting OFF', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    audibleServiceMock.getAudiobookDetails.mockResolvedValue({ releaseDate: future });
    configServiceGet.mockResolvedValue('false');

    prismaMock.request.create.mockResolvedValue({
      id: 'request-future-off',
      userId: TEST_USER_ID,
      audiobookId: 'audiobook-1',
      status: 'pending',
      audiobook: { id: 'audiobook-1', title: 'Test Book' },
      user: { id: TEST_USER_ID, plexUsername: 'testuser' },
    });

    const { createRequestForUser } = await import('@/lib/services/request-creator.service');
    const result = await createRequestForUser(TEST_USER_ID, TEST_AUDIOBOOK);

    expect(result.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
        }),
      })
    );
    expect(jobQueueAddSearchJob).toHaveBeenCalled();
  });
});

describe('createRequestForUser — author blacklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueAddSearchJob.mockResolvedValue(undefined);
    jobQueueAddNotificationJob.mockResolvedValue(undefined);
    prismaMock.request.findFirst.mockResolvedValue(null);
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
    prismaMock.ignoredAudiobook.findFirst.mockResolvedValue(null);
    prismaMock.blockedAuthor.findFirst.mockResolvedValue(null);
    mockGetSiblingAsins.mockResolvedValue(new Map());
    mockSeedAsin.mockResolvedValue(undefined);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
    configServiceGet.mockResolvedValue(null);
  });

  it('blocks request when author is on the admin blacklist', async () => {
    prismaMock.blockedAuthor.findFirst.mockResolvedValueOnce({ id: 'ba-1' });

    const { createRequestForUser } = await import(
      '@/lib/services/request-creator.service'
    );
    const result = await createRequestForUser(TEST_USER_ID, TEST_AUDIOBOOK);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('author_blocked');
      expect(result.message).toBe(
        'This author is blocked by the administrator'
      );
    }
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });
});
