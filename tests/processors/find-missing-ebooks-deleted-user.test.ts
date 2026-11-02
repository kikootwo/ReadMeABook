/**
 * Component: Find Missing Ebooks Deleted-User Tests
 * Documentation: documentation/backend/services/scheduler.md
 *
 * The nightly ebook backfill creates and retries ebook requests for the owner of
 * each downloaded audiobook request. A soft-deleted user's audiobook requests
 * (User.deletedAt set) are left out of the candidate query, so no ebook request
 * is created or retried for them and they never use a slot of the per-run cap (#504).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));

beforeEach(() => {
  vi.clearAllMocks();
  configMock.get.mockImplementation(async (key: string) => (key === 'ebook_annas_archive_enabled' ? 'true' : null));
  prismaMock.$queryRaw.mockResolvedValue([]);
});

async function candidateSql(): Promise<string> {
  const { processFindMissingEbooks } = await import('@/lib/processors/find-missing-ebooks.processor');
  await processFindMissingEbooks({ jobId: 'job-504' });
  expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  return (prismaMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?').replace(/\s+/g, ' ');
}

describe('processFindMissingEbooks candidate query', () => {
  it('joins each audiobook request to its user', async () => {
    expect(await candidateSql()).toMatch(/JOIN users u ON u\.id = p\.user_id/);
  });

  it('keeps only requests whose user is not deleted, inside the WHERE that the LIMIT applies to', async () => {
    const sql = await candidateSql();
    const start = sql.indexOf(' WHERE p.status');
    const end = sql.indexOf(' ORDER BY p.created_at');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    expect(sql.slice(start, end)).toMatch(/AND u\.deleted_at IS NULL/);
  });
});
