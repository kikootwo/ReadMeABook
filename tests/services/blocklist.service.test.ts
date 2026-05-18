/**
 * Component: Blocklist Service Tests
 * Documentation: documentation/backend/database.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

const jobLoggerInfo = vi.fn();
const jobLoggerWarn = vi.fn();
const jobLoggerError = vi.fn();
const createdLoggerInfo = vi.fn();
const createdLoggerError = vi.fn();
const forJobSpy = vi.fn(() => ({
  debug: vi.fn(),
  info: jobLoggerInfo,
  warn: jobLoggerWarn,
  error: jobLoggerError,
}));

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({
      debug: vi.fn(),
      info: createdLoggerInfo,
      warn: vi.fn(),
      error: createdLoggerError,
    }),
    forJob: forJobSpy,
  },
}));

function baseInput() {
  return {
    requestId: 'req-1',
    releaseName: 'Some.Release.Name',
    source: 'organize_fail' as const,
    reason: 'No audiobook files found',
  };
}

function fakeRow(overrides: Partial<{ id: string; releaseKey: string; createdAt: Date }> = {}) {
  return {
    id: overrides.id ?? 'block-1',
    requestId: 'req-1',
    releaseName: 'Some.Release.Name',
    releaseKey: overrides.releaseKey ?? 'some.release.name',
    releaseHash: null,
    indexerName: null,
    indexerId: null,
    source: 'organize_fail',
    reason: 'No audiobook files found',
    reasonDetail: null,
    downloadHistoryId: null,
    jobId: null,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

describe('addAutoBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts on (requestId, releaseKey) with the normalized key', async () => {
    prismaMock.blockedRelease.upsert.mockResolvedValue(fakeRow());

    const { addAutoBlock } = await import('@/lib/services/blocklist.service');
    await addAutoBlock({ ...baseInput(), releaseName: '  Some.Release.NAME  ' });

    expect(prismaMock.blockedRelease.upsert).toHaveBeenCalledTimes(1);
    const callArg = prismaMock.blockedRelease.upsert.mock.calls[0][0];
    expect(callArg.where).toEqual({
      requestId_releaseKey: { requestId: 'req-1', releaseKey: 'some.release.name' },
    });
    expect(callArg.create.releaseKey).toBe('some.release.name');
    expect(callArg.create.releaseName).toBe('  Some.Release.NAME  ');
    expect(callArg.update).toEqual({});
  });

  it('passes all metadata fields through to create', async () => {
    prismaMock.blockedRelease.upsert.mockResolvedValue(fakeRow());

    const { addAutoBlock } = await import('@/lib/services/blocklist.service');
    await addAutoBlock({
      requestId: 'req-1',
      releaseName: 'Foo',
      source: 'download_fail',
      reason: 'Download failed (par2)',
      releaseHash: 'abc123',
      indexerName: 'NZBgeek',
      indexerId: 7,
      reasonDetail: 'Status: FAILURE/PAR; Par: FAILURE',
      downloadHistoryId: 'dh-9',
      jobId: 'job-42',
    });

    const create = prismaMock.blockedRelease.upsert.mock.calls[0][0].create;
    expect(create).toMatchObject({
      requestId: 'req-1',
      releaseName: 'Foo',
      releaseKey: 'foo',
      releaseHash: 'abc123',
      indexerName: 'NZBgeek',
      indexerId: 7,
      source: 'download_fail',
      reason: 'Download failed (par2)',
      reasonDetail: 'Status: FAILURE/PAR; Par: FAILURE',
      downloadHistoryId: 'dh-9',
      jobId: 'job-42',
    });
  });

  it('returns wasNew=true when the row was just created', async () => {
    // createdAt in the future relative to before-call timestamp
    const future = new Date(Date.now() + 1000);
    prismaMock.blockedRelease.upsert.mockResolvedValue(fakeRow({ createdAt: future }));

    const { addAutoBlock } = await import('@/lib/services/blocklist.service');
    const result = await addAutoBlock(baseInput());

    expect(result.wasNew).toBe(true);
    expect(result.blocked).not.toBeNull();
  });

  it('returns wasNew=false when the row already existed (idempotent second call)', async () => {
    // createdAt before the call started
    const past = new Date(Date.now() - 10_000);
    prismaMock.blockedRelease.upsert.mockResolvedValue(fakeRow({ createdAt: past }));

    const { addAutoBlock } = await import('@/lib/services/blocklist.service');
    const result = await addAutoBlock(baseInput());

    expect(result.wasNew).toBe(false);
    expect(result.blocked).not.toBeNull();
  });

  it('emits a JobEvent via RMABLogger.forJob when jobId is provided', async () => {
    prismaMock.blockedRelease.upsert.mockResolvedValue(
      fakeRow({ createdAt: new Date(Date.now() + 1000) })
    );

    const { addAutoBlock } = await import('@/lib/services/blocklist.service');
    await addAutoBlock({ ...baseInput(), jobId: 'job-42' });

    expect(forJobSpy).toHaveBeenCalledWith('job-42', 'Blocklist.AutoBlock');
    expect(jobLoggerInfo).toHaveBeenCalledTimes(1);
    const [message, metadata] = jobLoggerInfo.mock.calls[0];
    expect(message).toContain('Some.Release.Name');
    expect(metadata).toMatchObject({
      requestId: 'req-1',
      source: 'organize_fail',
      reason: 'No audiobook files found',
      wasNew: true,
    });
  });

  it('does NOT emit a JobEvent when jobId is null', async () => {
    prismaMock.blockedRelease.upsert.mockResolvedValue(fakeRow());

    const { addAutoBlock } = await import('@/lib/services/blocklist.service');
    await addAutoBlock(baseInput());

    expect(forJobSpy).not.toHaveBeenCalled();
    expect(jobLoggerInfo).not.toHaveBeenCalled();
  });

  it('swallows DB errors and returns { blocked: null, wasNew: false }', async () => {
    prismaMock.blockedRelease.upsert.mockRejectedValue(new Error('DB exploded'));

    const { addAutoBlock } = await import('@/lib/services/blocklist.service');
    const result = await addAutoBlock({ ...baseInput(), jobId: 'job-42' });

    expect(result).toEqual({ blocked: null, wasNew: false });
    expect(createdLoggerError).toHaveBeenCalledTimes(1);
    // Failure path must NOT attempt the job-log either (no row to describe).
    expect(forJobSpy).not.toHaveBeenCalled();
  });
});

describe('isReleaseBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true on normalized name match', async () => {
    prismaMock.blockedRelease.findFirst.mockResolvedValue({ id: 'block-1' });

    const { isReleaseBlocked } = await import('@/lib/services/blocklist.service');
    const result = await isReleaseBlocked('req-1', '  The.Templar.LEGACY  ');

    expect(result).toBe(true);
    expect(prismaMock.blockedRelease.findFirst).toHaveBeenCalledWith({
      where: { requestId: 'req-1', OR: [{ releaseKey: 'the.templar.legacy' }] },
      select: { id: true },
    });
  });

  it('returns true on hash match even when name differs', async () => {
    prismaMock.blockedRelease.findFirst.mockResolvedValue({ id: 'block-2' });

    const { isReleaseBlocked } = await import('@/lib/services/blocklist.service');
    const result = await isReleaseBlocked('req-1', 'A different name', 'abc-hash');

    expect(result).toBe(true);
    expect(prismaMock.blockedRelease.findFirst).toHaveBeenCalledWith({
      where: {
        requestId: 'req-1',
        OR: [{ releaseKey: 'a different name' }, { releaseHash: 'abc-hash' }],
      },
      select: { id: true },
    });
  });

  it('returns false when nothing matches', async () => {
    prismaMock.blockedRelease.findFirst.mockResolvedValue(null);

    const { isReleaseBlocked } = await import('@/lib/services/blocklist.service');
    const result = await isReleaseBlocked('req-1', 'name', 'hash');

    expect(result).toBe(false);
  });

  it('does not include a hash clause when hash is null or undefined', async () => {
    prismaMock.blockedRelease.findFirst.mockResolvedValue(null);

    const { isReleaseBlocked } = await import('@/lib/services/blocklist.service');
    await isReleaseBlocked('req-1', 'name');
    await isReleaseBlocked('req-1', 'name', null);

    for (const call of prismaMock.blockedRelease.findFirst.mock.calls) {
      expect(call[0].where.OR).toEqual([{ releaseKey: 'name' }]);
    }
  });
});

describe('getBlocklistForRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries by requestId ordered by createdAt desc', async () => {
    const rows = [fakeRow({ id: 'a' }), fakeRow({ id: 'b' })];
    prismaMock.blockedRelease.findMany.mockResolvedValue(rows);

    const { getBlocklistForRequest } = await import('@/lib/services/blocklist.service');
    const result = await getBlocklistForRequest('req-1');

    expect(result).toBe(rows);
    expect(prismaMock.blockedRelease.findMany).toHaveBeenCalledWith({
      where: { requestId: 'req-1' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('removeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a single row by id', async () => {
    const { removeBlock } = await import('@/lib/services/blocklist.service');
    await removeBlock('block-1');

    expect(prismaMock.blockedRelease.delete).toHaveBeenCalledWith({
      where: { id: 'block-1' },
    });
  });
});

describe('clearBlocklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deleteMany with the provided where clause and returns the count', async () => {
    prismaMock.blockedRelease.deleteMany.mockResolvedValue({ count: 7 });

    const { clearBlocklist } = await import('@/lib/services/blocklist.service');
    const result = await clearBlocklist({ requestId: 'req-1' });

    expect(prismaMock.blockedRelease.deleteMany).toHaveBeenCalledWith({
      where: { requestId: 'req-1' },
    });
    expect(result).toEqual({ count: 7 });
  });

  it('passes an arbitrary filter through unchanged', async () => {
    prismaMock.blockedRelease.deleteMany.mockResolvedValue({ count: 0 });

    const { clearBlocklist } = await import('@/lib/services/blocklist.service');
    await clearBlocklist({ source: 'organize_fail', requestId: 'req-1' });

    expect(prismaMock.blockedRelease.deleteMany).toHaveBeenCalledWith({
      where: { source: 'organize_fail', requestId: 'req-1' },
    });
  });
});
