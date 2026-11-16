/**
 * Component: Admin Approve Route Tests (API token callers)
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * requireAuth is mocked to hand the route an API token caller (req.apiToken set, or only the
 * rmab_ bearer header) or a session. The request table is an in-memory fake, so answers, rows
 * and queued jobs are what a caller and the database would see.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { approvalDb } from '../helpers/approval-db-fake';

const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addStartDirectDownloadJob: vi.fn(),
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addNotificationJob: vi.fn(),
}));
const guardMock = vi.hoisted(() => ({ torrent: vi.fn(), ebook: vi.fn() }));
const releaseGateMock = vi.hoisted(() => vi.fn());
const caller = vi.hoisted(() => ({ extra: {} as Record<string, unknown> }));
const loggers = vi.hoisted(() => new Map<string, { info: any; debug: any; warn: any; error: any }>());
const decideSpy = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/db', async () => ({ prisma: (await import('../helpers/approval-db-fake')).approvalDb.prisma }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: Record<string, unknown>, handler: (req: unknown) => unknown) =>
    handler(Object.assign(req, { user: { id: 'admin-1', sub: 'admin-1', role: 'admin' } }, caller.extra)),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/release-gate', () => ({ shouldWaitForRelease: releaseGateMock }));
vi.mock('@/lib/services/download-selection-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/download-selection-guard')>()),
  guardTorrentSelection: guardMock.torrent,
  guardEbookSelection: guardMock.ebook,
}));
vi.mock('@/lib/services/request-approval.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/services/request-approval.service')>();
  return {
    ...real,
    decideRequestApproval: async (input: Record<string, unknown>) => {
      decideSpy.calls.push(input);
      return real.decideRequestApproval(input as never);
    },
  };
});
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: (name: string) => {
      if (!loggers.has(name)) loggers.set(name, { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() });
      return loggers.get(name);
    },
  },
}));

const TOKEN = { id: 'tok-1', name: 'Home automation', tokenPrefix: 'rmab_abc1234', canApproveRequests: true };
const USER_PICK = { guid: 'g-user', title: 'User Release', downloadUrl: 'magnet:?xt=urn:btih:user' };
const ADMIN_PICK = { guid: 'g-admin', title: 'Admin Release', downloadUrl: 'magnet:?xt=urn:btih:admin' };

const headers = (value: string) => ({ get: (name: string) => (name.toLowerCase() === 'authorization' ? value : null) });
const asToken = () => { caller.extra = { apiToken: { ...TOKEN }, headers: headers('Bearer rmab_abc1234deadbeef') }; };
const asHeaderOnlyToken = () => { caller.extra = { headers: headers('Bearer rmab_abc1234deadbeef') }; };
const asSession = () => { caller.extra = { headers: headers('Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig') }; };

const auditLines = () => (loggers.get('ApiTokenApproval')?.warn.mock.calls ?? []) as Array<[string, Record<string, unknown>]>;

async function post(body: unknown, id = 'req-1') {
  const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
  const response = await POST({ json: async () => body } as never, { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
}

describe('POST /api/admin/requests/[id]/approve (API token callers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approvalDb.reset();
    decideSpy.calls.length = 0;
    caller.extra = {};
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    releaseGateMock.mockResolvedValue(false);
    guardMock.torrent.mockImplementation(async (pick: unknown) => ({ ok: true, value: pick }));
    guardMock.ebook.mockImplementation(async (pick: unknown) => ({ ok: true, value: pick }));
  });

  it.each([['req.apiToken set', asToken], ['only the rmab_ bearer header', asHeaderOnlyToken]])(
    'deny is 403 with no row read and no service call (%s)',
    async (_label, arrange) => {
      arrange();
      approvalDb.seed();
      const result = await post({ action: 'deny' });

      expect(result).toEqual({
        status: 403,
        body: { error: 'Forbidden', message: 'API tokens can only approve requests. Deny in the web UI or in Discord.' },
      });
      expect(approvalDb.prisma.request.findFirst).not.toHaveBeenCalled();
      expect(decideSpy.calls).toHaveLength(0);
      expect(approvalDb.rows.get('req-1')!.status).toBe('awaiting_approval');
    }
  );

  it.each([[ADMIN_PICK], ['magnet:?xt=urn:btih:x'], [false], [''], [0], [[]]])(
    'a selectedTorrent of %j is 400 with no row read',
    async (selectedTorrent) => {
      asToken();
      approvalDb.seed();
      const result = await post({ action: 'approve', selectedTorrent });

      expect(result).toEqual({
        status: 400,
        body: { error: 'ValidationError', message: 'API tokens cannot choose a release. Leave out selectedTorrent.' },
      });
      expect(approvalDb.prisma.request.findFirst).not.toHaveBeenCalled();
      expect(decideSpy.calls).toHaveLength(0);
    }
  );

  it('the rmab_ header alone also refuses a named release', async () => {
    asHeaderOnlyToken();
    approvalDb.seed();
    expect((await post({ action: 'approve', selectedTorrent: ADMIN_PICK })).status).toBe(400);
    expect(decideSpy.calls).toHaveLength(0);
  });

  it('a null selectedTorrent counts as absent: the approval proceeds with no release passed', async () => {
    asToken();
    approvalDb.seed();
    const result = await post({ action: 'approve', selectedTorrent: null });

    expect(result.status).toBe(200);
    expect(decideSpy.calls).toEqual([expect.objectContaining({ adminSelectedTorrent: undefined, via: 'api_token' })]);
  });

  it('a stored pick that passes the guard: 200 "pre-selected torrent", download queued, pick cleared', async () => {
    asToken();
    approvalDb.seed({ selectedTorrent: USER_PICK });
    const result = await post({ action: 'approve' });

    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Request approved and download started with pre-selected torrent');
    expect(approvalDb.rows.get('req-1')).toMatchObject({ status: 'downloading', selectedTorrent: null });
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('req-1', expect.any(Object), USER_PICK);
    expect(decideSpy.calls).toEqual([
      { requestId: 'req-1', action: 'approve', adminId: 'admin-1', adminSelectedTorrent: undefined, via: 'api_token' },
    ]);
  });

  it('a stored pick the guard refuses: a search starts and selectionDropped says why', async () => {
    asToken();
    approvalDb.seed({ selectedTorrent: USER_PICK });
    guardMock.torrent.mockResolvedValue({ ok: false, error: 'Download link is not allowed' });
    const result = await post({ action: 'approve' });

    expect(result.status).toBe(200);
    expect(result.body.selectionDropped).toBe('Download link is not allowed');
    expect(approvalDb.rows.get('req-1')).toMatchObject({ status: 'pending', selectedTorrent: null });
    expect(jobQueueMock.addSearchJob).toHaveBeenCalled();
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('two token approvals at the same moment: one 200, one 400 InvalidStatus, one job', async () => {
    asToken();
    approvalDb.seed();
    const results = await Promise.all([post({ action: 'approve' }), post({ action: 'approve' })]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(results.find((r) => r.status === 400)!.body.error).toBe('InvalidStatus');
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
  });

  describe('audit', () => {
    it.each([
      ['approved', () => approvalDb.seed(), 'req-1', 'pending'],
      ['not_found', () => undefined, 'req-missing', null],
      ['invalid_status', () => approvalDb.seed({ status: 'downloading' }), 'req-1', 'downloading'],
    ] as const)('one warn line after the outcome: %s', async (outcome, arrange, id, status) => {
      asToken();
      arrange();
      await post({ action: 'approve' }, id);

      expect(auditLines()).toEqual([[
        'API token request approval',
        { requestId: id, outcome, status, tokenId: 'tok-1', tokenPrefix: 'rmab_abc1234', tokenName: 'Home automation', adminId: 'admin-1', via: 'api_token' },
      ]]);
    });

    it('one warn line when the source is unreachable and when the approval throws', async () => {
      asToken();
      approvalDb.seed({ type: 'ebook', selectedTorrent: { source: 'annas_archive', md5: 'm' } });
      guardMock.ebook.mockResolvedValue({ ok: false, error: 'Try again later', retryable: true });
      expect((await post({ action: 'approve' })).status).toBe(503);
      expect(auditLines().map(([, m]) => m.outcome)).toEqual(['source_unavailable']);

      approvalDb.reset();
      approvalDb.seed();
      jobQueueMock.addSearchJob.mockRejectedValue(new Error('redis down'));
      expect((await post({ action: 'approve' })).status).toBe(500);
      expect(auditLines().map(([, m]) => m.outcome)).toEqual(['source_unavailable', 'error']);
    });

    it('refusals are audited too (deny, named release)', async () => {
      asToken();
      approvalDb.seed();
      await post({ action: 'deny' });
      await post({ action: 'approve', selectedTorrent: ADMIN_PICK });
      expect(auditLines().map(([, m]) => m.outcome)).toEqual(['refused_deny', 'refused_release']);
    });

    it('the message does not depend on the token name or the request id', async () => {
      caller.extra = { apiToken: { ...TOKEN, name: 'line one\nline two' }, headers: headers('Bearer rmab_x') };
      await post({ action: 'approve' }, 'id\nwith a newline');

      const [[message, metadata]] = auditLines();
      expect(message).toBe('API token request approval');
      expect(metadata).toMatchObject({ tokenName: 'line one\nline two', requestId: 'id\nwith a newline', outcome: 'not_found' });
    });

    it('sessions write no audit line', async () => {
      asSession();
      approvalDb.seed();
      await post({ action: 'approve' });
      expect(auditLines()).toEqual([]);
    });
  });

  describe('sessions are unchanged', () => {
    it('a session admin pick reaches the service and downloads it', async () => {
      asSession();
      approvalDb.seed({ selectedTorrent: USER_PICK });
      const result = await post({ action: 'approve', selectedTorrent: ADMIN_PICK });

      expect(result.status).toBe(200);
      expect(result.body.message).toBe('Request approved and download started with admin-selected torrent');
      expect(decideSpy.calls).toEqual([expect.objectContaining({ adminSelectedTorrent: ADMIN_PICK, via: 'web' })]);
    });

    it('a session deny is still 200 Request denied', async () => {
      asSession();
      approvalDb.seed();
      const result = await post({ action: 'deny' });

      expect(result.status).toBe(200);
      expect(result.body.message).toBe('Request denied');
      expect(approvalDb.rows.get('req-1')!.status).toBe('denied');
    });
  });
});
