/**
 * Component: Fetch Ebook by ASIN API Tests (characterisation)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Pins every branch of POST /api/audiobooks/[asin]/fetch-ebook: status codes, bodies, the
 * rows it writes and the jobs it queues. The request creation itself is shared with the
 * Discord bot, so these must hold with the logic inside the route or behind it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addSearchEbookJob: vi.fn(() => Promise.resolve()),
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));
const audibleMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn() }));
const matcherMock = vi.hoisted(() => ({ findPlexMatch: vi.fn() }));
const authState = vi.hoisted(() => ({ user: { id: 'user-1', role: 'user' } as { id: string; role: string } | null }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleMock }));
vi.mock('@/lib/utils/audiobook-matcher', () => matcherMock);
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: vi.fn((_req: unknown, handler: (req: unknown) => unknown) => handler({ user: authState.user })),
}));

const ASIN = 'B0ABCDE123';
const AUDIBLE = {
  asin: ASIN,
  title: 'The Book',
  author: 'Ann Author',
  narrator: 'Ned Narrator',
  description: 'About it',
  coverArtUrl: 'https://m.media-amazon.com/images/I/cover.jpg',
  releaseDate: '2021-06-01',
  series: 'The Series',
  seriesPart: '2',
};
const AUDIOBOOK = { id: 'ab-1', title: 'The Book', author: 'Ann Author', audibleAsin: ASIN };

type Config = Record<string, string | undefined>;

function setConfig(values: Config) {
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
    values[where.key] === undefined ? null : { key: where.key, value: values[where.key] }
  );
}

/** request.findFirst answers: the available audiobook request first, then the newest ebook request. */
function setRequests({ available = null, ebook = null }: { available?: unknown; ebook?: unknown }) {
  prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: { type: string } }) =>
    where.type === 'audiobook' ? available : ebook
  );
}

async function post(asin = ASIN) {
  const { POST } = await import('@/app/api/audiobooks/[asin]/fetch-ebook/route');
  const response = await POST({} as Parameters<typeof POST>[0], { params: Promise.resolve({ asin }) });
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { id: 'user-1', role: 'user' };
  setConfig({ ebook_annas_archive_enabled: 'true' });
  audibleMock.getAudiobookDetails.mockResolvedValue(AUDIBLE);
  matcherMock.findPlexMatch.mockResolvedValue(null);
  prismaMock.audiobook.findFirst.mockResolvedValue(AUDIOBOOK);
  setRequests({ available: { id: 'parent-1', customSearchTerms: null } });
  prismaMock.user.findUnique.mockResolvedValue({ role: 'admin', autoApproveRequests: null, plexUsername: 'alice' });
  prismaMock.request.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'ebook-new', ...args.data }));
  prismaMock.audiobook.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'ab-new', ...args.data }));
});

describe('POST /api/audiobooks/[asin]/fetch-ebook: route checks', () => {
  it.each(['', 'B0SHORT', 'B0ABCDE1234'])('ASIN %j → 400', async (asin) => {
    expect(await post(asin)).toEqual({ status: 400, body: { error: 'Valid ASIN is required' } });
    expect(prismaMock.configuration.findUnique).not.toHaveBeenCalled();
  });

  it('no user on the request → 401', async () => {
    authState.user = null;
    expect(await post()).toEqual({ status: 401, body: { error: 'Unauthorized' } });
  });
});

describe('POST /api/audiobooks/[asin]/fetch-ebook: sources', () => {
  it('no source enabled → 400', async () => {
    setConfig({});
    expect(await post()).toEqual({ status: 400, body: { error: 'E-book feature is not enabled (no sources configured)' } });
    expect(audibleMock.getAudiobookDetails).not.toHaveBeenCalled();
  });

  it('Anna\'s Archive key missing: the legacy sidecar key turns it on', async () => {
    setConfig({ ebook_sidecar_enabled: 'true' });
    expect((await post()).status).toBe(201);
  });

  it('Anna\'s Archive key "false" wins over the legacy key', async () => {
    setConfig({ ebook_annas_archive_enabled: 'false', ebook_sidecar_enabled: 'true' });
    expect((await post()).status).toBe(400);
  });

  it('indexer search alone is enough', async () => {
    setConfig({ ebook_indexer_search_enabled: 'true' });
    expect((await post()).status).toBe(201);
  });
});

