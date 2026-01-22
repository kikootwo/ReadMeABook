/**
 * Component: Setup Status API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

describe('Setup status route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when setup_completed is true', async () => {
    prismaMock.configuration.findUnique.mockResolvedValueOnce({
      key: 'setup_completed',
      value: 'true',
    });

    const { GET } = await import('@/app/api/setup/status/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.setupComplete).toBe(true);
  });

  it('returns false when setup_completed is missing', async () => {
    prismaMock.configuration.findUnique.mockResolvedValueOnce(null);

    const { GET } = await import('@/app/api/setup/status/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.setupComplete).toBe(false);
  });

  it('returns false when the database lookup fails', async () => {
    prismaMock.configuration.findUnique.mockRejectedValueOnce(new Error('db not ready'));

    const { GET } = await import('@/app/api/setup/status/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.setupComplete).toBe(false);
  });
});
