import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SABnzbdService } from '@/lib/integrations/sabnzbd.service';
import fs from 'fs';

describe('SABnzbdService Duplicate NZB Handling', () => {
  let service: SABnzbdService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SABnzbdService('http://localhost:8080', 'test-key');
  });

  it('should map Duplicate NZB to completed status if storage path exists on disk with files', async () => {
    const mockHistoryItem = {
      nzo_id: 'sab-nzo-123',
      name: 'The_Expanse_03_Abaddons_Gate',
      category: 'readmeabook',
      status: 'Failed',
      bytes: '5000000',
      fail_message: 'Duplicate NZB',
      storage: '/storage/downloads/nzb/download/The_Expanse_03_Abaddons_Gate',
      completed: '1785450000',
      download_time: '10',
    };

    vi.spyOn(service['client'], 'get').mockImplementation(async (url, config: any) => {
      if (config?.params?.mode === 'queue') {
        return { data: { queue: { slots: [] } } };
      }
      return {
        data: {
          history: {
            slots: [mockHistoryItem],
          },
        },
      };
    });

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['audio.m4b'] as any);

    const item = await service.getNZB('sab-nzo-123');

    expect(item).toBeDefined();
    expect(item?.status).toBe('completed');
    expect(item?.downloadPath).toBe('/storage/downloads/nzb/download/The_Expanse_03_Abaddons_Gate');
  });

  it('should preserve failed status if Duplicate NZB has no existing storage files on disk', async () => {
    const mockHistoryItem = {
      nzo_id: 'sab-nzo-456',
      name: 'Non_Existent_Book',
      category: 'readmeabook',
      status: 'Failed',
      bytes: '0',
      fail_message: 'Duplicate NZB',
      storage: '/storage/downloads/nzb/download/Non_Existent_Book',
      completed: '1785450000',
      download_time: '0',
    };

    vi.spyOn(service['client'], 'get').mockImplementation(async (url, config: any) => {
      if (config?.params?.mode === 'queue') {
        return { data: { queue: { slots: [] } } };
      }
      return {
        data: {
          history: {
            slots: [mockHistoryItem],
          },
        },
      };
    });

    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const item = await service.getNZB('sab-nzo-456');

    expect(item).toBeDefined();
    expect(item?.status).toBe('failed');
    expect(item?.errorMessage).toContain('Duplicate NZB');
  });
});
