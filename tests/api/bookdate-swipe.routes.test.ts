/**
 * Component: BookDate Swipe Release-Date Gate Tests
 * Documentation: documentation/features/bookdate-prd.md
 *
 * Narrow coverage for the release-date gate on right-swipe request creation.
 * Broader swipe behavior is covered in tests/api/bookdate.routes.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;
const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const audibleServiceMock = vi.hoisted(() => ({
  getAudiobookDetails: vi.fn(),
}));
const configServiceGet = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn().mockResolvedValue(undefined),
  addNotificationJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: configServiceGet }),
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

function futureIso(days = 30): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function pastIso(days = 30): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('BookDate swipe — release-date gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueMock.addSearchJob.mockResolvedValue(undefined);
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    authRequest = { user: { id: 'user-1', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
  });

  it('creates request in awaiting_release with no search when unreleased + setting ON', async () => {
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-future', action: 'right', markedAsKnown: false });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-future',
      userId: 'user-1',
      title: 'Future Book',
      author: 'Future Author',
      audnexusAsin: 'ASIN-FUTURE',
    } as any);
    prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);
    audibleServiceMock.getAudiobookDetails.mockResolvedValueOnce({
      releaseDate: futureIso(45),
    });
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audiobook.create.mockResolvedValueOnce({
      id: 'ab-future',
      title: 'Future Book',
      author: 'Future Author',
      audibleAsin: 'ASIN-FUTURE',
    } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'admin',
      autoApproveRequests: null,
      plexUsername: 'admin',
    } as any);
    configServiceGet.mockResolvedValueOnce(null); // default → ON
    prismaMock.request.create.mockResolvedValueOnce({
      id: 'req-future',
      audiobook: { title: 'Future Book' },
      user: { id: 'user-1', plexUsername: 'admin' },
    } as any);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'awaiting_release',
          releaseDate: expect.any(Date),
        }),
      })
    );
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('creates pending request and runs search when released + setting ON', async () => {
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-past', action: 'right', markedAsKnown: false });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-past',
      userId: 'user-1',
      title: 'Old Book',
      author: 'Old Author',
      audnexusAsin: 'ASIN-PAST',
    } as any);
    prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);
    audibleServiceMock.getAudiobookDetails.mockResolvedValueOnce({
      releaseDate: pastIso(365),
    });
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audiobook.create.mockResolvedValueOnce({
      id: 'ab-past',
      title: 'Old Book',
      author: 'Old Author',
      audibleAsin: 'ASIN-PAST',
    } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'admin',
      autoApproveRequests: null,
      plexUsername: 'admin',
    } as any);
    configServiceGet.mockResolvedValueOnce('true');
    prismaMock.request.create.mockResolvedValueOnce({
      id: 'req-past',
      audiobook: { title: 'Old Book' },
      user: { id: 'user-1', plexUsername: 'admin' },
    } as any);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
        }),
      })
    );
    expect(jobQueueMock.addSearchJob).toHaveBeenCalled();
  });

  it('creates pending request and runs search when unreleased + setting OFF', async () => {
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-off', action: 'right', markedAsKnown: false });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-off',
      userId: 'user-1',
      title: 'Off Book',
      author: 'Off Author',
      audnexusAsin: 'ASIN-OFF',
    } as any);
    prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);
    audibleServiceMock.getAudiobookDetails.mockResolvedValueOnce({
      releaseDate: futureIso(45),
    });
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audiobook.create.mockResolvedValueOnce({
      id: 'ab-off',
      title: 'Off Book',
      author: 'Off Author',
      audibleAsin: 'ASIN-OFF',
    } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'admin',
      autoApproveRequests: null,
      plexUsername: 'admin',
    } as any);
    configServiceGet.mockResolvedValueOnce('false');
    prismaMock.request.create.mockResolvedValueOnce({
      id: 'req-off',
      audiobook: { title: 'Off Book' },
      user: { id: 'user-1', plexUsername: 'admin' },
    } as any);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
        }),
      })
    );
    expect(jobQueueMock.addSearchJob).toHaveBeenCalled();
  });

  it('returns 409 AuthorBlocked when author is blacklisted', async () => {
    authRequest.json.mockResolvedValue({
      recommendationId: 'rec-blocked',
      action: 'right',
      markedAsKnown: false,
    });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-blocked',
      userId: 'user-1',
      title: 'Blocked Book',
      author: 'Blocked Author',
      audnexusAsin: 'ASIN-BLOCKED',
    } as any);
    prismaMock.blockedAuthor.findFirst.mockResolvedValueOnce({ id: 'ba-1' });

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('AuthorBlocked');
    expect(payload.message).toBe(
      'This author is blocked by the administrator'
    );
    expect(prismaMock.bookDateSwipe.create).not.toHaveBeenCalled();
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });
});
