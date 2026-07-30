import { describe, it, expect, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  request: {
    groupBy: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/scheduler.service', () => ({
  getSchedulerService: () => ({
    getScheduledJobs: vi.fn().mockResolvedValue([
      { id: '1', name: 'Library Scan', type: 'plex_library_scan', schedule: '0 */6 * * *', enabled: true, lastRun: new Date('2026-07-30T10:00:00Z') },
    ]),
  }),
}));

import { GET as getMetrics } from '@/app/api/metrics/route';

describe('/api/metrics API Route', () => {
  it('should return Prometheus formatted metrics text with HTTP 200', async () => {
    prismaMock.request.groupBy.mockResolvedValue([
      { status: 'available', _count: { _all: 206 } },
      { status: 'downloading', _count: { _all: 0 } },
    ]);

    const response = await getMetrics();
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toContain('# HELP rmab_requests_total');
    expect(text).toContain('rmab_requests_total{status="available"} 206');
    expect(text).toContain('# HELP rmab_scheduled_job_last_run_timestamp_seconds');
  });
});
