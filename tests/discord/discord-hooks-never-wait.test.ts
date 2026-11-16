/**
 * Component: Discord Updates Never Delay Their Caller (approve, deny, notifications)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * With the bot running and every Discord update hanging forever, the web approve and deny,
 * and the notification job still finish at once (the organize job: organize-files.discord-cards.test.ts): each hook only starts the
 * update through the running-check facade and never waits on it.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, resetFakeDb, seedRequest } from './approval-db-fake';

const db = vi.hoisted(() => ({ rows: new Map(), histories: [], hooks: {} }) as ReturnType<typeof createFakeDb>);
const hang = vi.hoisted(() => ({ decision: vi.fn(), refresh: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addDownloadJob: vi.fn(),
  addStartDirectDownloadJob: vi.fn(),
  addNotificationJob: vi.fn(),
}));
const notificationService = vi.hoisted(() => ({ sendNotification: vi.fn() }));

vi.mock('@/lib/db', async () => (await import('./approval-db-fake')).fakePrisma(db));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) => handler({ user: { id: 'admin-1', sub: 'admin-1', role: 'admin' } }),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/release-gate', () => ({ shouldWaitForRelease: async () => false }));
vi.mock('@/lib/services/download-selection-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/download-selection-guard')>()),
  guardTorrentSelection: async (pick: unknown) => ({ ok: true, value: pick }),
}));
vi.mock('@/lib/services/notification', () => ({ getNotificationService: () => notificationService }));
// The bot is "running"; its service and every card update hang forever
vi.mock('@/lib/services/discord/discord-bot.service', () => ({ getDiscordBotService: () => ({ getClient: () => null }) }));
vi.mock('@/lib/services/discord/cards/discord-decision-sync', () => ({ syncApprovalDecision: hang.decision }));
vi.mock('@/lib/services/discord/cards/discord-cards', () => ({ refreshRequestCards: hang.refresh, announceRequest: hang.refresh }));
vi.mock('@/lib/utils/logger', () => {
  const log = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return { RMABLogger: { create: log, forJob: log } };
});

const ID = '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a';
const FAST_MS = 1000;

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

async function approveRoute(action: 'approve' | 'deny') {
  const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
  const response = await POST({ json: async () => ({ action }) } as never, { params: Promise.resolve({ id: ID }) });
  return response.status;
}

describe('Discord hooks never delay their caller', () => {
  // Load the modules once up front, so the budget below measures the calls, not a cold import
  beforeAll(async () => {
    await import('@/app/api/admin/requests/[id]/approve/route');
    await import('@/lib/processors/send-notification.processor');
  }, 60000);

  beforeEach(async () => {
    vi.clearAllMocks();
    resetFakeDb(db);
    hang.decision.mockImplementation(() => new Promise(() => undefined));
    hang.refresh.mockImplementation(() => new Promise(() => undefined));
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    notificationService.sendNotification.mockResolvedValue(undefined);
    const { setDiscordBotRunning } = await import('@/lib/services/discord/discord-runtime');
    setDiscordBotRunning(true);
  });

  it.each([
    ['web approve (search)', 'approve', {}],
    ['web approve (stored pick, download)', 'approve', { selectedTorrent: { downloadUrl: 'magnet:?xt=urn:btih:abc' } }],
    ['web deny', 'deny', {}],
  ] as const)('%s answers at once while the Discord update hangs', async (_label, action, row) => {
    seedRequest(db, row);

    expect(await withinBudget(approveRoute(action))).toBe(200);
    await vi.waitFor(() => expect(hang.decision).toHaveBeenCalledTimes(1));
    expect(hang.decision.mock.calls[0][1]).toBe(ID);
  });

  it('the notification job finishes at once while the card refresh hangs', async () => {
    const { processSendNotification } = await import('@/lib/processors/send-notification.processor');
    const work = processSendNotification({ event: 'request_available', requestId: ID, title: 'T', author: 'A', userName: 'u' } as never);

    expect(await withinBudget(work)).toBeUndefined();
    await vi.waitFor(() => expect(hang.refresh).toHaveBeenCalledWith(expect.anything(), ID));
  });

  it('a notification without a request starts no refresh', async () => {
    const { processSendNotification } = await import('@/lib/processors/send-notification.processor');
    await processSendNotification({ event: 'issue_reported', issueId: 'i-1', title: 'T', author: 'A', userName: 'u' } as never);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hang.refresh).not.toHaveBeenCalled();
  });

  it('the bot off: the hooks load nothing and start nothing', async () => {
    const { setDiscordBotRunning, refreshDiscordRequestCards, syncDiscordApprovalDecision } = await import('@/lib/services/discord/discord-runtime');
    setDiscordBotRunning(false);
    refreshDiscordRequestCards(ID);
    syncDiscordApprovalDecision(ID, 'denied');
    seedRequest(db);
    expect(await approveRoute('deny')).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hang.refresh).not.toHaveBeenCalled();
    expect(hang.decision).not.toHaveBeenCalled();
  });
});
