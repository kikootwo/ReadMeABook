/**
 * Component: Admin Job Status API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyAccessTokenMock = vi.hoisted(() => vi.fn());
const jobQueueMock = vi.hoisted(() => ({ getJob: vi.fn() }));

vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: verifyAccessTokenMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

const makeRequest = (token?: string) => ({
  headers: {
    get: (key: string) => (key.toLowerCase() === 'authorization' ? token : null),
  },
});

describe('Admin job status route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing authorization', async () => {
    const { GET } = await import('@/app/api/admin/job-status/[id]/route');
    const response = await GET(makeRequest() as any, { params: Promise.resolve({ id: '1' }) });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns job status for admin token', async () => {
    verifyAccessTokenMock.mockReturnValue({ role: 'admin' });
    jobQueueMock.getJob.mockResolvedValue({
      id: '1',
      type: 'search',
      status: 'completed',
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      result: null,
      errorMessage: null,
      attempts: 1,
      maxAttempts: 3,
    });

    const { GET } = await import('@/app/api/admin/job-status/[id]/route');
    const response = await GET(makeRequest('Bearer token') as any, { params: Promise.resolve({ id: '1' }) });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.job.status).toBe('completed');
  });

  it('rejects non-admin tokens', async () => {
    verifyAccessTokenMock.mockReturnValue({ role: 'user' });

    const { GET } = await import('@/app/api/admin/job-status/[id]/route');
    const response = await GET(makeRequest('Bearer token') as any, { params: Promise.resolve({ id: '1' }) });
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/Admin access required/);
  });

  it('returns 404 when job is missing', async () => {
    verifyAccessTokenMock.mockReturnValue({ role: 'admin' });
    jobQueueMock.getJob.mockResolvedValue(null);

    const { GET } = await import('@/app/api/admin/job-status/[id]/route');
    const response = await GET(makeRequest('Bearer token') as any, { params: Promise.resolve({ id: 'missing' }) });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Job not found');
  });

  it('returns 500 when job lookup fails', async () => {
    verifyAccessTokenMock.mockReturnValue({ role: 'admin' });
    jobQueueMock.getJob.mockRejectedValue(new Error('lookup failed'));

    const { GET } = await import('@/app/api/admin/job-status/[id]/route');
    const response = await GET(makeRequest('Bearer token') as any, { params: Promise.resolve({ id: '1' }) });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('InternalError');
  });
});


