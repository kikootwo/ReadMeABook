import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processRecoverStuckRequests } from '@/lib/processors/recover-stuck-requests.processor';

const prismaMock = vi.hoisted(() => ({
  request: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/integrations/sabnzbd.service', () => ({
  getSABnzbdService: () => ({
    getNZB: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getStuckRequestTimeoutHours: vi.fn().mockResolvedValue(6),
  }),
}));

describe('Recover Stuck Requests Processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reset stuck searching requests back to awaiting_search', async () => {
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-1',
        status: 'searching',
        updatedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
        audiobook: { title: 'Mistborn: Secret History' },
      },
    ] as any);

    prismaMock.request.update.mockResolvedValue({} as any);

    const result = await processRecoverStuckRequests();

    expect(result.success).toBe(true);
    expect(result.resetToSearch).toBe(1);
    expect(prismaMock.request.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: expect.objectContaining({ status: 'awaiting_search' }),
    });
  });

  it('should disable recovery when stuckTimeoutHours is configured to 0', async () => {
    const result = await processRecoverStuckRequests({ stuckTimeoutHours: 0 });

    expect(result.success).toBe(true);
    expect(result.disabled).toBe(true);
    expect(prismaMock.request.findMany).not.toHaveBeenCalled();
  });
});
