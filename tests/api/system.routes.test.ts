/**
 * Component: System API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

describe('System routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns healthy status when database is reachable', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce(1);
    const { GET } = await import('@/app/api/health/route');

    const response = await GET();
    const payload = await response.json();

    expect(payload.status).toBe('healthy');
    expect(payload.database).toBe('connected');
  });

  it('returns unhealthy status on database error', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('db down'));
    const { GET } = await import('@/app/api/health/route');

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.status).toBe('unhealthy');
  });

  it('returns version info from environment', async () => {
    process.env.APP_VERSION = '1.0.0';
    process.env.GIT_COMMIT = 'abcdef123456';
    process.env.BUILD_DATE = '2025-01-01';

    const { GET } = await import('@/app/api/version/route');
    const response = await GET();
    const payload = await response.json();

    expect(payload.version).toBe('v1.0.0');
    expect(payload.fullVersion).toBe('1.0.0');
    expect(payload.commit).toBe('abcdef123456');
    expect(payload.buildDate).toBe('2025-01-01');
  });
});
