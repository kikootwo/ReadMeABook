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

vi.mock('@/lib/integrations/qbittorrent.service', () => ({
  getQBittorrentService: () => ({}),
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
        updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
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
});
