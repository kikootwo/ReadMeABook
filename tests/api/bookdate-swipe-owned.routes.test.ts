/**
 * Component: BookDate Swipe Library Check Tests (#287)
 * Documentation: documentation/features/bookdate-prd.md
 *
 * A right swipe runs the two ownership checks of POST /api/requests (createRequestForUser) before it
 * creates a request: any user's downloaded/available request for the ASIN, then the library (real
 * findPlexMatch over plex_library). The response says whether a request was created and, if not, why.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;
const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const audibleServiceMock = vi.hoisted(() => ({
  getAudiobookDetails: vi.fn(),
}));
const configServiceGet = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(),
  addNotificationJob: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock, requireAdmin: vi.fn() }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleServiceMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: configServiceGet }) }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));

const ASIN = 'B0OWNED001';
const RECOMMENDATION = {
  id: 'rec-owned',
  userId: 'user-1',
  title: 'Owned Book',
  author: 'Owned Author',
  narrator: 'Owned Narrator',
  audnexusAsin: ASIN,
};

/** Rows request.findFirst answers: the cross-user active check (status filter) vs the same-user check. */
const requests = { active: null as any, sameUser: null as any };

/** Everything the creation path needs, so that only the checks under test can stop request.create. */
function mockCreationPath() {
  prismaMock.audiobook.findFirst.mockResolvedValue(null);
  prismaMock.audiobook.create.mockResolvedValue({ id: 'ab-1', title: 'Owned Book', author: 'Owned Author', audibleAsin: ASIN } as any);
  prismaMock.user.findUnique.mockResolvedValue({ role: 'admin', autoApproveRequests: null, plexUsername: 'u' } as any);
  prismaMock.request.create.mockResolvedValue({ id: 'req-1' } as any);
}

async function swipeRight() {
  authRequest.json.mockResolvedValue({ recommendationId: RECOMMENDATION.id, action: 'right', markedAsKnown: false });
  prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({ ...RECOMMENDATION } as any);
  prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);
  const { POST } = await import('@/app/api/bookdate/swipe/route');
  const response = await POST({} as any);
  return { status: response.status, payload: await response.json() };
}

describe('BookDate swipe: library and active-request checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.active = null;
    requests.sameUser = null;
    prismaMock.request.findFirst.mockImplementation(async (args: any) =>
      (args?.where?.status ? requests.active : requests.sameUser));
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    jobQueueMock.addSearchJob.mockResolvedValue(undefined);
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    configServiceGet.mockResolvedValue(null);
    audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
    authRequest = { user: { id: 'user-1', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    mockCreationPath();
  });

  it('creates no request when the ASIN is already in the library', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([
      { plexGuid: 'abs-item-1', plexRatingKey: 'abs-item-1', title: 'Owned Book', author: 'Owned Author', asin: ASIN },
    ]);

    const { status, payload } = await swipeRight();

    expect(status).toBe(200);
    expect(payload).toEqual({
      success: true, action: 'right', markedAsKnown: false,
      requestCreated: false, reason: 'alreadyInLibrary', alreadyInLibrary: true,
    });
    expect(prismaMock.bookDateSwipe.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.plexLibrary.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ asin: ASIN }, { plexGuid: { contains: ASIN } }] },
    }));
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.create).not.toHaveBeenCalled();
    expect(audibleServiceMock.getAudiobookDetails).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it.each(['downloaded', 'available'])('creates no request when another user\'s request is already %s', async (state) => {
    requests.active = { id: 'req-other-user', status: state };

    const { status, payload } = await swipeRight();

    expect(status).toBe(200);
    expect(payload).toMatchObject({ success: true, requestCreated: false, reason: 'alreadyRequested', alreadyInLibrary: false });
    expect(prismaMock.request.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        audiobook: { audibleAsin: ASIN },
        type: 'audiobook',
        status: { in: ['downloaded', 'available'] },
        deletedAt: null,
      },
    }));
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('creates the request when the book is neither owned nor already requested', async () => {
    const { status, payload } = await swipeRight();

    expect(status).toBe(200);
    expect(payload).toEqual({ success: true, action: 'right', markedAsKnown: false, requestCreated: true, alreadyInLibrary: false });
    expect(prismaMock.request.create).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
  });

  it('reports alreadyRequested when this user already has a request for the book', async () => {
    requests.sameUser = { id: 'req-mine' };

    const { payload } = await swipeRight();

    expect(payload).toMatchObject({ requestCreated: false, reason: 'alreadyRequested' });
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('fails closed: a failing library check records the swipe and creates no request', async () => {
    prismaMock.plexLibrary.findMany.mockRejectedValue(new Error('db down'));

    const { status, payload } = await swipeRight();

    expect(status).toBe(200);
    expect(payload).toEqual({
      success: true, action: 'right', markedAsKnown: false,
      requestCreated: false, reason: 'libraryCheckFailed', alreadyInLibrary: false,
    });
    expect(prismaMock.bookDateSwipe.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.audiobook.create).not.toHaveBeenCalled();
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('fails closed: a failing active-request check creates no request', async () => {
    prismaMock.request.findFirst.mockRejectedValue(new Error('db down'));

    const { payload } = await swipeRight();

    expect(payload).toMatchObject({ requestCreated: false, reason: 'libraryCheckFailed' });
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('reports requestFailed when creating the request throws', async () => {
    prismaMock.request.create.mockRejectedValue(new Error('insert failed'));

    const { status, payload } = await swipeRight();

    expect(status).toBe(200);
    expect(payload).toMatchObject({ success: true, requestCreated: false, reason: 'requestFailed' });
  });

  it('left swipes report no request and no reason', async () => {
    authRequest.json.mockResolvedValue({ recommendationId: RECOMMENDATION.id, action: 'left', markedAsKnown: false });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({ ...RECOMMENDATION } as any);
    prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);
    const { POST } = await import('@/app/api/bookdate/swipe/route');

    const payload = await (await POST({} as any)).json();

    expect(payload).toEqual({ success: true, action: 'left', markedAsKnown: false, requestCreated: false, alreadyInLibrary: false });
    expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
  });
});
