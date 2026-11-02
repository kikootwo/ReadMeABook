/**
 * Component: Request With Torrent, Existing Requests (#281, #291)
 * Documentation: documentation/admin-features/request-approval.md
 *
 * A pick from interactive search must never create a second active request for
 * a book. The request table is faked so each query only sees the rows its
 * `where` clause would match: a route that skips a check creates a request.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

type Row = Record<string, unknown>;

let authRequest: { user: { id: string; role: string }; json: () => Promise<unknown> };
let rows: Row[];

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) => handler(authRequest),
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: async () => null }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getAudiobookDetails: async () => null }),
}));
vi.mock('@/lib/integrations/prowlarr-connection', () => ({
  getProwlarrConnection: async () => ({
    baseUrl: 'http://prowlarr:9696',
    apiKey: 'test-prowlarr-key',
    base: { origin: 'http://prowlarr:9696', protocol: 'http:', hostname: 'prowlarr', host: 'prowlarr:9696', port: '9696', defaultPort: false, userinfo: '', basePath: '' },
  }),
}));
vi.mock('@/lib/middleware/interactive-search-access', () => ({
  denyWithoutInteractiveSearchAccess: async () => null,
}));

const BOOK = { id: 'ab-1', audibleAsin: 'B000000001', title: 'Title', author: 'Author' };
const PICK = {
  audiobook: { asin: BOOK.audibleAsin, title: BOOK.title, author: BOOK.author },
  torrent: { guid: 'guid', title: 'Torrent', size: 100, indexer: 'Indexer', downloadUrl: 'http://prowlarr:9696/1/download', publishDate: '2024-01-01' },
};

function matchesValue(value: unknown, rule: unknown): boolean {
  if (rule === undefined) return true;
  if (rule === null || typeof rule !== 'object') return value === rule;
  const { in: allowed, notIn, not } = rule as { in?: unknown[]; notIn?: unknown[]; not?: unknown };
  if (allowed && !allowed.includes(value)) return false;
  if (notIn && notIn.includes(value)) return false;
  if ('not' in rule && value === not) return false;
  return true;
}

/** Applies the subset of Prisma `where` the route uses to the fake request table. */
function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
  for (const [field, rule] of Object.entries(where)) {
    if (field === 'audiobook') {
      if (!matchesValue(BOOK.audibleAsin, (rule as { audibleAsin?: unknown }).audibleAsin)) return false;
      continue;
    }
    if (!matchesValue(row[field], rule)) return false;
  }
  return true;
}

function row(status: string, userId: string) {
  return { id: `req-${status}-${userId}`, audiobookId: BOOK.id, type: 'audiobook', status, userId, deletedAt: null, user: { plexUsername: userId } };
}

describe('request-with-torrent refuses a pick that duplicates an existing request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    authRequest = { user: { id: 'user-1', role: 'user' }, json: vi.fn().mockResolvedValue(PICK) };
    prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matchesWhere(r, where)) ?? null);
    prismaMock.audiobook.findFirst.mockResolvedValue(BOOK);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', autoApproveRequests: true, plexUsername: 'user-1' });
    prismaMock.request.create.mockResolvedValue({ id: 'req-new', audiobook: BOOK, user: { id: 'user-1', plexUsername: 'user-1' } });
  });

  async function pick() {
    const { POST } = await import('@/app/api/audiobooks/request-with-torrent/route');
    const response = await POST({} as never);
    return { status: response.status, body: await response.json() };
  }

  it.each([
    ['downloading', 'BeingProcessed', 'This audiobook is being processed and will be available soon'],
    ['processing', 'BeingProcessed', 'This audiobook is being processed and will be available soon'],
    ['awaiting_import', 'BeingProcessed', 'This audiobook is being processed and will be available soon'],
    ['awaiting_approval', 'AwaitingApproval', 'A request for this audiobook is already awaiting admin approval'],
  ])('own %s request → 409 %s, says what is happening, creates nothing (#291)', async (status, error, message) => {
    rows.push(row(status, 'user-1'));

    const result = await pick();

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error, message, requestStatus: status, isOwnRequest: true });
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('another user\'s downloading request → 409 BeingProcessed, not a second download', async () => {
    rows.push(row('downloading', 'user-2'));

    const result = await pick();

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: 'BeingProcessed', isOwnRequest: false });
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it.each(['pending', 'searching', 'awaiting_search', 'awaiting_release'])(
    'another user\'s %s request → 409 AlreadyRequested, creates nothing',
    async (status) => {
      rows.push(row(status, 'user-2'));

      const result = await pick();

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        error: 'AlreadyRequested',
        message: 'This audiobook is already being requested by another user',
        requestStatus: status,
      });
      expect(prismaMock.request.create).not.toHaveBeenCalled();
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    }
  );

  it('an available request says the book is in the library without naming a media server', async () => {
    rows.push(row('available', 'user-2'));

    const result = await pick();

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: 'AlreadyAvailable', message: 'This audiobook is already in your library' });
  });

  it('own pending request → 409 DuplicateRequest (pick it from My Requests instead)', async () => {
    rows.push(row('pending', 'user-1'));

    const result = await pick();

    expect(result.status).toBe(409);
    expect(result.body.error).toBe('DuplicateRequest');
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it.each(['failed', 'cancelled', 'denied'])(
    'another user\'s %s request does not block a new pick',
    async (status) => {
      rows.push(row(status, 'user-2'));

      const result = await pick();

      expect(result.status).toBe(201);
      expect(prismaMock.request.create).toHaveBeenCalledTimes(1);
      expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    }
  );
});
