/**
 * Component: Discord Updates Never Delay Their Caller (cancel, delete, replace)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * With the bot running and every Discord card update hanging forever, the web cancel (the cancel
 * route and the legacy PATCH), the admin delete (with and without keepLibrary) and the reported
 * issue replace (which deletes the old request) still answer at once: the cancel and delete
 * services only start the update through the running-check facade and never wait on it.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = vi.hoisted(() => ({ value: null as unknown as ReturnType<typeof createPrismaMock> & { reportedIssue: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } } }));
const auth = vi.hoisted(() => ({ user: { id: 'user-1', sub: 'user-1', role: 'user' } }));
const hang = vi.hoisted(() => ({ refresh: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn(), addDownloadJob: vi.fn() }));

vi.mock('@/lib/db', async () => {
  const { createPrismaMock: create } = await import('../helpers/prisma');
  prismaMock.value = { ...create(), reportedIssue: { findUnique: vi.fn(), update: vi.fn() } } as never;
  return { prisma: prismaMock.value };
});
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: object, handler: (req: unknown) => unknown) => handler(Object.assign(req, { user: auth.user })),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
// The download step and the file, download-client and library work have their own tests
vi.mock('@/lib/services/cancelled-download', () => ({
  newestSelectedRow: async () => null,
  handleCancelledDownload: async () => ({ outcome: 'none', detail: 'no download' }),
}));
vi.mock('@/lib/services/request-delete-files', () => ({
  audiobookFolderKeptReason: async () => null,
  removeAudiobookFolder: async () => ({ kind: 'gone' }),
  removeEbookFiles: async () => ({ deleted: 0 }),
  deleteBackendItem: async () => undefined,
  deleteLibraryRecords: async () => undefined,
  describeKept: () => '',
}));
vi.mock('@/lib/services/request-delete-download', () => ({
  cleanUpRequestDownload: async () => ({}),
  emptyDownloadCleanupCounts: () => ({ torrentsRemoved: 0, torrentsKeptSeeding: 0, torrentsKeptUnlimited: 0, torrentsKeptShared: 0, torrentsKeptNotOwned: 0 }),
}));
vi.mock('@/lib/services/request-delete-children', () => ({
  findChildRequests: async () => ({ delivered: [], undelivered: [], survivorFolder: null }),
  keepDeliveredChildren: async () => undefined,
  clearRemovedEbookFolder: async () => undefined,
  hasDeliveredEbookRequest: async () => false,
}));
vi.mock('@/lib/utils/delete-touches-library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/delete-touches-library')>()),
  deleteTouchesLibrary: () => false,
}));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ getBackendMode: async () => 'audiobookshelf', get: async () => null }) }));
// The bot is "running"; its service and every card update hang forever
vi.mock('@/lib/services/discord/discord-bot.service', () => ({ getDiscordBotService: () => ({ getClient: () => null }) }));
vi.mock('@/lib/services/discord/cards/discord-cards', () => ({ refreshRequestCards: hang.refresh, announceRequest: hang.refresh }));
vi.mock('@/lib/utils/logger', () => {
  const log = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return { RMABLogger: { create: log, forJob: log } };
});

const ID = '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a';
const FAST_MS = 1000;
const audiobook = {
  id: 'ab-1', title: 'Book', author: 'Author', narrator: null, audibleAsin: 'B0TEST0001', plexGuid: null,
  absItemId: null, filePath: null, fileFormat: null, filesHash: null, coverArtUrl: null,
};
/** One row shape that serves every read on these paths. */
const requestRow = () => ({
  id: ID, userId: 'user-1', status: 'downloading', type: 'audiobook', audiobookId: 'ab-1', completedAt: null,
  placedEbookFiles: null, approvalBypassedBy: null, explicit: false, audiobook, downloadHistory: [],
  user: { id: 'user-1', plexUsername: 'reader', deletedAt: null, registrationStatus: 'approved' },
});

/** Resolves with the outcome, or 'timed out' if `work` takes longer than FAST_MS. */
async function withinBudget<T>(work: Promise<T>): Promise<T | 'timed out'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timed out'>((resolve) => {
    timer = setTimeout(() => resolve('timed out'), FAST_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const params = { params: Promise.resolve({ id: ID }) };

const paths: Record<string, () => Promise<unknown>> = {
  'owner cancel (POST /api/requests/[id]/cancel)': async () => {
    const { POST } = await import('@/app/api/requests/[id]/cancel/route');
    return (await POST({} as never, params)).status;
  },
  'legacy cancel (PATCH /api/requests/[id])': async () => {
    const { PATCH } = await import('@/app/api/requests/[id]/route');
    return (await PATCH({ json: async () => ({ action: 'cancel' }) } as never, params)).status;
  },
  'admin delete (DELETE /api/admin/requests/[id])': async () => {
    const { DELETE } = await import('@/app/api/admin/requests/[id]/route');
    return (await DELETE({ nextUrl: new URL('http://rmab.local/api/admin/requests/x') } as never, params)).status;
  },
  'admin bulk delete (DELETE /api/admin/requests/[id]?keepLibrary=1)': async () => {
    const { DELETE } = await import('@/app/api/admin/requests/[id]/route');
    return (await DELETE({ nextUrl: new URL('http://rmab.local/api/admin/requests/x?keepLibrary=1') } as never, params)).status;
  },
  'reported issue replace (deletes the old request)': async () => {
    const { replaceAudiobook } = await import('@/lib/services/reported-issue.service');
    const result = await replaceAudiobook('issue-1', 'admin-1', { guid: 't' });
    return result.request.id === 'req-new' ? 200 : 500;
  },
};

describe('Discord card updates never delay a cancel or a delete', () => {
  // Load the modules once up front, so the budget below measures the calls, not a cold import
  beforeAll(async () => {
    await import('@/app/api/requests/[id]/cancel/route');
    await import('@/app/api/requests/[id]/route');
    await import('@/app/api/admin/requests/[id]/route');
    await import('@/lib/services/reported-issue.service');
    await import('@/lib/services/request-delete.service');
  }, 60000);

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = prismaMock.value;
    db.request.findFirst.mockResolvedValue(requestRow());
    db.request.updateMany.mockResolvedValue({ count: 1 });
    db.request.update.mockResolvedValue({});
    db.request.count.mockResolvedValue(0);
    db.request.create.mockResolvedValue({ id: 'req-new', audiobook, user: { id: 'user-1', plexUsername: 'reader' } });
    db.audiobook.update.mockResolvedValue({});
    db.reportedIssue.findUnique.mockResolvedValue({ id: 'issue-1', status: 'open', audiobook });
    db.reportedIssue.update.mockResolvedValue({});
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    jobQueueMock.addDownloadJob.mockResolvedValue(undefined);
    hang.refresh.mockImplementation(() => new Promise(() => undefined));
    const { setDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');
    setDiscordBotRunning(true);
  });

  it.each(Object.keys(paths))('%s answers at once while the Discord update hangs', async (label) => {
    expect(await withinBudget(paths[label]())).toBe(200);
    await vi.waitFor(() => expect(hang.refresh).toHaveBeenCalledWith(expect.anything(), ID));
    expect(hang.refresh).toHaveBeenCalledTimes(1);
  });
});
