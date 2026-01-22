/**
 * Component: Admin Jobs API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyAccessTokenMock = vi.hoisted(() => vi.fn());
const schedulerMock = vi.hoisted(() => ({
  getScheduledJobs: vi.fn(),
  createScheduledJob: vi.fn(),
  updateScheduledJob: vi.fn(),
  deleteScheduledJob: vi.fn(),
  triggerJobNow: vi.fn(),
}));

vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: verifyAccessTokenMock,
}));

vi.mock('@/lib/services/scheduler.service', () => ({
  getSchedulerService: () => schedulerMock,
}));

const makeRequest = (token?: string, body?: any) => ({
  headers: {
    get: (key: string) => (key.toLowerCase() === 'authorization' ? token : null),
  },
  json: vi.fn().mockResolvedValue(body || {}),
});

describe('Admin jobs routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAccessTokenMock.mockReturnValue({ role: 'admin' });
  });

  it('lists scheduled jobs', async () => {
    schedulerMock.getScheduledJobs.mockResolvedValue([{ id: 'job-1' }]);
    const { GET } = await import('@/app/api/admin/jobs/route');

    const response = await GET(makeRequest('Bearer token') as any);
    const payload = await response.json();

    expect(payload.jobs).toHaveLength(1);
  });

  it('rejects job list when missing token', async () => {
    const { GET } = await import('@/app/api/admin/jobs/route');
    const response = await GET(makeRequest() as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('rejects job list for non-admin users', async () => {
    verifyAccessTokenMock.mockReturnValue({ role: 'user' });
    const { GET } = await import('@/app/api/admin/jobs/route');
    const response = await GET(makeRequest('Bearer token') as any);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/Admin access required/);
  });

  it('returns 500 when job list fails', async () => {
    schedulerMock.getScheduledJobs.mockRejectedValue(new Error('boom'));
    const { GET } = await import('@/app/api/admin/jobs/route');
    const response = await GET(makeRequest('Bearer token') as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('InternalError');
  });

  it('creates a scheduled job', async () => {
    schedulerMock.createScheduledJob.mockResolvedValue({ id: 'job-2' });
    const { POST } = await import('@/app/api/admin/jobs/route');

    const response = await POST(makeRequest('Bearer token', { name: 'Job', type: 'type', schedule: '* * * * *' }) as any);
    const payload = await response.json();

    expect(payload.job.id).toBe('job-2');
  });

  it('rejects job creation when missing token', async () => {
    const { POST } = await import('@/app/api/admin/jobs/route');
    const response = await POST(makeRequest() as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('rejects job creation for non-admin users', async () => {
    verifyAccessTokenMock.mockReturnValue({ role: 'user' });
    const { POST } = await import('@/app/api/admin/jobs/route');
    const response = await POST(makeRequest('Bearer token') as any);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/Admin access required/);
  });

  it('returns 500 when job creation fails', async () => {
    schedulerMock.createScheduledJob.mockRejectedValue(new Error('create failed'));
    const { POST } = await import('@/app/api/admin/jobs/route');
    const response = await POST(makeRequest('Bearer token', { name: 'Job' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.message).toMatch(/create failed/);
  });

  it('updates a scheduled job', async () => {
    schedulerMock.updateScheduledJob.mockResolvedValue({ id: 'job-3' });
    const { PUT } = await import('@/app/api/admin/jobs/[id]/route');

    const response = await PUT(makeRequest('Bearer token', { name: 'Job' }) as any, { params: Promise.resolve({ id: 'job-3' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
  });

  it('rejects job updates when missing token', async () => {
    const { PUT } = await import('@/app/api/admin/jobs/[id]/route');
    const response = await PUT(makeRequest() as any, { params: Promise.resolve({ id: 'job-3' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('rejects job updates for non-admin users', async () => {
    verifyAccessTokenMock.mockReturnValue({ role: 'user' });
    const { PUT } = await import('@/app/api/admin/jobs/[id]/route');
    const response = await PUT(makeRequest('Bearer token') as any, { params: Promise.resolve({ id: 'job-3' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/Admin access required/);
  });

  it('returns 500 when job update fails', async () => {
    schedulerMock.updateScheduledJob.mockRejectedValue(new Error('update failed'));
    const { PUT } = await import('@/app/api/admin/jobs/[id]/route');
    const response = await PUT(makeRequest('Bearer token', { name: 'Job' }) as any, { params: Promise.resolve({ id: 'job-3' }) });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.message).toMatch(/update failed/);
  });

  it('deletes a scheduled job', async () => {
    schedulerMock.deleteScheduledJob.mockResolvedValue(undefined);
    const { DELETE } = await import('@/app/api/admin/jobs/[id]/route');

    const response = await DELETE(makeRequest('Bearer token') as any, { params: Promise.resolve({ id: 'job-4' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
  });

  it('rejects job deletion when missing token', async () => {
    const { DELETE } = await import('@/app/api/admin/jobs/[id]/route');
    const response = await DELETE(makeRequest() as any, { params: Promise.resolve({ id: 'job-4' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('rejects job deletion for non-admin users', async () => {
    verifyAccessTokenMock.mockReturnValue({ role: 'user' });
    const { DELETE } = await import('@/app/api/admin/jobs/[id]/route');
    const response = await DELETE(makeRequest('Bearer token') as any, { params: Promise.resolve({ id: 'job-4' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/Admin access required/);
  });

  it('returns 500 when job deletion fails', async () => {
    schedulerMock.deleteScheduledJob.mockRejectedValue(new Error('delete failed'));
    const { DELETE } = await import('@/app/api/admin/jobs/[id]/route');
    const response = await DELETE(makeRequest('Bearer token') as any, { params: Promise.resolve({ id: 'job-4' }) });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.message).toMatch(/delete failed/);
  });

  it('triggers a scheduled job', async () => {
    schedulerMock.triggerJobNow.mockResolvedValue('job-5');
    const { POST } = await import('@/app/api/admin/jobs/[id]/trigger/route');

    const response = await POST(makeRequest('Bearer token') as any, { params: Promise.resolve({ id: 'job-5' }) });
    const payload = await response.json();

    expect(payload.jobId).toBe('job-5');
  });
});