describe('POST /api/audiobooks/[asin]/fetch-ebook: availability', () => {
  it.each([
    ['not found', () => audibleMock.getAudiobookDetails.mockResolvedValue(null)],
    ['lookup throws', () => audibleMock.getAudiobookDetails.mockRejectedValue(new Error('timeout'))],
  ])('Audible %s → 404', async (_label, arrange) => {
    arrange();
    expect(await post()).toEqual({ status: 404, body: { error: 'Audiobook not found on Audible' } });
  });

  it('no available audiobook request and no library match → 400', async () => {
    setRequests({ available: null });
    expect(await post()).toEqual({
      status: 400,
      body: { error: 'Audiobook must be available in your library before requesting an ebook' },
    });
    expect(matcherMock.findPlexMatch).toHaveBeenCalledWith({ asin: ASIN, title: 'The Book', author: 'Ann Author' });
  });

  it('the available-request lookup skips deleted requests', async () => {
    await post();
    expect(prismaMock.request.findFirst).toHaveBeenCalledWith({
      where: { audiobookId: 'ab-1', type: 'audiobook', status: { in: ['downloaded', 'available'] }, deletedAt: null },
    });
  });

  it('a book in the library but not in the database: the audiobook row is created (orphan)', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    matcherMock.findPlexMatch.mockResolvedValue({ plexGuid: 'plex-1' });
    prismaMock.request.findFirst.mockResolvedValue(null);

    const result = await post();

    expect(result.status).toBe(201);
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: {
        audibleAsin: ASIN,
        title: 'The Book',
        author: 'Ann Author',
        narrator: 'Ned Narrator',
        description: 'About it',
        coverArtUrl: AUDIBLE.coverArtUrl,
        year: 2021,
        series: 'The Series',
        seriesPart: '2',
        status: 'available',
      },
    });
    // No available request: no parent, no copied search terms
    expect(prismaMock.request.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ audiobookId: 'ab-new', parentRequestId: null, customSearchTerms: null }),
    });
  });

  it('an orphan with an unparsable release date gets no year', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    matcherMock.findPlexMatch.mockResolvedValue({ plexGuid: 'plex-1' });
    audibleMock.getAudiobookDetails.mockResolvedValue({ ...AUDIBLE, releaseDate: 'soon' });

    await post();

    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({ data: expect.objectContaining({ year: undefined }) });
  });
});

