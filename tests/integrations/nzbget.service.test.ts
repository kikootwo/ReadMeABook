/**
 * Component: NZBGet Integration Service Tests
 * Documentation: documentation/phase3/download-clients.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NZBGetService, getNZBGetService, invalidateNZBGetService } from '@/lib/integrations/nzbget.service';

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

describe('NZBGetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    axiosMock.get.mockReset();
    axiosMock.isAxiosError.mockReset();
    axiosMock.isAxiosError.mockReturnValue(false);
    configServiceMock.get.mockReset();
    downloadClientManagerMock.getClientForProtocol.mockReset();
    downloadClientManagerMock.getAllClients.mockReset();
    downloadClientManagerMock.hasClientForProtocol.mockReset();
    invalidateNZBGetService();
  });

  it('has correct clientType and protocol', () => {
    const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
    expect(service.clientType).toBe('nzbget');
    expect(service.protocol).toBe('usenet');
  });

  // =========================================================================
  // Connection Testing
  // =========================================================================

  describe('testConnection', () => {
    it('returns version when connection succeeds', async () => {
      clientMock.post.mockResolvedValueOnce({
        data: { result: '24.3' },
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.version).toBe('24.3');
      expect(result.message).toContain('Connected to NZBGet v24.3');
      expect(clientMock.post).toHaveBeenCalledWith('/jsonrpc', {
        method: 'version',
        params: [],
      });
    });

    it('fails when version is empty', async () => {
      clientMock.post.mockResolvedValueOnce({
        data: { result: '' },
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('failed to get NZBGet version');
    });

    it('returns friendly error on 401 authentication failure', async () => {
      const authError = new Error('Request failed with status code 401') as any;
      authError.response = { status: 401 };
      authError.isAxiosError = true;
      axiosMock.isAxiosError.mockReturnValue(true);
      clientMock.post.mockRejectedValueOnce(authError);

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'wrong');
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Authentication failed');
    });

    it('returns friendly error on connection refused', async () => {
      const connError = new Error('connect ECONNREFUSED') as any;
      connError.code = 'ECONNREFUSED';
      connError.isAxiosError = true;
      axiosMock.isAxiosError.mockReturnValue(true);
      clientMock.post.mockRejectedValueOnce(connError);

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection refused');
    });

    it('returns friendly error on timeout', async () => {
      const timeoutError = new Error('timeout of 30000ms exceeded') as any;
      timeoutError.code = 'ETIMEDOUT';
      timeoutError.isAxiosError = true;
      axiosMock.isAxiosError.mockReturnValue(true);
      clientMock.post.mockRejectedValueOnce(timeoutError);

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('timed out');
    });

    it('returns SSL error for certificate issues', async () => {
      clientMock.post.mockRejectedValueOnce(new Error('SSL certificate error'));

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('SSL');
    });

    it('returns RPC error message from server', async () => {
      clientMock.post.mockResolvedValueOnce({
        data: { error: { message: 'Method not found' } },
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Method not found');
    });
  });

  // =========================================================================
  // Adding Downloads
  // =========================================================================

  describe('addDownload', () => {
    it('downloads NZB file and uploads to NZBGet via append', async () => {
      // Mock ensureCategory: config() (category already exists)
      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: [
              { Name: 'DestDir', Value: '/downloads' },
              { Name: 'Category1.Name', Value: 'readmeabook' },
              { Name: 'Category1.DestDir', Value: '/downloads' },
            ],
          },
        })
        // Mock append()
        .mockResolvedValueOnce({
          data: { result: 12345 },
        });

      // Mock NZB file download
      axiosMock.get.mockResolvedValueOnce({
        data: Buffer.from('fake-nzb-content'),
        headers: { 'content-disposition': 'attachment; filename="My.Audiobook.nzb"' },
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      const id = await service.addDownload('https://prowlarr.local/api/download/123', {
        category: 'readmeabook',
        priority: 'normal',
      });

      expect(id).toBe('12345');

      // Verify append call
      const appendCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'append'
      );
      expect(appendCall).toBeDefined();
      const [, body] = appendCall!;
      expect(body.method).toBe('append');
      expect(body.params[0]).toBe('My.Audiobook.nzb'); // Filename
      expect(body.params[2]).toBe('readmeabook'); // Category
      expect(body.params[3]).toBe(0); // Normal priority
    });

    it('maps high priority correctly', async () => {
      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: [
              { Name: 'DestDir', Value: '/downloads' },
              { Name: 'Category1.Name', Value: 'readmeabook' },
              { Name: 'Category1.DestDir', Value: '/downloads' },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { result: 99 } });

      axiosMock.get.mockResolvedValueOnce({
        data: Buffer.from('nzb'),
        headers: {},
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      const id = await service.addDownload('https://example.com/book.nzb', { priority: 'high' });

      expect(id).toBe('99');
      const appendCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'append'
      );
      expect(appendCall![1].params[3]).toBe(50); // High = 50
    });

    it('maps force priority correctly', async () => {
      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: [
              { Name: 'DestDir', Value: '/downloads' },
              { Name: 'Category1.Name', Value: 'readmeabook' },
              { Name: 'Category1.DestDir', Value: '/downloads' },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { result: 100 } });

      axiosMock.get.mockResolvedValueOnce({
        data: Buffer.from('nzb'),
        headers: {},
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      await service.addDownload('https://example.com/book.nzb', { priority: 'force' });

      const appendCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'append'
      );
      expect(appendCall![1].params[3]).toBe(900); // Force = 900
    });

    it('throws when NZBGet rejects the NZB', async () => {
      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: [
              { Name: 'DestDir', Value: '/downloads' },
              { Name: 'Category1.Name', Value: 'readmeabook' },
              { Name: 'Category1.DestDir', Value: '/downloads' },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { result: 0 } }); // 0 = rejected

      axiosMock.get.mockResolvedValueOnce({
        data: Buffer.from('nzb'),
        headers: {},
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      await expect(service.addDownload('https://example.com/bad.nzb')).rejects.toThrow('rejected');
    });

    it('throws when NZB file download fails with HTTP error', async () => {
      clientMock.post.mockResolvedValueOnce({
        data: {
          result: [
            { Name: 'DestDir', Value: '/downloads' },
            { Name: 'Category1.Name', Value: 'readmeabook' },
            { Name: 'Category1.DestDir', Value: '/downloads' },
          ],
        },
      });

      const httpError = new Error('Request failed') as any;
      httpError.response = { status: 404 };
      httpError.isAxiosError = true;
      axiosMock.isAxiosError.mockReturnValue(true);
      axiosMock.get.mockRejectedValueOnce(httpError);

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      await expect(service.addDownload('https://example.com/missing.nzb')).rejects.toThrow('HTTP 404');
    });

    it('throws when NZB file is empty', async () => {
      clientMock.post.mockResolvedValueOnce({
        data: {
          result: [
            { Name: 'DestDir', Value: '/downloads' },
            { Name: 'Category1.Name', Value: 'readmeabook' },
            { Name: 'Category1.DestDir', Value: '/downloads' },
          ],
        },
      });

      axiosMock.get.mockResolvedValueOnce({
        data: Buffer.from(''),
        headers: {},
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      await expect(service.addDownload('https://example.com/empty.nzb')).rejects.toThrow('empty');
    });

    it('extracts filename from URL when no Content-Disposition', async () => {
      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: [
              { Name: 'DestDir', Value: '/downloads' },
              { Name: 'Category1.Name', Value: 'readmeabook' },
              { Name: 'Category1.DestDir', Value: '/downloads' },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { result: 50 } });

      axiosMock.get.mockResolvedValueOnce({
        data: Buffer.from('nzb-content'),
        headers: {}, // No content-disposition
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      await service.addDownload('https://example.com/My.Great.Audiobook.nzb');

      const appendCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'append'
      );
      expect(appendCall![1].params[0]).toBe('My.Great.Audiobook.nzb');
    });

    it('decompresses gzip-compressed NZB files before uploading', async () => {
      const zlib = await import('zlib');
      const nzbXml = '<?xml version="1.0" encoding="UTF-8"?><nzb><file></file></nzb>';
      const compressedNzb = zlib.gzipSync(Buffer.from(nzbXml));

      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: [
              { Name: 'DestDir', Value: '/downloads' },
              { Name: 'Category1.Name', Value: 'readmeabook' },
              { Name: 'Category1.DestDir', Value: '/downloads' },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { result: 777 } });

      axiosMock.get.mockResolvedValueOnce({
        data: compressedNzb,
        headers: { 'content-disposition': 'attachment; filename="Book.nzb"' },
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      const id = await service.addDownload('https://example.com/nzb.gz');

      expect(id).toBe('777');

      // Verify the base64 content sent to NZBGet is the decompressed XML, not compressed bytes
      const appendCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'append'
      );
      const sentBase64 = appendCall![1].params[1];
      const decodedContent = Buffer.from(sentBase64, 'base64').toString('utf-8');
      expect(decodedContent).toBe(nzbXml);
    });

    it('falls back to download.nzb when filename cannot be extracted', async () => {
      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: [
              { Name: 'DestDir', Value: '/downloads' },
              { Name: 'Category1.Name', Value: 'readmeabook' },
              { Name: 'Category1.DestDir', Value: '/downloads' },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { result: 51 } });

      axiosMock.get.mockResolvedValueOnce({
        data: Buffer.from('nzb-content'),
        headers: {},
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      await service.addDownload('https://example.com/download');

      const appendCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'append'
      );
      expect(appendCall![1].params[0]).toBe('download.nzb');
    });
  });

  // =========================================================================
  // Getting Downloads
  // =========================================================================

  describe('getDownload', () => {
    it('returns queue item when download is active', async () => {
      // Mock listgroups (queue check)
      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: [
              {
                NZBID: 100,
                NZBName: 'Active Book',
                Status: 'DOWNLOADING',
                FileSizeMB: 500,
                DownloadedSizeMB: 250,
                RemainingSizeMB: 250,
                DownloadTimeSec: 120,
                Category: 'readmeabook',
                DestDir: '/downloads/readmeabook/Active.Book',
                FinalDir: '',
                MaxPriority: 0,
                ActiveDownloads: 1,
                Health: 1000,
                PostInfoText: '',
                PostStageProgress: 0,
              },
            ],
          },
        })
        // Mock status() for download speed (called inside mapGroupToDownloadInfo)
        .mockResolvedValueOnce({
          data: { result: { DownloadRate: 5242880 } }, // 5 MB/s
        });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('100');

      expect(info).not.toBeNull();
      expect(info!.id).toBe('100');
      expect(info!.name).toBe('Active Book');
      expect(info!.status).toBe('downloading');
      expect(info!.progress).toBe(0.5);
      expect(info!.size).toBe(500 * 1024 * 1024);
      expect(info!.bytesDownloaded).toBe(250 * 1024 * 1024);
      expect(info!.category).toBe('readmeabook');
      expect(info!.downloadSpeed).toBe(5242880);
    });

    it('returns history item when download is completed', async () => {
      // Mock listgroups (empty queue)
      clientMock.post
        .mockResolvedValueOnce({ data: { result: [] } })
        // Mock history
        .mockResolvedValueOnce({
          data: {
            result: [
              {
                NZBID: 200,
                Name: 'Completed Book',
                Status: 'SUCCESS/ALL',
                Category: 'readmeabook',
                FileSizeMB: 300,
                DownloadedSizeMB: 300,
                DestDir: '/downloads/readmeabook/Completed.Book',
                FinalDir: '/downloads/readmeabook/Completed.Book',
                DownloadTimeSec: 60,
                PostTotalTimeSec: 30,
                ParStatus: 'SUCCESS',
                UnpackStatus: 'SUCCESS',
                DeleteStatus: 'NONE',
                MarkStatus: 'NONE',
                HistoryTime: 1700000000,
                FailedArticles: 0,
                TotalArticles: 1000,
              },
            ],
          },
        });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('200');

      expect(info).not.toBeNull();
      expect(info!.id).toBe('200');
      expect(info!.name).toBe('Completed Book');
      expect(info!.status).toBe('completed');
      expect(info!.progress).toBe(1.0);
      expect(info!.bytesDownloaded).toBe(300 * 1024 * 1024);
      expect(info!.completedAt?.getTime()).toBe(1700000000 * 1000);
      expect(info!.downloadPath).toBe('/downloads/readmeabook/Completed.Book');
    });

    it('returns history item with failed status and error message', async () => {
      clientMock.post
        .mockResolvedValueOnce({ data: { result: [] } })
        .mockResolvedValueOnce({
          data: {
            result: [
              {
                NZBID: 300,
                Name: 'Failed Book',
                Status: 'FAILURE/PAR',
                Category: 'readmeabook',
                FileSizeMB: 100,
                DownloadedSizeMB: 80,
                DestDir: '/downloads/Failed.Book',
                FinalDir: '',
                DownloadTimeSec: 45,
                PostTotalTimeSec: 10,
                ParStatus: 'FAILURE',
                UnpackStatus: 'NONE',
                DeleteStatus: 'NONE',
                MarkStatus: 'NONE',
                HistoryTime: 1700000100,
                FailedArticles: 50,
                TotalArticles: 500,
              },
            ],
          },
        });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('300');

      expect(info!.status).toBe('failed');
      expect(info!.errorMessage).toContain('FAILURE/PAR');
      expect(info!.errorMessage).toContain('Par: FAILURE');
      expect(info!.errorMessage).toContain('50 failed articles (10%)');
    });

    it('returns null when download is not found', async () => {
      clientMock.post
        .mockResolvedValueOnce({ data: { result: [] } })
        .mockResolvedValueOnce({ data: { result: [] } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('999');

      expect(info).toBeNull();
    });

    it('returns null for invalid NZB ID', async () => {
      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('not-a-number');

      expect(info).toBeNull();
    });

    it('applies path mapping to download path', async () => {
      clientMock.post
        .mockResolvedValueOnce({ data: { result: [] } })
        .mockResolvedValueOnce({
          data: {
            result: [
              {
                NZBID: 400,
                Name: 'Mapped Book',
                Status: 'SUCCESS/ALL',
                Category: 'readmeabook',
                FileSizeMB: 200,
                DownloadedSizeMB: 200,
                DestDir: '/remote/downloads/readmeabook/Mapped.Book',
                FinalDir: '/remote/downloads/readmeabook/Mapped.Book',
                DownloadTimeSec: 30,
                PostTotalTimeSec: 15,
                ParStatus: 'SUCCESS',
                UnpackStatus: 'SUCCESS',
                DeleteStatus: 'NONE',
                MarkStatus: 'NONE',
                HistoryTime: 1700000200,
                FailedArticles: 0,
                TotalArticles: 800,
              },
            ],
          },
        });

      const service = new NZBGetService(
        'http://nzbget:6789', 'nzbget', 'pass',
        'readmeabook', '/downloads', false,
        { enabled: true, remotePath: '/remote/downloads', localPath: '/downloads' }
      );
      const info = await service.getDownload('400');

      // Path mapping is now applied downstream by consumers, not by the service itself.
      // The service returns the raw path from NZBGet.
      const normalizedPath = info!.downloadPath!.replace(/\\/g, '/');
      expect(normalizedPath).toContain('/remote/downloads/readmeabook/Mapped.Book');
    });
  });

  // =========================================================================
  // Status Mapping
  // =========================================================================

  describe('status mapping', () => {
    const makeQueueItem = (status: string) => ({
      NZBID: 1,
      NZBName: 'Test',
      Status: status,
      FileSizeMB: 100,
      DownloadedSizeMB: 50,
      RemainingSizeMB: 50,
      DownloadTimeSec: 60,
      Category: '',
      DestDir: '',
      FinalDir: '',
      MaxPriority: 0,
      ActiveDownloads: 0,
      Health: 1000,
      PostInfoText: '',
      PostStageProgress: 0,
    });

    const makeHistoryItem = (status: string) => ({
      NZBID: 1,
      Name: 'Test',
      Status: status,
      Category: '',
      FileSizeMB: 100,
      DownloadedSizeMB: 100,
      DestDir: '',
      FinalDir: '',
      DownloadTimeSec: 60,
      PostTotalTimeSec: 10,
      ParStatus: 'NONE',
      UnpackStatus: 'NONE',
      DeleteStatus: 'NONE',
      MarkStatus: 'NONE',
      HistoryTime: 0,
      FailedArticles: 0,
      TotalArticles: 100,
    });

    it.each([
      ['QUEUED', 'queued'],
      ['PAUSED', 'paused'],
      ['DOWNLOADING', 'downloading'],
      ['FETCHING', 'downloading'],
      ['PP_QUEUED', 'processing'],
      ['LOADING_PARS', 'processing'],
      ['VERIFYING_SOURCES', 'processing'],
      ['REPAIRING', 'processing'],
      ['VERIFYING_REPAIRED', 'processing'],
      ['RENAMING', 'processing'],
      ['UNPACKING', 'processing'],
      ['MOVING', 'processing'],
      ['EXECUTING_SCRIPT', 'processing'],
      ['PP_FINISHED', 'processing'],
    ])('maps queue status %s to %s', async (nzbgetStatus, expectedStatus) => {
      clientMock.post.mockResolvedValueOnce({
        data: { result: [makeQueueItem(nzbgetStatus)] },
      });
      // Mock status() for downloading items
      if (expectedStatus === 'downloading') {
        clientMock.post.mockResolvedValueOnce({
          data: { result: { DownloadRate: 0 } },
        });
      }

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('1');

      expect(info!.status).toBe(expectedStatus);
    });

    it.each([
      ['SUCCESS/ALL', 'completed'],
      ['SUCCESS/UNPACK', 'completed'],
      ['SUCCESS/PAR', 'completed'],
      ['SUCCESS/HEALTH', 'completed'],
      ['SUCCESS/GOOD', 'completed'],
      ['SUCCESS/MARK', 'completed'],
      ['WARNING/SCRIPT', 'completed'],
      ['WARNING/SPACE', 'completed'],
      ['WARNING/PASSWORD', 'completed'],
      ['WARNING/HEALTH', 'completed'],
      ['FAILURE/PAR', 'failed'],
      ['FAILURE/UNPACK', 'failed'],
      ['FAILURE/HEALTH', 'failed'],
      ['DELETED/MANUAL', 'failed'],
      ['DELETED/DUPE', 'failed'],
    ])('maps history status %s to %s', async (nzbgetStatus, expectedStatus) => {
      clientMock.post
        .mockResolvedValueOnce({ data: { result: [] } }) // Empty queue
        .mockResolvedValueOnce({
          data: { result: [makeHistoryItem(nzbgetStatus)] },
        });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('1');

      expect(info!.status).toBe(expectedStatus);
    });

    it('defaults unknown queue status to downloading', async () => {
      clientMock.post
        .mockResolvedValueOnce({
          data: { result: [makeQueueItem('UNKNOWN_STATUS')] },
        })
        .mockResolvedValueOnce({
          data: { result: { DownloadRate: 0 } },
        });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('1');

      expect(info!.status).toBe('downloading');
    });
  });

  // =========================================================================
  // Pause / Resume / Delete
  // =========================================================================

  describe('pauseDownload', () => {
    it('calls editqueue with GroupPause', async () => {
      clientMock.post.mockResolvedValueOnce({ data: { result: true } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      await service.pauseDownload('100');

      expect(clientMock.post).toHaveBeenCalledWith('/jsonrpc', {
        method: 'editqueue',
        params: ['GroupPause', '', [100]],
      });
    });

    it('throws when pause fails', async () => {
      clientMock.post.mockResolvedValueOnce({ data: { result: false } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      await expect(service.pauseDownload('100')).rejects.toThrow('Failed to pause');
    });
  });

  describe('resumeDownload', () => {
    it('calls editqueue with GroupResume', async () => {
      clientMock.post.mockResolvedValueOnce({ data: { result: true } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      await service.resumeDownload('100');

      expect(clientMock.post).toHaveBeenCalledWith('/jsonrpc', {
        method: 'editqueue',
        params: ['GroupResume', '', [100]],
      });
    });

    it('throws when resume fails', async () => {
      clientMock.post.mockResolvedValueOnce({ data: { result: false } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      await expect(service.resumeDownload('100')).rejects.toThrow('Failed to resume');
    });
  });

  describe('deleteDownload', () => {
    it('deletes from queue with GroupFinalDelete when deleteFiles is true', async () => {
      // Mock listgroups to find item in queue
      clientMock.post
        .mockResolvedValueOnce({
          data: { result: [{ NZBID: 100 }] },
        })
        // Mock editqueue GroupFinalDelete
        .mockResolvedValueOnce({ data: { result: true } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      await service.deleteDownload('100', true);

      const deleteCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'editqueue'
      );
      expect(deleteCall![1].params[0]).toBe('GroupFinalDelete');
    });

    it('deletes from queue with GroupDelete when deleteFiles is false', async () => {
      clientMock.post
        .mockResolvedValueOnce({
          data: { result: [{ NZBID: 100 }] },
        })
        .mockResolvedValueOnce({ data: { result: true } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      await service.deleteDownload('100', false);

      const deleteCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'editqueue'
      );
      expect(deleteCall![1].params[0]).toBe('GroupDelete');
    });

    it('deletes from history when not in queue', async () => {
      // Empty queue
      clientMock.post
        .mockResolvedValueOnce({ data: { result: [] } })
        // Mock editqueue HistoryFinalDelete
        .mockResolvedValueOnce({ data: { result: true } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      await service.deleteDownload('200', true);

      const deleteCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'editqueue'
      );
      expect(deleteCall![1].params[0]).toBe('HistoryFinalDelete');
    });

    it('throws when delete from history fails', async () => {
      clientMock.post
        .mockResolvedValueOnce({ data: { result: [] } })
        .mockResolvedValueOnce({ data: { result: false } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      await expect(service.deleteDownload('999', true)).rejects.toThrow('Failed to delete');
    });
  });

  // =========================================================================
  // Post-Process (Archive from History)
  // =========================================================================

  describe('postProcess', () => {
    it('archives completed download from history via HistoryDelete', async () => {
      clientMock.post.mockResolvedValueOnce({ data: { result: true } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      await service.postProcess('200');

      expect(clientMock.post).toHaveBeenCalledWith('/jsonrpc', {
        method: 'editqueue',
        params: ['HistoryDelete', '', [200]],
      });
    });

    it('throws when archive fails', async () => {
      clientMock.post.mockResolvedValueOnce({ data: { result: false } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      await expect(service.postProcess('200')).rejects.toThrow('not found in history or failed to archive');
    });
  });

  // =========================================================================
  // Category Management
  // =========================================================================

  describe('ensureCategory', () => {
    it('creates category and preserves all existing config', async () => {
      const existingConfig = [
        { Name: 'DestDir', Value: '/downloads' },
        { Name: 'MainDir', Value: '/root/downloads' },
        { Name: 'ServerHost', Value: '0.0.0.0' },
        // Read-only entries returned by config() that must NOT be saved back
        { Name: 'ConfigFile', Value: '/config/nzbget.conf' },
        { Name: 'AppBin', Value: '/app/nzbget/nzbget' },
        { Name: 'AppDir', Value: '/app/nzbget' },
        { Name: 'Version', Value: '26.0' },
      ];
      clientMock.post
        // config()
        .mockResolvedValueOnce({ data: { result: existingConfig } })
        // saveconfig()
        .mockResolvedValueOnce({ data: { result: true } })
        // reload()
        .mockResolvedValueOnce({ data: { result: true } })
        // version() poll
        .mockResolvedValueOnce({ data: { result: '21.1' } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      await service.ensureCategory();

      const saveCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'saveconfig'
      );
      expect(saveCall).toBeDefined();
      const savedConfig = saveCall![1].params[0];

      // Must contain ALL original writable entries (not wiped)
      expect(savedConfig).toEqual(expect.arrayContaining([
        { Name: 'DestDir', Value: '/downloads' },
        { Name: 'MainDir', Value: '/root/downloads' },
        { Name: 'ServerHost', Value: '0.0.0.0' },
      ]));
      // Plus our new category entries
      expect(savedConfig).toEqual(expect.arrayContaining([
        { Name: 'Category1.Name', Value: 'readmeabook' },
        { Name: 'Category1.DestDir', Value: '/downloads' },
        { Name: 'Category1.Unpack', Value: 'yes' },
      ]));

      // Read-only entries must NOT be in the saved config
      const savedNames = savedConfig.map((e: any) => e.Name);
      expect(savedNames).not.toContain('ConfigFile');
      expect(savedNames).not.toContain('AppBin');
      expect(savedNames).not.toContain('AppDir');
      expect(savedNames).not.toContain('Version');

      // Verify reload was called to apply changes
      const reloadCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'reload'
      );
      expect(reloadCall).toBeDefined();
    });

    it('uses next available slot and preserves existing categories', async () => {
      const existingConfig = [
        { Name: 'DestDir', Value: '/downloads' },
        { Name: 'Category1.Name', Value: 'movies' },
        { Name: 'Category1.DestDir', Value: '/downloads/movies' },
        { Name: 'Category2.Name', Value: 'tv' },
        { Name: 'Category2.DestDir', Value: '/downloads/tv' },
      ];
      clientMock.post
        .mockResolvedValueOnce({ data: { result: existingConfig } })
        .mockResolvedValueOnce({ data: { result: true } })
        // reload + version
        .mockResolvedValueOnce({ data: { result: true } })
        .mockResolvedValueOnce({ data: { result: '21.1' } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      await service.ensureCategory();

      const saveCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'saveconfig'
      );
      const savedConfig = saveCall![1].params[0];

      // Existing categories preserved
      expect(savedConfig).toEqual(expect.arrayContaining([
        { Name: 'Category1.Name', Value: 'movies' },
        { Name: 'Category1.DestDir', Value: '/downloads/movies' },
        { Name: 'Category2.Name', Value: 'tv' },
        { Name: 'Category2.DestDir', Value: '/downloads/tv' },
      ]));
      // New category in slot 3
      expect(savedConfig).toEqual(expect.arrayContaining([
        { Name: 'Category3.Name', Value: 'readmeabook' },
        { Name: 'Category3.DestDir', Value: '/downloads' },
      ]));
    });

    it('returns configured category names in slot order', async () => {
      clientMock.post.mockResolvedValueOnce({
        data: {
          result: [
            { Name: 'DestDir', Value: '/downloads' },
            { Name: 'Category2.Name', Value: 'audiobooks' },
            { Name: 'Category2.DestDir', Value: '/downloads/audiobooks' },
            { Name: 'Category1.Name', Value: 'readmeabook' },
            { Name: 'Category1.DestDir', Value: '/downloads' },
          ],
        },
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      const categories = await service.getCategories();

      expect(categories).toEqual(['readmeabook', 'audiobooks']);
    });

    it('does not update when category exists with correct path', async () => {
      clientMock.post.mockResolvedValueOnce({
        data: {
          result: [
            { Name: 'DestDir', Value: '/downloads' },
            { Name: 'Category1.Name', Value: 'readmeabook' },
            { Name: 'Category1.DestDir', Value: '/downloads' },
          ],
        },
      });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      await service.ensureCategory();

      // Only config() should be called — no saveconfig, no reload
      expect(clientMock.post).toHaveBeenCalledTimes(1);
      expect(clientMock.post.mock.calls[0][1].method).toBe('config');
    });

    it('updates category DestDir preserving full config and reloads', async () => {
      const existingConfig = [
        { Name: 'DestDir', Value: '/downloads' },
        { Name: 'ServerHost', Value: '0.0.0.0' },
        { Name: 'Category1.Name', Value: 'readmeabook' },
        { Name: 'Category1.DestDir', Value: '/old/path' },
        // Read-only entries that must be filtered out
        { Name: 'ConfigFile', Value: '/config/nzbget.conf' },
        { Name: 'AppBin', Value: '/app/nzbget/nzbget' },
        { Name: 'AppDir', Value: '/app/nzbget' },
        { Name: 'Version', Value: '26.0' },
      ];
      clientMock.post
        .mockResolvedValueOnce({ data: { result: existingConfig } })
        .mockResolvedValueOnce({ data: { result: true } })
        // reload + version
        .mockResolvedValueOnce({ data: { result: true } })
        .mockResolvedValueOnce({ data: { result: '21.1' } });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      await service.ensureCategory();

      const saveCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'saveconfig'
      );
      const savedConfig = saveCall![1].params[0];

      // Full writable config preserved with updated DestDir — no read-only entries
      expect(savedConfig).toEqual([
        { Name: 'DestDir', Value: '/downloads' },
        { Name: 'ServerHost', Value: '0.0.0.0' },
        { Name: 'Category1.Name', Value: 'readmeabook' },
        { Name: 'Category1.DestDir', Value: '/downloads' },
      ]);
    });

    it('applies reverse path mapping for category DestDir', async () => {
      const existingConfig = [
        { Name: 'DestDir', Value: '/remote/downloads' },
      ];
      clientMock.post
        .mockResolvedValueOnce({ data: { result: existingConfig } })
        .mockResolvedValueOnce({ data: { result: true } })
        // reload + version
        .mockResolvedValueOnce({ data: { result: true } })
        .mockResolvedValueOnce({ data: { result: '21.1' } });

      const service = new NZBGetService(
        'http://nzbget:6789', 'nzbget', 'pass',
        'readmeabook', '/downloads', false,
        { enabled: true, remotePath: '/remote/downloads', localPath: '/downloads' }
      );
      await service.ensureCategory();

      const saveCall = clientMock.post.mock.calls.find(
        (call: any[]) => call[1]?.method === 'saveconfig'
      );
      const savedConfig = saveCall![1].params[0];
      // After reverse transform: /downloads → /remote/downloads
      const destDirEntry = savedConfig.find(
        (e: any) => e.Name === 'Category1.DestDir'
      );
      expect(destDirEntry.Value).toBe('/remote/downloads');
      // Original config preserved
      expect(savedConfig).toEqual(expect.arrayContaining([
        { Name: 'DestDir', Value: '/remote/downloads' },
      ]));
    });

    it('continues if reload fails after saveconfig', async () => {
      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: [
              { Name: 'DestDir', Value: '/downloads' },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { result: true } })
        // reload fails
        .mockRejectedValueOnce(new Error('Connection reset'));

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      // Should not throw — reload failure is handled gracefully
      await expect(service.ensureCategory()).resolves.toBeUndefined();
    });

    it('swallows errors when category management fails', async () => {
      clientMock.post.mockRejectedValueOnce(new Error('Config read failed'));

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass', 'readmeabook', '/downloads');
      // Should not throw
      await expect(service.ensureCategory()).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // Error Message Building
  // =========================================================================

  describe('error messages', () => {
    it('builds descriptive error for failed history item with unpack failure', async () => {
      clientMock.post
        .mockResolvedValueOnce({ data: { result: [] } })
        .mockResolvedValueOnce({
          data: {
            result: [
              {
                NZBID: 500,
                Name: 'Unpack Fail Book',
                Status: 'FAILURE/UNPACK',
                Category: '',
                FileSizeMB: 100,
                DownloadedSizeMB: 100,
                DestDir: '',
                FinalDir: '',
                DownloadTimeSec: 60,
                PostTotalTimeSec: 5,
                ParStatus: 'SUCCESS',
                UnpackStatus: 'FAILURE',
                DeleteStatus: 'NONE',
                MarkStatus: 'NONE',
                HistoryTime: 0,
                FailedArticles: 0,
                TotalArticles: 100,
              },
            ],
          },
        });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('500');

      expect(info!.errorMessage).toContain('FAILURE/UNPACK');
      expect(info!.errorMessage).toContain('Unpack: FAILURE');
    });

    it('includes delete status in error message when present', async () => {
      clientMock.post
        .mockResolvedValueOnce({ data: { result: [] } })
        .mockResolvedValueOnce({
          data: {
            result: [
              {
                NZBID: 600,
                Name: 'Deleted Book',
                Status: 'DELETED/HEALTH',
                Category: '',
                FileSizeMB: 100,
                DownloadedSizeMB: 50,
                DestDir: '',
                FinalDir: '',
                DownloadTimeSec: 30,
                PostTotalTimeSec: 0,
                ParStatus: 'NONE',
                UnpackStatus: 'NONE',
                DeleteStatus: 'HEALTH',
                MarkStatus: 'NONE',
                HistoryTime: 0,
                FailedArticles: 100,
                TotalArticles: 500,
              },
            ],
          },
        });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('600');

      expect(info!.errorMessage).toContain('DELETED/HEALTH');
      expect(info!.errorMessage).toContain('Delete: HEALTH');
      expect(info!.errorMessage).toContain('100 failed articles (20%)');
    });
  });

  // =========================================================================
  // Singleton Factory
  // =========================================================================

  describe('singleton factory', () => {
    it('creates a singleton service from config', async () => {
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'client-1',
        type: 'nzbget',
        name: 'NZBGet',
        enabled: true,
        url: 'http://nzbget:6789',
        username: 'nzbget',
        password: 'password123',
        disableSSLVerify: false,
        remotePathMappingEnabled: false,
        category: 'readmeabook',
      });
      configServiceMock.get.mockResolvedValue('/downloads');

      const ensureSpy = vi.spyOn(NZBGetService.prototype, 'ensureCategory').mockResolvedValue();

      const service = await getNZBGetService();
      const again = await getNZBGetService();

      expect(service).toBe(again); // Same instance
      expect(ensureSpy).toHaveBeenCalled();

      ensureSpy.mockRestore();
    });

    it('creates singleton with path mapping config', async () => {
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'client-2',
        type: 'nzbget',
        name: 'NZBGet',
        enabled: true,
        url: 'http://nzbget:6789',
        username: 'nzbget',
        password: 'password123',
        disableSSLVerify: false,
        remotePathMappingEnabled: true,
        remotePath: '/remote/downloads',
        localPath: '/downloads',
        category: 'readmeabook',
      });
      configServiceMock.get.mockResolvedValue('/downloads');

      const ensureSpy = vi.spyOn(NZBGetService.prototype, 'ensureCategory').mockResolvedValue();

      const service = await getNZBGetService();

      expect(service).toBeDefined();
      expect(ensureSpy).toHaveBeenCalled();

      ensureSpy.mockRestore();
    });

    it('throws when no usenet client is configured', async () => {
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue(null);

      await expect(getNZBGetService()).rejects.toThrow('not configured');
    });

    it('throws when configured usenet client is not NZBGet', async () => {
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'client-3',
        type: 'sabnzbd',
        name: 'SABnzbd',
        enabled: true,
        url: 'http://sab',
        password: 'api-key',
      });

      await expect(getNZBGetService()).rejects.toThrow('Expected NZBGet');
    });

    it('invalidates singleton and recreates on next call', async () => {
      downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
        id: 'client-4',
        type: 'nzbget',
        name: 'NZBGet',
        enabled: true,
        url: 'http://nzbget:6789',
        username: 'nzbget',
        password: 'pass',
        disableSSLVerify: false,
        remotePathMappingEnabled: false,
        category: 'readmeabook',
      });
      configServiceMock.get.mockResolvedValue('/downloads');

      const ensureSpy = vi.spyOn(NZBGetService.prototype, 'ensureCategory').mockResolvedValue();

      const first = await getNZBGetService();
      invalidateNZBGetService();
      const second = await getNZBGetService();

      expect(first).not.toBe(second);

      ensureSpy.mockRestore();
    });
  });

  // =========================================================================
  // Usenet-specific fields
  // =========================================================================

  describe('usenet-specific behavior', () => {
    it('returns undefined for seeding-related fields', async () => {
      clientMock.post
        .mockResolvedValueOnce({ data: { result: [] } })
        .mockResolvedValueOnce({
          data: {
            result: [
              {
                NZBID: 700,
                Name: 'Usenet Book',
                Status: 'SUCCESS/ALL',
                Category: 'readmeabook',
                FileSizeMB: 100,
                DownloadedSizeMB: 100,
                DestDir: '/downloads',
                FinalDir: '',
                DownloadTimeSec: 30,
                PostTotalTimeSec: 10,
                ParStatus: 'SUCCESS',
                UnpackStatus: 'SUCCESS',
                DeleteStatus: 'NONE',
                MarkStatus: 'NONE',
                HistoryTime: 1700000000,
                FailedArticles: 0,
                TotalArticles: 100,
              },
            ],
          },
        });

      const service = new NZBGetService('http://nzbget:6789', 'nzbget', 'pass');
      const info = await service.getDownload('700');

      expect(info!.seedingTime).toBeUndefined();
      expect(info!.ratio).toBeUndefined();
    });
  });
});
