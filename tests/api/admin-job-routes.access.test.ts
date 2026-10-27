/**
 * Component: Admin Job Routes — access rules (real auth middleware)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Every scheduled-job and job-status handler goes through requireAuth + requireAdmin:
 * the account must still exist, its sessions must not be revoked, and it must be an
 * admin. API tokens are refused (none of these routes is on the API-token allowlist).
 * A valid admin gets the same response as before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/** Issued-at (seconds) of every JWT the mocked verifier hands back. */
const ISSUED_AT = vi.hoisted(() => 1_700_000_000);

type UserRow = { id: string; deletedAt: Date | null; sessionsInvalidatedAt: Date | null };

const state = vi.hoisted(() => ({ users: {} as Record<string, UserRow> }));

const schedulerMock = vi.hoisted(() => ({
  getScheduledJobs: vi.fn(),
  createScheduledJob: vi.fn(),
  updateScheduledJob: vi.fn(),
  deleteScheduledJob: vi.fn(),
  triggerJobNow: vi.fn(),
}));
const jobQueueMock = vi.hoisted(() => ({ getJob: vi.fn() }));

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => state.users[where.id] ?? null,
    },
    apiToken: {
      findUnique: async () => ({
        id: 't1', tokenPrefix: 'rmab_abc', expiresAt: null, role: 'admin',
        tokenUser: { id: 'u-admin', plexId: 'p1', plexUsername: 'admin', role: 'admin', deletedAt: null },
      }),
      update: async () => ({}),
    },
  },
}));
vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: (token: string) =>
    token === 'admin-token' ? { sub: 'u-admin', role: 'admin', plexId: 'p1', username: 'admin', iat: ISSUED_AT }
      : token === 'user-token' ? { sub: 'u-user', role: 'user', plexId: 'p2', username: 'user', iat: ISSUED_AT }
      : null,
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('@/lib/services/scheduler.service', () => ({
  getSchedulerService: () => schedulerMock,
}));
vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function request(method: string, path: string, token?: string, body?: Record<string, unknown>) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body) headers.set('content-type', 'application/json');
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(body && { body: JSON.stringify(body) }),
  });
}

interface RouteCase {
  name: string;
  method: string;
  path: string;
  body?: Record<string, unknown>;
  call: (req: NextRequest) => Promise<Response>;
  service: ReturnType<typeof vi.fn>;
  expected: unknown;
}

const createdAt = new Date('2026-10-27T01:00:00.000Z');

const routes: RouteCase[] = [
  {
    name: 'GET /api/admin/jobs',
    method: 'GET',
    path: '/api/admin/jobs',
    call: async (req) => (await import('@/app/api/admin/jobs/route')).GET(req),
    service: schedulerMock.getScheduledJobs,
    expected: { jobs: [{ id: 'job-1' }] },
  },
  {
    name: 'POST /api/admin/jobs',
    method: 'POST',
    path: '/api/admin/jobs',
    body: { name: 'Job', type: 'plex_library_scan', schedule: '0 * * * *', enabled: true },
    call: async (req) => (await import('@/app/api/admin/jobs/route')).POST(req),
    service: schedulerMock.createScheduledJob,
    expected: { job: { id: 'job-2' } },
  },
  {
    name: 'PUT /api/admin/jobs/:id',
    method: 'PUT',
    path: '/api/admin/jobs/job-3',
    body: { name: 'Renamed', enabled: false },
    call: async (req) => (await import('@/app/api/admin/jobs/[id]/route')).PUT(req, params('job-3')),
    service: schedulerMock.updateScheduledJob,
    expected: { success: true, job: { id: 'job-3' } },
  },
  {
    name: 'DELETE /api/admin/jobs/:id',
    method: 'DELETE',
    path: '/api/admin/jobs/job-4',
    call: async (req) => (await import('@/app/api/admin/jobs/[id]/route')).DELETE(req, params('job-4')),
    service: schedulerMock.deleteScheduledJob,
    expected: { success: true, message: 'Job deleted successfully' },
  },
  {
    name: 'POST /api/admin/jobs/:id/trigger',
    method: 'POST',
    path: '/api/admin/jobs/job-5/trigger',
    call: async (req) => (await import('@/app/api/admin/jobs/[id]/trigger/route')).POST(req, params('job-5')),
    service: schedulerMock.triggerJobNow,
    expected: { success: true, jobId: 'db-job-5', message: 'Job triggered successfully' },
  },
  {
    name: 'GET /api/admin/job-status/:id',
    method: 'GET',
    path: '/api/admin/job-status/db-job-6',
    call: async (req) => (await import('@/app/api/admin/job-status/[id]/route')).GET(req, params('db-job-6')),
    service: jobQueueMock.getJob,
    expected: {
      success: true,
      job: {
        id: 'db-job-6', type: 'plex_library_scan', status: 'completed',
        createdAt: createdAt.toISOString(), startedAt: null, completedAt: null,
        result: { scanned: 3 }, errorMessage: null, attempts: 1, maxAttempts: 3,
      },
    },
  },
];