describe('POST /api/audiobooks/[asin]/fetch-ebook: an earlier ebook request', () => {
  it('the newest non-deleted ebook request is the one checked', async () => {
    await post();
    expect(prismaMock.request.findFirst).toHaveBeenCalledWith({
      where: { audiobookId: 'ab-1', type: 'ebook', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  });

  it.each(['pending', 'awaiting_approval', 'searching', 'downloading', 'processing', 'downloaded', 'available'])(
    'status %s → 409 with its id',
    async (status) => {
      setRequests({ available: { id: 'parent-1' }, ebook: { id: 'ebook-old', status } });
      expect(await post()).toEqual({
        status: 409,
        body: { success: false, message: `E-book request already exists (status: ${status})`, requestId: 'ebook-old' },
      });
      expect(prismaMock.request.create).not.toHaveBeenCalled();
    }
  );

  it.each(['failed', 'awaiting_search'])('status %s → reset to pending, search queued, 200', async (status) => {
    setRequests({ available: { id: 'parent-1' }, ebook: { id: 'ebook-old', status } });

    expect(await post()).toEqual({
      status: 200,
      body: { success: true, message: 'E-book search retried', requestId: 'ebook-old' },
    });
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'ebook-old' },
      data: { status: 'pending', progress: 0, errorMessage: null, updatedAt: expect.any(Date) },
    });
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith('ebook-old', {
      id: 'ab-1', title: 'The Book', author: 'Ann Author', asin: ASIN,
    });
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'denied'])('status %s → a new request is created', async (status) => {
    setRequests({ available: { id: 'parent-1' }, ebook: { id: 'ebook-old', status } });
    expect((await post()).status).toBe(201);
    expect(prismaMock.request.create).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/audiobooks/[asin]/fetch-ebook: approval and creation', () => {
  it('the account row is gone → 404', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    expect(await post()).toEqual({ status: 404, body: { error: 'User not found' } });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { role: true, autoApproveRequests: true, plexUsername: true },
    });
  });

  it('admin → pending, search queued, approved notification, 201', async () => {
    expect(await post()).toEqual({
      status: 201,
      body: { success: true, message: 'E-book request created and search started', requestId: 'ebook-new', needsApproval: false },
    });
    expect(prismaMock.request.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1', audiobookId: 'ab-1', type: 'ebook', parentRequestId: 'parent-1',
        status: 'pending', progress: 0, customSearchTerms: null,
      },
    });
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith('ebook-new', {
      id: 'ab-1', title: 'The Book', author: 'Ann Author', asin: ASIN,
    });
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith('request_approved', 'ebook-new', 'The Book (Ebook)', 'Ann Author', 'alice');
  });

  it('admin even with auto-approve off for the account → pending', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'admin', autoApproveRequests: false, plexUsername: 'alice' });
    expect((await post()).body.needsApproval).toBe(false);
  });

  it('user with auto-approve off → awaiting_approval, pending-approval notification, no search, 201', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: false, plexUsername: 'bob' });

    expect(await post()).toEqual({
      status: 201,
      body: { success: true, message: 'Ebook request submitted for admin approval', requestId: 'ebook-new', needsApproval: true },
    });
    expect(prismaMock.request.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', type: 'ebook', status: 'awaiting_approval' }),
    });
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith('request_pending_approval', 'ebook-new', 'The Book (Ebook)', 'Ann Author', 'bob');
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
  });

  it('user with auto-approve on → pending', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: true, plexUsername: 'bob' });
    setConfig({ ebook_annas_archive_enabled: 'true', auto_approve_requests: 'false' });
    expect((await post()).body.needsApproval).toBe(false);
  });

  it.each([
    ['global off', 'false', true],
    ['global on', 'true', false],
    ['global unset (defaults to on)', undefined, false],
  ])('user setting unset, %s', async (_label, global, needsApproval) => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: null, plexUsername: null });
    setConfig({ ebook_annas_archive_enabled: 'true', auto_approve_requests: global });

    const result = await post();

    expect(result.status).toBe(201);
    expect(result.body.needsApproval).toBe(needsApproval);
    const event = needsApproval ? 'request_pending_approval' : 'request_approved';
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(event, 'ebook-new', 'The Book (Ebook)', 'Ann Author', 'Unknown User');
  });

  it.each([
    ['auto-approved', { role: 'admin', autoApproveRequests: null, plexUsername: 'a' }],
    ['awaiting approval', { role: 'user', autoApproveRequests: false, plexUsername: 'b' }],
  ])('%s: the parent request and its custom search terms are copied', async (_label, user) => {
    prismaMock.user.findUnique.mockResolvedValue(user);
    setRequests({ available: { id: 'parent-9', customSearchTerms: 'book two' } });

    await post();

    expect(prismaMock.request.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ parentRequestId: 'parent-9', customSearchTerms: 'book two' }),
    });
  });

  it('a notification that fails to queue does not fail the request', async () => {
    jobQueueMock.addNotificationJob.mockRejectedValue(new Error('redis down'));
    expect((await post()).status).toBe(201);
  });

  it('an unexpected error → 500 with the error text (today\'s body)', async () => {
    prismaMock.request.create.mockRejectedValue(new Error("EACCES: permission denied, open '/srv/library/secret'"));
    expect(await post()).toEqual({
      status: 500,
      body: { error: "EACCES: permission denied, open '/srv/library/secret'" },
    });
  });

  it('a non-Error throw → 500 Internal server error', async () => {
    prismaMock.request.create.mockRejectedValue('boom');
    expect(await post()).toEqual({ status: 500, body: { error: 'Internal server error' } });
  });
});
