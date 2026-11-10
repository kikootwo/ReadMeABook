/**
 * Component: Setup Complete Scheduling Tests (#583)
 * Documentation: documentation/setup-wizard.md
 *
 * Runs the real scheduler against a fake job queue that keeps repeatables under Bull's
 * repeat key (name:jobId:endDate:tz:cron), so a second registration of the same job shows
 * up as a duplicate entry only if it used a different key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

const queue = vi.hoisted(() => {
  const repeatables = new Map<string, { jobType: string; jobId: string; cron: string }>();
  const key = (jobType: string, jobId: string, cron: string) => `${jobType}:${jobId}:::${cron}`;
  return {
    repeatables,
    failAdd: false,
    addRepeatableJob: async (jobType: string, _payload: unknown, cron: string, jobId: string) => {
      if (queue.failAdd) throw new Error('Redis unavailable');
      repeatables.set(key(jobType, jobId, cron), { jobType, jobId, cron });
    },
    removeRepeatableJob: async (jobType: string, cron: string, jobId: string) => {
      repeatables.delete(key(jobType, jobId, cron));
    },
  };
});

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => queue }));
vi.mock('@/lib/services/notification', () => ({ getNotificationService: () => ({}) }));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({
    encrypt: (value: string) => `enc-${value}`,
    isEncryptedFormat: (value: string) => typeof value === 'string' && value.startsWith('enc-'),
  }),
}));

type Row = { id: string; name: string; type: string; schedule: string; enabled: boolean };
type Where = { id?: string; enabled?: boolean; type?: { in?: string[] } };
type Args = { where?: Where; data?: Partial<Row> };
let rows: Row[];

const setupBody = {
  backendMode: 'audiobookshelf',
  authMethod: 'oidc',
  audiobookshelf: { server_url: 'http://abs', api_token: 'abs-token', library_id: 'lib' },
  oidc: { provider_name: 'OIDC', issuer_url: 'https://issuer', client_id: 'client-id', client_secret: 'client-secret' },
  prowlarr: { url: 'http://prowlarr', api_key: 'key', indexers: [{ id: 1 }] },
  downloadClient: { type: 'qbittorrent', url: 'http://qbt', username: 'u', password: 'p' },
  paths: { download_dir: '/downloads', media_dir: '/media' },
};

async function completeSetup() {
  const { POST } = await import('@/app/api/setup/complete/route');
  const response = await POST({ json: vi.fn().mockResolvedValue(setupBody) } as unknown as NextRequest);
  return { status: response.status, payload: await response.json() };
}

const scheduledIds = () => [...queue.repeatables.values()].map((entry) => entry.jobId).sort();

describe('POST /api/setup/complete schedules the jobs it enables (#583)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queue.repeatables.clear();
    queue.failAdd = false;
    // Startup state on a fresh install: the two auto jobs exist, disabled and unscheduled
    rows = [
      { id: 'scan', name: 'Library Scan', type: 'plex_library_scan', schedule: '0 */6 * * *', enabled: false },
      { id: 'audible', name: 'Audible Data Refresh', type: 'audible_refresh', schedule: '0 0 * * *', enabled: false },
      { id: 'recent', name: 'Recently Added Check', type: 'plex_recently_added_check', schedule: '*/5 * * * *', enabled: true },
    ];
    const matches = (row: Row, where: Where = {}) =>
      (!where.type?.in || where.type.in.includes(row.type)) &&
      (where.enabled === undefined || row.enabled === where.enabled) &&
      (where.id === undefined || row.id === where.id);
    const sched = prismaMock.scheduledJob;
    sched.updateMany.mockImplementation(async ({ where, data }: Args) => {
      const hit = rows.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    });
    sched.findMany.mockImplementation(async ({ where }: Args = {}) => rows.filter((row) => matches(row, where)).map((row) => ({ ...row })));
    sched.findUnique.mockImplementation(async ({ where }: Args) => {
      const row = rows.find((r) => r.id === where?.id);
      return row ? { ...row } : null;
    });
    sched.update.mockImplementation(async ({ where, data }: Args) => {
      const row = rows.find((r) => r.id === where?.id)!;
      Object.assign(row, data);
      return { ...row };
    });
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    prismaMock.configuration.upsert.mockResolvedValue({});
    prismaMock.bookDateConfig.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the Library Scan and Audible Data Refresh schedules right away', async () => {
    const { status, payload } = await completeSetup();

    expect(status).toBe(200);
    expect(payload.success).toBe(true);
    expect(scheduledIds()).toEqual(['scheduled-audible', 'scheduled-scan']);
    expect([...queue.repeatables.values()]).toContainEqual({
      jobType: 'plex_library_scan',
      jobId: 'scheduled-scan',
      cron: '0 */6 * * *',
    });
  });

  it('adds no second copy on a repeat run or on the next app start', async () => {
    await completeSetup();
    await completeSetup();
    expect(scheduledIds()).toEqual(['scheduled-audible', 'scheduled-scan']);

    // The next app start schedules every enabled job again under the same keys
    const { getSchedulerService } = await import('@/lib/services/scheduler.service');
    await (getSchedulerService() as unknown as { scheduleAllJobs(): Promise<void> }).scheduleAllJobs();
    expect(scheduledIds()).toEqual(['scheduled-audible', 'scheduled-recent', 'scheduled-scan']);
  });

  it('still completes setup when scheduling fails, warning with the job name', async () => {
    queue.failAdd = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { status, payload } = await completeSetup();

    expect(status).toBe(200);
    expect(payload.success).toBe(true);
    expect(rows.filter((row) => row.enabled).map((row) => row.id).sort()).toEqual(['audible', 'recent', 'scan']);
    const warnings = warn.mock.calls.map((call) => String(call[0]));
    expect(warnings.some((line) => line.includes('Library Scan') && line.includes('restart'))).toBe(true);
    expect(warnings.some((line) => line.includes('Audible Data Refresh') && line.includes('restart'))).toBe(true);
  });
});
