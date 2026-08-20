/**
 * Component: SABnzbd Integration Service Tests
 * Documentation: documentation/phase3/sabnzbd.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SABnzbdService, getSABnzbdService, invalidateSABnzbdService } from '@/lib/integrations/sabnzbd.service';

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

const axiosMock = vi.hoisted(() => ({
  create: vi.fn(() => clientMock),
  get: vi.fn(),
  isAxiosError: vi.fn(() => false),
}));

const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

// Mock for DownloadClientManager
const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
  getAllClients: vi.fn(),
  hasClientForProtocol: vi.fn(),
}));

vi.mock('axios', () => ({
  default: axiosMock,
  ...axiosMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: vi.fn(async () => configServiceMock),
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
  invalidateDownloadClientManager: vi.fn(),
}));

describe('SABnzbdService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    axiosMock.get.mockReset();
    configServiceMock.get.mockReset();
    downloadClientManagerMock.getClientForProtocol.mockReset();
    downloadClientManagerMock.getAllClients.mockReset();
    downloadClientManagerMock.hasClientForProtocol.mockReset();
    invalidateSABnzbdService();
  });

  it('fails connection when API key is missing', async () => {
    const service = new SABnzbdService('http://sab', '');

    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('API key is required');
    expect(clientMock.get).not.toHaveBeenCalled();
  });

  it('returns a friendly error for invalid API key', async () => {
    clientMock.get.mockResolvedValueOnce({
      data: { status: false, error: 'API Key Incorrect' },
    });

    const service = new SABnzbdService('http://sab', 'bad-key');
    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid API key');
    expect(clientMock.get).toHaveBeenCalledTimes(1);
  });

  it('returns non-API key errors from the server', async () => {
    clientMock.get.mockResolvedValueOnce({
      data: { status: false, error: 'No permissions' },
    });

    const service = new SABnzbdService('http://sab', 'bad-key');
    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toBe('No permissions');
  });

  it('returns version when connection succeeds', async () => {
    clientMock.get
      .mockResolvedValueOnce({ data: { status: true } })
      .mockResolvedValueOnce({ data: { version: '4.0.0' } });

    const service = new SABnzbdService('http://sab', 'good-key');
    const result = await service.testConnection();

    expect(result.success).toBe(true);
    expect(result.version).toBe('4.0.0');
    expect(clientMock.get).toHaveBeenCalledTimes(2);
  });

  it('returns SSL error message when certificate issues occur', async () => {
    clientMock.get.mockRejectedValueOnce(new Error('certificate error'));

    const service = new SABnzbdService('https://sab', 'key');
    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('SSL/TLS certificate error');
  });

  it('returns a friendly error on connection refused', async () => {
    clientMock.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const service = new SABnzbdService('http://sab', 'key');
    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Connection refused');
  });

  it('adds NZB with mapped priority', async () => {
    // Mock getConfig for ensureCategory (called before adding NZB)
    clientMock.get
      .mockResolvedValueOnce({
        data: { config: { version: '1', misc: { complete_dir: '/downloads' }, categories: { books: { dir: '' } } } },
      });
    // Mock NZB file download (global axios.get)
    axiosMock.get.mockResolvedValueOnce({
      data: Buffer.from('fake-nzb-content'),
      headers: {},
    });
    // Mock addfile upload (POST instead of GET)
    clientMock.post.mockResolvedValueOnce({
      data: { status: true, nzo_ids: ['nzb-1'] },
    });

    const service = new SABnzbdService('http://sab', 'key', 'books', '/downloads');
    const nzbId = await service.addNZB('https://example.com/book.nzb', {
      category: 'books',
      priority: 'high',
    });

    expect(nzbId).toBe('nzb-1');
    expect(clientMock.post).toHaveBeenCalledTimes(1);
  });

  it('adds NZB with force priority', async () => {
    // Mock getConfig for ensureCategory (called before adding NZB)
    clientMock.get
      .mockResolvedValueOnce({
        data: { config: { version: '1', misc: { complete_dir: '/downloads' }, categories: { readmeabook: { dir: '' } } } },
      });
    // Mock NZB file download
    axiosMock.get.mockResolvedValueOnce({
      data: Buffer.from('fake-nzb-content'),
      headers: {},
    });
    // Mock addfile upload
    clientMock.post.mockResolvedValueOnce({
      data: { status: true, nzo_ids: ['nzb-9'] },
    });

    const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');
    const nzbId = await service.addNZB('https://example.com/book.nzb', { priority: 'force' });

    expect(nzbId).toBe('nzb-9');
    expect(clientMock.post).toHaveBeenCalledTimes(1);
  });

  it('returns queue item info when NZB is active', async () => {
    clientMock.get.mockResolvedValueOnce({
      data: {
        queue: {
          slots: [
            {
              nzo_id: 'nzb-2',
              filename: 'Queue Book',
              mb: '10',
              mbleft: '5',
              percentage: '50',
              status: 'Paused',
              timeleft: '0:00:10',
              cat: 'readmeabook',
              priority: 'Normal',
            },
          ],
        },
      },
    });

    const service = new SABnzbdService('http://sab', 'key');
    const info = await service.getNZB('nzb-2');

    expect(info?.nzbId).toBe('nzb-2');
    expect(info?.progress).toBe(0.5);
    expect(info?.status).toBe('paused');
    expect(info?.size).toBe(10 * 1024 * 1024);
    expect(info?.timeLeft).toBe(10);
  });

  it('maps queue slots from getQueue', async () => {
    clientMock.get.mockResolvedValueOnce({
      data: {
        queue: {
          slots: [
            {
              nzo_id: 'nzb-10',
              filename: 'Queue Book',
              mb: '5',
              mbleft: '2',
              percentage: '40',
              status: 'Queued',
              timeleft: '0:01:00',
              cat: 'readmeabook',
              priority: 'Normal',
            },
          ],
        },
      },
    });

    const service = new SABnzbdService('http://sab', 'key');
    const queue = await service.getQueue();

    expect(queue[0]).toEqual(expect.objectContaining({
      nzbId: 'nzb-10',
      name: 'Queue Book',
      size: 5,
      sizeLeft: 2,
      percentage: 40,
      status: 'Queued',
    }));
  });

  it('maps history slots from getHistory', async () => {
    clientMock.get.mockResolvedValueOnce({
      data: {
        history: {
          slots: [
            {
              nzo_id: 'nzb-11',
              name: 'History Book',
              category: 'readmeabook',
              status: 'Failed',
              bytes: '1024',
              fail_message: 'Failed',
              storage: '/downloads',
              completed: '1700000001',
              download_time: '60',
            },
          ],
        },
      },
    });

    const service = new SABnzbdService('http://sab', 'key');
    const history = await service.getHistory(1);

    expect(history[0]).toEqual(expect.objectContaining({
      nzbId: 'nzb-11',
      status: 'Failed',
      bytes: '1024',
      failMessage: 'Failed',
    }));
  });

  it('returns history item info when NZB has completed', async () => {
    clientMock.get
      .mockResolvedValueOnce({ data: { queue: { slots: [] } } })
      .mockResolvedValueOnce({
        data: {
          history: {
            slots: [
              {
                nzo_id: 'nzb-3',
                name: 'History Book',
                category: 'readmeabook',
                status: 'Completed',
                bytes: '2048',
                fail_message: '',
                storage: '/downloads/book',
                completed: '1700000000',
                download_time: '60',
              },
            ],
          },
        },
      });

    const service = new SABnzbdService('http://sab', 'key');
    const info = await service.getNZB('nzb-3');

    expect(info?.nzbId).toBe('nzb-3');
    expect(info?.progress).toBe(1);
    expect(info?.status).toBe('completed');
    expect(info?.downloadPath).toBe('/downloads/book');
    expect(info?.completedAt?.getTime()).toBe(1700000000 * 1000);
  });

  it('returns history item info when NZB has failed', async () => {
    clientMock.get
      .mockResolvedValueOnce({ data: { queue: { slots: [] } } })
      .mockResolvedValueOnce({
        data: {
          history: {
            slots: [
              {
                nzo_id: 'nzb-12',
                name: 'Failed Book',
                category: 'readmeabook',
                status: 'Failed',
                bytes: '2048',
                fail_message: 'Bad nzb',
                storage: '/downloads/book',
                completed: '1700000002',
                download_time: '30',
              },
            ],
          },
        },
      });

    const service = new SABnzbdService('http://sab', 'key');
    const info = await service.getNZB('nzb-12');

    expect(info?.status).toBe('failed');
    expect(info?.errorMessage).toBe('Bad nzb');
  });

  it('maps repairing status in download progress', () => {
    const service = new SABnzbdService('http://sab', 'key');
    const progress = service.getDownloadProgress({
      nzbId: 'nzb-4',
      name: 'Repairing Book',
      size: 1,
      sizeLeft: 1,
      percentage: 100,
      status: 'Repairing',
      timeLeft: '0:00:00',
      category: 'readmeabook',
      priority: 'Normal',
    });

    expect(progress.state).toBe('repairing');
    expect(progress.percent).toBe(1);
  });

  it('maps queued and extracting status in download progress', () => {
    const service = new SABnzbdService('http://sab', 'key');
    const queued = service.getDownloadProgress({
      nzbId: 'nzb-5',
      name: 'Queued Book',
      size: 2,
      sizeLeft: 2,
      percentage: 0,
      status: 'Queued',
      timeLeft: '0:10:00',
      category: 'readmeabook',
      priority: 'Normal',
    });

    const extracting = service.getDownloadProgress({
      nzbId: 'nzb-6',
      name: 'Extracting Book',
      size: 2,
      sizeLeft: 1,
      percentage: 50,
      status: 'Extracting',
      timeLeft: '0:05:00',
      category: 'readmeabook',
      priority: 'Normal',
    });

    expect(queued.state).toBe('queued');
    expect(extracting.state).toBe('extracting');
  });

  it('maps completed status when percentage is 100', () => {
    const service = new SABnzbdService('http://sab', 'key');
    const progress = service.getDownloadProgress({
      nzbId: 'nzb-7',
      name: 'Done Book',
      size: 1,
      sizeLeft: 0,
      percentage: 100,
      status: 'Downloading',
      timeLeft: '0:00:00',
      category: 'readmeabook',
      priority: 'Normal',
    });

    expect(progress.state).toBe('completed');
    expect(progress.percent).toBe(1);
  });

  it('creates the default category when missing', async () => {
    clientMock.get
      .mockResolvedValueOnce({
        data: { config: { version: '1', misc: { complete_dir: '/mnt/usenet/complete' }, categories: {} } },
      })
      .mockResolvedValueOnce({ data: { status: true } });

    const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');
    await service.ensureCategory();

    expect(clientMock.get).toHaveBeenCalledWith('/api', expect.objectContaining({
      params: expect.objectContaining({ mode: 'set_config', keyword: 'readmeabook' }),
    }));
  });

  it('swallows errors when ensuring categories fails', async () => {
    const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');
    const configSpy = vi.spyOn(service, 'getConfig').mockRejectedValue(new Error('bad config'));

    await expect(service.ensureCategory()).resolves.toBeUndefined();

    configSpy.mockRestore();
  });

  it('does not create category when it already exists with correct path', async () => {
    clientMock.get.mockResolvedValueOnce({
      data: {
        config: {
          version: '1',
          misc: { complete_dir: '/mnt/usenet/complete' },
          categories: { readmeabook: { dir: '/downloads' } },
        },
      },
    });

    const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');
    await service.ensureCategory();

    // Only get_config called, no set_config because path already matches
    expect(clientMock.get).toHaveBeenCalledTimes(1);
    expect(clientMock.get.mock.calls[0][1].params.mode).toBe('get_config');
  });
  it('throws when addNZB reports a failure', async () => {
    // Mock getConfig for ensureCategory, then the upload failure
    clientMock.get
      .mockResolvedValueOnce({
        data: { config: { version: '1', misc: { complete_dir: '/downloads' }, categories: { readmeabook: { dir: '' } } } },
      });
    axiosMock.get.mockResolvedValueOnce({
      data: Buffer.from('fake-nzb-content'),
      headers: {},
    });
    clientMock.post.mockResolvedValueOnce({
      data: { status: false, error: 'Bad NZB' },
    });

    const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');

    await expect(service.addNZB('https://example.com/book.nzb')).rejects.toThrow('Bad NZB');
  });

  it('throws when SABnzbd returns no NZB IDs', async () => {
    // Mock getConfig for ensureCategory, then the upload with empty IDs
    clientMock.get
      .mockResolvedValueOnce({
        data: { config: { version: '1', misc: { complete_dir: '/downloads' }, categories: { readmeabook: { dir: '' } } } },
      });
    axiosMock.get.mockResolvedValueOnce({
      data: Buffer.from('fake-nzb-content'),
      headers: {},
    });
    clientMock.post.mockResolvedValueOnce({
      data: { status: true, nzo_ids: [] },
    });

    const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');

    await expect(service.addNZB('https://example.com/book.nzb')).rejects.toThrow('did not return an NZB ID');
  });

  it('returns null when NZB is not found in queue or history', async () => {
    clientMock.get
      .mockResolvedValueOnce({ data: { queue: { slots: [] } } })
      .mockResolvedValueOnce({ data: { history: { slots: [] } } });

    const service = new SABnzbdService('http://sab', 'key');
    const info = await service.getNZB('missing');

    expect(info).toBeNull();
  });

  it('returns an error message for connection timeouts', async () => {
    clientMock.get.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const service = new SABnzbdService('http://sab', 'key');
    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('timed out');
  });

  it('throws when version is missing from response', async () => {
    clientMock.get.mockResolvedValueOnce({ data: {} });

    const service = new SABnzbdService('http://sab', 'key');

    await expect(service.getVersion()).rejects.toThrow('Failed to get SABnzbd version');
  });

  it('throws when config payload is missing', async () => {
    clientMock.get.mockResolvedValueOnce({ data: {} });

    const service = new SABnzbdService('http://sab', 'key');

    await expect(service.getConfig()).rejects.toThrow('Failed to get SABnzbd configuration');
  });

  it('creates a singleton service from config', async () => {
    // Mock: SABnzbd client configured via DownloadClientManager
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'sabnzbd',
      name: 'SABnzbd',
      enabled: true,
      url: 'http://sab',
      password: 'api-key', // API key stored in password field
      disableSSLVerify: false,
      remotePathMappingEnabled: false,
      category: 'books',
    });
    configServiceMock.get.mockResolvedValue('/downloads');

    const ensureSpy = vi.spyOn(SABnzbdService.prototype, 'ensureCategory').mockResolvedValue();

    const service = await getSABnzbdService();
    const again = await getSABnzbdService();

    expect(service).toBe(again);
    expect(ensureSpy).toHaveBeenCalled();

    ensureSpy.mockRestore();
  });

  it('creates singleton with path mapping config when enabled', async () => {
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'sabnzbd',
      name: 'SABnzbd',
      enabled: true,
      url: 'http://sab',
      password: 'api-key',
      disableSSLVerify: false,
      remotePathMappingEnabled: true,
      remotePath: '/mnt/usenet/complete',
      localPath: '/downloads',
      category: 'readmeabook',
    });
    configServiceMock.get.mockResolvedValue('/downloads');

    const ensureSpy = vi.spyOn(SABnzbdService.prototype, 'ensureCategory').mockResolvedValue();

    const service = await getSABnzbdService();

    expect(service).toBeDefined();
    expect(ensureSpy).toHaveBeenCalled();

    ensureSpy.mockRestore();
  });

  describe('Path Mapping', () => {
    it('uses empty category path when download_dir matches complete_dir', async () => {
      clientMock.get
        .mockResolvedValueOnce({
          data: {
            config: {
              version: '1',
              misc: { complete_dir: '/downloads' },
              categories: {},
            },
          },
        })
        .mockResolvedValueOnce({ data: { status: true } });

      const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');
      await service.ensureCategory();

      // Should set empty dir when paths match
      const setCategoryCall = clientMock.get.mock.calls.find(
        (call) => call[1]?.params?.mode === 'set_config'
      );
      expect(setCategoryCall).toBeDefined();
      expect(setCategoryCall![1].params.dir).toBe('');
    });

    it('uses relative path when download_dir is under complete_dir', async () => {
      clientMock.get
        .mockResolvedValueOnce({
          data: {
            config: {
              version: '1',
              misc: { complete_dir: '/mnt/usenet/complete' },
              categories: {},
            },
          },
        })
        .mockResolvedValueOnce({ data: { status: true } });

      const service = new SABnzbdService(
        'http://sab',
        'key',
        'readmeabook',
        '/mnt/usenet/complete/audiobooks'
      );
      await service.ensureCategory();

      const setCategoryCall = clientMock.get.mock.calls.find(
        (call) => call[1]?.params?.mode === 'set_config'
      );
      expect(setCategoryCall).toBeDefined();
      expect(setCategoryCall![1].params.dir).toBe('audiobooks');
    });

    it('uses absolute path when download_dir differs from complete_dir', async () => {
      clientMock.get
        .mockResolvedValueOnce({
          data: {
            config: {
              version: '1',
              misc: { complete_dir: '/mnt/usenet/complete' },
              categories: {},
            },
          },
        })
        .mockResolvedValueOnce({ data: { status: true } });

      const service = new SABnzbdService(
        'http://sab',
        'key',
        'readmeabook',
        '/different/path/audiobooks'
      );
      await service.ensureCategory();

      const setCategoryCall = clientMock.get.mock.calls.find(
        (call) => call[1]?.params?.mode === 'set_config'
      );
      expect(setCategoryCall).toBeDefined();
      expect(setCategoryCall![1].params.dir).toBe('/different/path/audiobooks');
    });

    it('applies reverse path mapping before comparing with complete_dir', async () => {
      clientMock.get
        .mockResolvedValueOnce({
          data: {
            config: {
              version: '1',
              misc: { complete_dir: '/mnt/usenet/complete' },
              categories: {},
            },
          },
        })
        .mockResolvedValueOnce({ data: { status: true } });

      // RMAB sees /downloads but SABnzbd sees /mnt/usenet/complete
      const pathMappingConfig = {
        enabled: true,
        remotePath: '/mnt/usenet/complete',
        localPath: '/downloads',
      };

      const service = new SABnzbdService(
        'http://sab',
        'key',
        'readmeabook',
        '/downloads', // RMAB's local path
        false,
        pathMappingConfig
      );
      await service.ensureCategory();

      // After reverse transform, /downloads becomes /mnt/usenet/complete
      // which matches complete_dir, so category dir should be empty
      const setCategoryCall = clientMock.get.mock.calls.find(
        (call) => call[1]?.params?.mode === 'set_config'
      );
      expect(setCategoryCall).toBeDefined();
      expect(setCategoryCall![1].params.dir).toBe('');
    });

    it('updates category path when it differs from calculated path', async () => {
      clientMock.get
        .mockResolvedValueOnce({
          data: {
            config: {
              version: '1',
              misc: { complete_dir: '/mnt/usenet/complete' },
              categories: { readmeabook: { dir: '/old/path' } },
            },
          },
        })
        .mockResolvedValueOnce({ data: { status: true } });

      const service = new SABnzbdService(
        'http://sab',
        'key',
        'readmeabook',
        '/mnt/usenet/complete/audiobooks'
      );
      await service.ensureCategory();

      // Should update the category with new relative path
      const setCategoryCall = clientMock.get.mock.calls.find(
        (call) => call[1]?.params?.mode === 'set_config'
      );
      expect(setCategoryCall).toBeDefined();
      expect(setCategoryCall![1].params.dir).toBe('audiobooks');
    });

    it('fetches complete_dir from SABnzbd config', async () => {
      clientMock.get.mockResolvedValueOnce({
        data: {
          config: {
            version: '4.0.0',
            misc: { complete_dir: '/mnt/usenet/complete' },
            categories: { test: { dir: 'test-dir' } },
          },
        },
      });

      const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');
      const config = await service.getConfig();

      expect(config.completeDir).toBe('/mnt/usenet/complete');
      expect(config.categories).toEqual([{ name: 'test', dir: 'test-dir' }]);
    });

    it('returns configured category names', async () => {
      clientMock.get.mockResolvedValueOnce({
        data: {
          config: {
            version: '4.0.0',
            misc: { complete_dir: '/mnt/usenet/complete' },
            categories: {
              readmeabook: { dir: '' },
              audiobooks: { dir: 'audiobooks' },
            },
          },
        },
      });

      const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');
      const categories = await service.getCategories();

      expect(categories).toEqual(['readmeabook', 'audiobooks']);
    });

    it('returns complete_dir via getCompleteDir helper', async () => {
      clientMock.get.mockResolvedValueOnce({
        data: {
          config: {
            version: '4.0.0',
            misc: { complete_dir: '/var/usenet/done' },
            categories: {},
          },
        },
      });

      const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');
      const completeDir = await service.getCompleteDir();

      expect(completeDir).toBe('/var/usenet/done');
    });

    it('handles missing complete_dir gracefully', async () => {
      clientMock.get
        .mockResolvedValueOnce({
          data: {
            config: {
              version: '4.0.0',
              misc: {}, // No complete_dir
              categories: {},
            },
          },
        })
        .mockResolvedValueOnce({ data: { status: true } });

      const service = new SABnzbdService('http://sab', 'key', 'readmeabook', '/downloads');
      await service.ensureCategory();

      // Should fallback to using download_dir directly
      const setCategoryCall = clientMock.get.mock.calls.find(
        (call) => call[1]?.params?.mode === 'set_config'
      );
      expect(setCategoryCall).toBeDefined();
      expect(setCategoryCall![1].params.dir).toBe('/downloads');
    });

    it('handles Windows-style paths in path mapping', async () => {
      clientMock.get
        .mockResolvedValueOnce({
          data: {
            config: {
              version: '1',
              misc: { complete_dir: 'D:\\Usenet\\Complete' },
              categories: {},
            },
          },
        })
        .mockResolvedValueOnce({ data: { status: true } });

      const pathMappingConfig = {
        enabled: true,
        remotePath: 'D:\\Usenet\\Complete',
        localPath: '/downloads',
      };

      const service = new SABnzbdService(
        'http://sab',
        'key',
        'readmeabook',
        '/downloads',
        false,
        pathMappingConfig
      );
      await service.ensureCategory();

      // After reverse transform and comparison (normalized), should match
      const setCategoryCall = clientMock.get.mock.calls.find(
        (call) => call[1]?.params?.mode === 'set_config'
      );
      expect(setCategoryCall).toBeDefined();
      // Path should be empty since /downloads maps to D:\Usenet\Complete which matches complete_dir
      expect(setCategoryCall![1].params.dir).toBe('');
    });
  });
});