const send = (route: RouteCase, token?: string) =>
  route.call(request(route.method, route.path, token, route.body));

describe('admin job routes use the standard session checks', () => {
  beforeEach(() => {
    state.users = {
      'u-admin': { id: 'u-admin', deletedAt: null, sessionsInvalidatedAt: null },
      'u-user': { id: 'u-user', deletedAt: null, sessionsInvalidatedAt: null },
    };
    vi.clearAllMocks();
    schedulerMock.getScheduledJobs.mockResolvedValue([{ id: 'job-1' }]);
    schedulerMock.createScheduledJob.mockResolvedValue({ id: 'job-2' });
    schedulerMock.updateScheduledJob.mockResolvedValue({ id: 'job-3' });
    schedulerMock.deleteScheduledJob.mockResolvedValue(undefined);
    schedulerMock.triggerJobNow.mockResolvedValue('db-job-5');
    jobQueueMock.getJob.mockResolvedValue({
      id: 'db-job-6', type: 'plex_library_scan', status: 'completed',
      createdAt, startedAt: null, completedAt: null,
      result: { scanned: 3 }, errorMessage: null, attempts: 1, maxAttempts: 3,
    });
  });

  describe.each(routes)('$name', (route) => {
    it('refuses an admin whose account was deleted (401)', async () => {
      state.users['u-admin'].deletedAt = new Date('2026-10-26T00:00:00.000Z');

      const response = await send(route, 'admin-token');

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: 'Unauthorized' });
      expect(route.service).not.toHaveBeenCalled();
    });

    it('refuses an admin whose account row is gone (401)', async () => {
      delete state.users['u-admin'];

      const response = await send(route, 'admin-token');

      expect(response.status).toBe(401);
      expect(route.service).not.toHaveBeenCalled();
    });

    it('refuses an admin token issued before the sessions were revoked (401)', async () => {
      state.users['u-admin'].sessionsInvalidatedAt = new Date((ISSUED_AT + 60) * 1000);

      const response = await send(route, 'admin-token');

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: 'Unauthorized', message: 'Session has been revoked' });
      expect(route.service).not.toHaveBeenCalled();
    });

    it('refuses a signed-in non-admin (403)', async () => {
      const response = await send(route, 'user-token');

      expect(response.status).toBe(403);
      expect(route.service).not.toHaveBeenCalled();
    });

    it('refuses an API token, even an admin one (403)', async () => {
      const response = await send(route, 'rmab_abcdef0123456789');

      expect(response.status).toBe(403);
      expect(route.service).not.toHaveBeenCalled();
    });

    it('refuses a request with no token (401)', async () => {
      const response = await send(route);

      expect(response.status).toBe(401);
      expect(route.service).not.toHaveBeenCalled();
    });

    it('serves a valid admin with the same response as before', async () => {
      // Sessions revoked before this token was issued do not affect it
      state.users['u-admin'].sessionsInvalidatedAt = new Date((ISSUED_AT - 60) * 1000);

      const response = await send(route, 'admin-token');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(route.expected);
      expect(route.service).toHaveBeenCalledTimes(1);
    });
  });

  it('passes the request body and route id through unchanged', async () => {
    await send(routes[1], 'admin-token');
    expect(schedulerMock.createScheduledJob).toHaveBeenCalledWith({
      name: 'Job', type: 'plex_library_scan', schedule: '0 * * * *', enabled: true, payload: undefined,
    });

    await send(routes[2], 'admin-token');
    expect(schedulerMock.updateScheduledJob).toHaveBeenCalledWith('job-3', {
      name: 'Renamed', schedule: undefined, enabled: false, payload: undefined,
    });

    await send(routes[4], 'admin-token');
    expect(schedulerMock.triggerJobNow).toHaveBeenCalledWith('job-5');
  });
});
