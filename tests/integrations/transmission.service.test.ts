/**
 * Component: Transmission Integration Service Tests
 * Documentation: documentation/phase3/download-clients.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransmissionService } from '@/lib/integrations/transmission.service';

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

const axiosMock = vi.hoisted(() => ({
  create: vi.fn(() => clientMock),
  post: vi.fn(),
  get: vi.fn(),
  isAxiosError: (error: any) => Boolean(error?.isAxiosError),
}));

const parseTorrentMock = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: axiosMock,
  ...axiosMock,
}));

vi.mock('parse-torrent', () => ({
  default: parseTorrentMock,
}));

describe('TransmissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    axiosMock.get.mockReset();
    axiosMock.post.mockReset();
    parseTorrentMock.mockReset();
  });

  describe('constructor', () => {
    it('sets clientType and protocol correctly', () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      expect(service.clientType).toBe('transmission');
      expect(service.protocol).toBe('torrent');
    });
  });

  describe('testConnection', () => {
    it('returns success with version on valid connection', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      clientMock.post.mockResolvedValueOnce({
        data: { result: 'success', arguments: { version: '4.0.5' } },
      });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.version).toBe('4.0.5');
      expect(result.message).toContain('Transmission');
    });

    it('returns failure when RPC returns error', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      clientMock.post.mockResolvedValueOnce({
        data: { result: 'unauthorized' },
      });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('unauthorized');
    });

    it('returns failure on connection error', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      clientMock.post.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection refused');
    });

    it('returns SSL-specific errors', async () => {
      const service = new TransmissionService('https://transmission', 'user', 'pass');
      clientMock.post.mockRejectedValueOnce({
        isAxiosError: true,
        code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
        message: 'self signed',
      });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('SSL certificate verification failed');
    });

    it('returns ECONNREFUSED error with URL', async () => {
      const service = new TransmissionService('http://transmission:9091', 'user', 'pass');
      clientMock.post.mockRejectedValueOnce({
        isAxiosError: true,
        code: 'ECONNREFUSED',
        message: 'refused',
      });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection refused');
      expect(result.message).toContain('http://transmission:9091');
    });

    it('returns 401 authentication error', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      clientMock.post.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 401 },
        message: 'Unauthorized',
      });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Authentication failed');
    });
  });

  describe('CSRF handling', () => {
    it('captures X-Transmission-Session-Id on 409 and retries', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      // First call returns 409 with session ID
      clientMock.post
        .mockRejectedValueOnce({
          isAxiosError: true,
          response: {
            status: 409,
            headers: { 'x-transmission-session-id': 'csrf-token-123' },
          },
        })
        // Retry succeeds
        .mockResolvedValueOnce({
          data: { result: 'success', arguments: { version: '4.0.5' } },
        });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(clientMock.post).toHaveBeenCalledTimes(2);

      // Verify second call includes the session ID header
      const secondCall = clientMock.post.mock.calls[1];
      expect(secondCall[2].headers['X-Transmission-Session-Id']).toBe('csrf-token-123');
    });
  });

  describe('addDownload', () => {
    it('rejects empty URLs', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      await expect(service.addDownload('')).rejects.toThrow('Invalid download URL');
    });

    it('adds magnet links via torrent-add RPC', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      // getTorrentByHash - not found (no duplicate)
      clientMock.post
        .mockResolvedValueOnce({
          data: { result: 'success', arguments: { torrents: [] } },
        })
        // torrent-add
        .mockResolvedValueOnce({
          data: {
            result: 'success',
            arguments: {
              'torrent-added': { hashString: '0123456789abcdef0123456789abcdef01234567', name: 'Test' },
            },
          },
        });

      const hash = await service.addDownload(
        'magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567'
      );

      expect(hash).toBe('0123456789abcdef0123456789abcdef01234567');
    });

    it('skips duplicate magnet links', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      // getTorrentByHash - found (duplicate)
      clientMock.post.mockResolvedValueOnce({
        data: {
          result: 'success',
          arguments: {
            torrents: [{
              hashString: '0123456789abcdef0123456789abcdef01234567',
              name: 'Existing',
            }],
          },
        },
      });

      const hash = await service.addDownload(
        'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
      );

      expect(hash).toBe('0123456789abcdef0123456789abcdef01234567');
      // Only 1 RPC call (torrent-get), no torrent-add
      expect(clientMock.post).toHaveBeenCalledTimes(1);
    });

    it('throws on invalid magnet link', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      await expect(service.addDownload('magnet:?xt=urn:btih:')).rejects.toThrow('Invalid magnet link');
    });

    it('throws when Transmission rejects the magnet link', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      // No duplicate
      clientMock.post
        .mockResolvedValueOnce({
          data: { result: 'success', arguments: { torrents: [] } },
        })
        // torrent-add fails
        .mockResolvedValueOnce({
          data: { result: 'duplicate torrent' },
        });

      await expect(
        service.addDownload('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567')
      ).rejects.toThrow('Transmission rejected magnet link');
    });

    it('adds .torrent files via metainfo base64', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('torrent-data') });
      parseTorrentMock.mockResolvedValueOnce({ infoHash: 'parsed-hash', name: 'Book' });

      // getTorrentByHash - not found
      clientMock.post
        .mockResolvedValueOnce({
          data: { result: 'success', arguments: { torrents: [] } },
        })
        // torrent-add succeeds
        .mockResolvedValueOnce({
          data: {
            result: 'success',
            arguments: {
              'torrent-added': { hashString: 'parsed-hash', name: 'Book' },
            },
          },
        });

      const hash = await service.addDownload('http://example.com/file.torrent');

      expect(hash).toBe('parsed-hash');
      // Verify metainfo was sent
      const addCall = clientMock.post.mock.calls[1];
      const body = addCall[0] === '/transmission/rpc' ? JSON.parse(JSON.stringify(addCall[1])) : null;
      // The body should be the RPC call with metainfo
    });

    it('follows redirect to magnet link', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      axiosMock.get.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 302,
          headers: { location: 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01' },
        },
      });

      // getTorrentByHash - not found
      clientMock.post
        .mockResolvedValueOnce({
          data: { result: 'success', arguments: { torrents: [] } },
        })
        // torrent-add
        .mockResolvedValueOnce({
          data: {
            result: 'success',
            arguments: {
              'torrent-added': { hashString: 'abcdef0123456789abcdef0123456789abcdef01', name: 'Test' },
            },
          },
        });

      const hash = await service.addDownload('http://example.com/file.torrent');
      expect(hash).toBe('abcdef0123456789abcdef0123456789abcdef01');
    });

    it('follows a second-hop redirect to a magnet link (e.g. Prowlarr -> Jackett -> magnet)', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      // First hop: e.g. Prowlarr's redirect -> the indexer's own URL (not yet a magnet)
      axiosMock.get.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 301,
          headers: { location: 'https://jackett.example/dl/audiobookbay/?path=abc' },
        },
      });

      // Second hop: the indexer's own redirect -> the actual magnet
      axiosMock.get.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 302,
          headers: { location: 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01' },
        },
      });

      // getTorrentByHash - not found
      clientMock.post
        .mockResolvedValueOnce({
          data: { result: 'success', arguments: { torrents: [] } },
        })
        // torrent-add
        .mockResolvedValueOnce({
          data: {
            result: 'success',
            arguments: {
              'torrent-added': { hashString: 'abcdef0123456789abcdef0123456789abcdef01', name: 'Test' },
            },
          },
        });

      const hash = await service.addDownload('http://prowlarr.example/5/download?link=abc');
      expect(hash).toBe('abcdef0123456789abcdef0123456789abcdef01');
      expect(axiosMock.get).toHaveBeenCalledTimes(2);
    });

    it('throws on invalid .torrent file', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('not-a-torrent') });
      parseTorrentMock.mockRejectedValueOnce(new Error('bad torrent'));

      await expect(service.addDownload('http://example.com/file.torrent')).rejects.toThrow(
        'Invalid .torrent file - failed to parse'
      );
    });
  });

  describe('getDownload', () => {
    it('returns mapped DownloadInfo for found torrents', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      clientMock.post.mockResolvedValueOnce({
        data: {
          result: 'success',
          arguments: {
            torrents: [{
              hashString: 'abc123',
              name: 'Audiobook',
              totalSize: 1000,
              downloadedEver: 500,
              percentDone: 0.5,
              status: 4, // downloading
              rateDownload: 1000,
              eta: 500,
              labels: ['readmeabook'],
              downloadDir: '/downloads',
              doneDate: 0,
              errorString: '',
              error: 0,
              secondsSeeding: 3600,
              uploadRatio: 0.1,
              uploadedEver: 50,
            }],
          },
        },
      });

      const info = await service.getDownload('abc123');

      expect(info).not.toBeNull();
      expect(info!.id).toBe('abc123');
      expect(info!.name).toBe('Audiobook');
      expect(info!.status).toBe('downloading');
      expect(info!.progress).toBe(0.5);
      expect(info!.downloadSpeed).toBe(1000);
      expect(info!.category).toBe('readmeabook');
      expect(info!.seedingTime).toBe(3600);
    });

    it('returns null when torrent not found after retries', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      // All retries return empty
      clientMock.post.mockResolvedValue({
        data: { result: 'success', arguments: { torrents: [] } },
      });

      const info = await service.getDownload('nonexistent');

      expect(info).toBeNull();
    });

    it('maps error code to failed status', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      clientMock.post.mockResolvedValueOnce({
        data: {
          result: 'success',
          arguments: {
            torrents: [{
              hashString: 'abc123',
              name: 'Failed',
              totalSize: 1000,
              downloadedEver: 0,
              percentDone: 0,
              status: 0,
              rateDownload: 0,
              eta: -1,
              labels: [],
              downloadDir: '/downloads',
              doneDate: 0,
              errorString: 'Tracker error',
              error: 2,
              uploadRatio: -1,
              uploadedEver: 0,
            }],
          },
        },
      });

      const info = await service.getDownload('abc123');

      expect(info).not.toBeNull();
      expect(info!.status).toBe('failed');
      expect(info!.errorMessage).toBe('Tracker error');
    });
  });

  describe('status mapping', () => {
    const makeService = () => new TransmissionService('http://transmission', '', '');

    const mapStatus = (service: TransmissionService, status: number, error = 0) => {
      return (service as any).mapStatus(status, error);
    };

    it('maps 0 (stopped) to paused', () => {
      expect(mapStatus(makeService(), 0)).toBe('paused');
    });

    it('maps 1 (check-pending) to checking', () => {
      expect(mapStatus(makeService(), 1)).toBe('checking');
    });

    it('maps 2 (checking) to checking', () => {
      expect(mapStatus(makeService(), 2)).toBe('checking');
    });

    it('maps 3 (download-pending) to queued', () => {
      expect(mapStatus(makeService(), 3)).toBe('queued');
    });

    it('maps 4 (downloading) to downloading', () => {
      expect(mapStatus(makeService(), 4)).toBe('downloading');
    });

    it('maps 5 (seed-pending) to seeding', () => {
      expect(mapStatus(makeService(), 5)).toBe('seeding');
    });

    it('maps 6 (seeding) to seeding', () => {
      expect(mapStatus(makeService(), 6)).toBe('seeding');
    });

    it('maps any status with error > 0 to failed', () => {
      expect(mapStatus(makeService(), 4, 1)).toBe('failed');
      expect(mapStatus(makeService(), 6, 2)).toBe('failed');
    });
  });

  describe('pauseDownload / resumeDownload / deleteDownload', () => {
    it('pauses torrents via torrent-stop', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: 'success',
            arguments: {
              torrents: [{ hashString: 'hash-1', name: 'Test' }],
            },
          },
        })
        .mockResolvedValueOnce({ data: { result: 'success' } });

      await service.pauseDownload('hash-1');

      const stopCall = clientMock.post.mock.calls[1];
      expect(stopCall[1]).toEqual(
        expect.objectContaining({ method: 'torrent-stop' })
      );
    });

    it('resumes torrents via torrent-start', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: 'success',
            arguments: {
              torrents: [{ hashString: 'hash-1', name: 'Test' }],
            },
          },
        })
        .mockResolvedValueOnce({ data: { result: 'success' } });

      await service.resumeDownload('hash-1');

      const startCall = clientMock.post.mock.calls[1];
      expect(startCall[1]).toEqual(
        expect.objectContaining({ method: 'torrent-start' })
      );
    });

    it('deletes torrents via torrent-remove', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');

      clientMock.post
        .mockResolvedValueOnce({
          data: {
            result: 'success',
            arguments: {
              torrents: [{ hashString: 'hash-1', name: 'Test' }],
            },
          },
        })
        .mockResolvedValueOnce({ data: { result: 'success' } });

      await service.deleteDownload('hash-1', true);

      const removeCall = clientMock.post.mock.calls[1];
      expect(removeCall[1]).toEqual(
        expect.objectContaining({
          method: 'torrent-remove',
          arguments: expect.objectContaining({ 'delete-local-data': true }),
        })
      );
    });

    it('throws when pause fails', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      clientMock.post.mockRejectedValueOnce(new Error('fail'));

      await expect(service.pauseDownload('hash-1')).rejects.toThrow('Failed to pause torrent');
    });

    it('throws when resume fails', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      clientMock.post.mockRejectedValueOnce(new Error('fail'));

      await expect(service.resumeDownload('hash-1')).rejects.toThrow('Failed to resume torrent');
    });

    it('throws when delete fails', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      clientMock.post.mockRejectedValueOnce(new Error('fail'));

      await expect(service.deleteDownload('hash-1')).rejects.toThrow('Failed to delete torrent');
    });
  });

  describe('postProcess', () => {
    it('is a no-op', async () => {
      const service = new TransmissionService('http://transmission', 'user', 'pass');
      await expect(service.postProcess('hash-1')).resolves.toBeUndefined();
    });
  });

  describe('path mapping', () => {
    it('applies reverse path mapping for torrent-add download-dir', async () => {
      const service = new TransmissionService(
        'http://transmission',
        'user',
        'pass',
        '/downloads',
        'readmeabook',
        false,
        { enabled: true, remotePath: 'F:\\Docker\\downloads', localPath: '/downloads' }
      );

      // No duplicate
      clientMock.post
        .mockResolvedValueOnce({
          data: { result: 'success', arguments: { torrents: [] } },
        })
        // torrent-add
        .mockResolvedValueOnce({
          data: {
            result: 'success',
            arguments: {
              'torrent-added': { hashString: '0123456789abcdef0123456789abcdef01234567', name: 'Test' },
            },
          },
        });

      await service.addDownload('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567');

      // Verify the torrent-add call has the remote path
      const addCall = clientMock.post.mock.calls[1];
      const rpcBody = addCall[1];
      expect(rpcBody.arguments['download-dir']).toBe('F:\\Docker\\downloads');
    });
  });
});
