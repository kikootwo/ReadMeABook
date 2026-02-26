/**
 * Component: qBittorrent Integration Service Tests
 * Documentation: documentation/phase3/qbittorrent.md
 */

import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QBittorrentService, getQBittorrentService, invalidateQBittorrentService } from '@/lib/integrations/qbittorrent.service';

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
const configServiceMock = vi.hoisted(() => ({
  getMany: vi.fn(),
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

vi.mock('parse-torrent', () => ({
  default: parseTorrentMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: vi.fn(async () => configServiceMock),
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
  invalidateDownloadClientManager: vi.fn(),
}));

describe('QBittorrentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.get.mockReset();
    clientMock.post.mockReset();
    axiosMock.get.mockReset();
    axiosMock.post.mockReset();
    parseTorrentMock.mockReset();
    configServiceMock.getMany.mockReset();
    configServiceMock.get.mockReset();
    downloadClientManagerMock.getClientForProtocol.mockReset();
    downloadClientManagerMock.getAllClients.mockReset();
    downloadClientManagerMock.hasClientForProtocol.mockReset();
    invalidateQBittorrentService();
  });

  it('maps download progress from torrent info', () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    const progress = service.getDownloadProgress({
      progress: 0.42,
      downloaded: 420,
      size: 1000,
      dlspeed: 50,
      eta: 120,
      state: 'pausedDL',
    } as any);

    expect(progress.percent).toBe(42);
    expect(progress.bytesDownloaded).toBe(420);
    expect(progress.bytesTotal).toBe(1000);
    expect(progress.speed).toBe(50);
    expect(progress.eta).toBe(120);
    expect(progress.state).toBe('paused');
  });

  it('extracts info hash from magnet links', () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    const hash = (service as any).extractHashFromMagnet(
      'magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567'
    );

    expect(hash).toBe('0123456789abcdef0123456789abcdef01234567');
    expect((service as any).extractHashFromMagnet('magnet:?xt=urn:btih:')).toBeNull();
  });

  it('maps allocating state to downloading', () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    const progress = service.getDownloadProgress({
      progress: 0.1,
      downloaded: 100,
      size: 1000,
      dlspeed: 0,
      eta: 0,
      state: 'allocating',
    } as any);

    expect(progress.state).toBe('downloading');
  });

  describe('mapState - forced states (Force Resume in qBittorrent UI)', () => {
    it('maps forcedDL to downloading', () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      const progress = service.getDownloadProgress({
        progress: 0.5, downloaded: 500, size: 1000, dlspeed: 100, eta: 50, state: 'forcedDL',
      } as any);
      expect(progress.state).toBe('downloading');
    });

    it('maps forcedUP to completed', () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      const progress = service.getDownloadProgress({
        progress: 1.0, downloaded: 1000, size: 1000, dlspeed: 0, eta: 0, state: 'forcedUP',
      } as any);
      expect(progress.state).toBe('completed');
    });
  });

  describe('mapState - metadata fetching states', () => {
    it('maps metaDL to downloading', () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      const progress = service.getDownloadProgress({
        progress: 0, downloaded: 0, size: 0, dlspeed: 0, eta: 0, state: 'metaDL',
      } as any);
      expect(progress.state).toBe('downloading');
    });

    it('maps forcedMetaDL to downloading', () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      const progress = service.getDownloadProgress({
        progress: 0, downloaded: 0, size: 0, dlspeed: 0, eta: 0, state: 'forcedMetaDL',
      } as any);
      expect(progress.state).toBe('downloading');
    });
  });

  describe('mapState - qBittorrent v5.x stopped states', () => {
    it('maps stoppedDL to paused', () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      const progress = service.getDownloadProgress({
        progress: 0.3, downloaded: 300, size: 1000, dlspeed: 0, eta: 0, state: 'stoppedDL',
      } as any);
      expect(progress.state).toBe('paused');
    });

    it('maps stoppedUP to completed (download finished, stopped on upload side)', () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      const progress = service.getDownloadProgress({
        progress: 1.0, downloaded: 1000, size: 1000, dlspeed: 0, eta: 0, state: 'stoppedUP',
      } as any);
      expect(progress.state).toBe('completed');
    });
  });

  describe('mapState - other states', () => {
    it('maps checkingResumeData to checking', () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      const progress = service.getDownloadProgress({
        progress: 0, downloaded: 0, size: 1000, dlspeed: 0, eta: 0, state: 'checkingResumeData',
      } as any);
      expect(progress.state).toBe('checking');
    });

    it('maps moving to downloading', () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      const progress = service.getDownloadProgress({
        progress: 1.0, downloaded: 1000, size: 1000, dlspeed: 0, eta: 0, state: 'moving',
      } as any);
      expect(progress.state).toBe('downloading');
    });
  });

  describe('mapState - pausedUP/stoppedUP as completion states', () => {
    it('maps pausedUP to completed (download finished, paused on upload side)', () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      const progress = service.getDownloadProgress({
        progress: 0.5, downloaded: 0, size: 0, dlspeed: 0, eta: 0, state: 'pausedUP',
      } as any);
      expect(progress.state).toBe('completed');
    });

    it('maps pausedDL to paused (download not finished)', () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      const progress = service.getDownloadProgress({
        progress: 0.3, downloaded: 300, size: 1000, dlspeed: 0, eta: 0, state: 'pausedDL',
      } as any);
      expect(progress.state).toBe('paused');
    });
  });

  describe('mapStateToDownloadStatus - forced and new states via getDownload', () => {
    it('maps forcedUP to seeding status (triggers completion in monitor)', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=forced';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 1.0,
          dlspeed: 0, upspeed: 5000, downloaded: 1000, uploaded: 500,
          eta: 0, state: 'forcedUP', category: 'readmeabook', tags: '',
          save_path: '/downloads', content_path: '/downloads/Audiobook',
          completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info).not.toBeNull();
      expect(info!.status).toBe('seeding');
    });

    it('maps forcedDL to downloading status', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=forced';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 0.5,
          dlspeed: 1000, upspeed: 0, downloaded: 500, uploaded: 0,
          eta: 500, state: 'forcedDL', category: 'readmeabook', tags: '',
          save_path: '/downloads', completion_on: 0, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info).not.toBeNull();
      expect(info!.status).toBe('downloading');
    });

    it('maps stoppedUP to seeding status (qBittorrent v5.x, triggers completion)', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=stopped';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 1.0,
          dlspeed: 0, upspeed: 0, downloaded: 1000, uploaded: 200,
          eta: 0, state: 'stoppedUP', category: 'readmeabook', tags: '',
          save_path: '/downloads', completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info).not.toBeNull();
      expect(info!.status).toBe('seeding');
    });

    it('maps pausedUP to seeding status (download finished, paused on upload side)', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=pausedup';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'd5d767f07e5d9027f7f9d9b50b877386dc92b177', name: 'Audiobook', size: 0, progress: 0.5,
          dlspeed: 0, upspeed: 0, downloaded: 0, uploaded: 0,
          eta: 0, state: 'pausedUP', category: 'readmeabook', tags: '',
          save_path: '/data/torrents/readmeabook', content_path: '/data/torrents/readmeabook/Audiobook',
          completion_on: 1769135244, added_on: 1769135108,
        }],
      });

      const info = await service.getDownload('d5d767f07e5d9027f7f9d9b50b877386dc92b177');

      expect(info).not.toBeNull();
      expect(info!.status).toBe('seeding');
    });

    it('maps stoppedDL to paused status (qBittorrent v5.x)', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=stopped';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 0.3,
          dlspeed: 0, upspeed: 0, downloaded: 300, uploaded: 0,
          eta: 0, state: 'stoppedDL', category: 'readmeabook', tags: '',
          save_path: '/downloads', completion_on: 0, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info).not.toBeNull();
      expect(info!.status).toBe('paused');
    });

    it('maps metaDL to downloading status', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=meta';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 0, progress: 0,
          dlspeed: 0, upspeed: 0, downloaded: 0, uploaded: 0,
          eta: 0, state: 'metaDL', category: 'readmeabook', tags: '',
          save_path: '/downloads', completion_on: 0, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info).not.toBeNull();
      expect(info!.status).toBe('downloading');
    });

    it('maps checkingResumeData to checking status', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=resume';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 0,
          dlspeed: 0, upspeed: 0, downloaded: 0, uploaded: 0,
          eta: 0, state: 'checkingResumeData', category: 'readmeabook', tags: '',
          save_path: '/downloads', completion_on: 0, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info).not.toBeNull();
      expect(info!.status).toBe('checking');
    });
  });

  describe('downloadPath resolution (TempPathEnabled race + name mismatch fix)', () => {
    it('uses save_path + content basename for seeding torrents even when content_path points to temp dir', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=temppath';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 1.0,
          dlspeed: 0, upspeed: 5000, downloaded: 1000, uploaded: 500,
          eta: 0, state: 'uploading', category: 'readmeabook', tags: '',
          save_path: '/downloads/', content_path: '/incomplete/Audiobook',
          completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info).not.toBeNull();
      expect(info!.status).toBe('seeding');
      // Must use save_path + content_path basename, NOT the stale full content_path
      expect(info!.downloadPath).toBe(path.join('/downloads/', 'Audiobook'));
      expect(info!.downloadPath).not.toContain('incomplete');
    });

    it('uses save_path for stalledUP torrents (completed, stalled on upload)', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=stalledup';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 1.0,
          dlspeed: 0, upspeed: 0, downloaded: 1000, uploaded: 200,
          eta: 0, state: 'stalledUP', category: 'readmeabook', tags: '',
          save_path: '/downloads/', content_path: '/incomplete/Audiobook',
          completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info!.status).toBe('seeding');
      expect(info!.downloadPath).toBe(path.join('/downloads/', 'Audiobook'));
    });

    it('uses save_path for pausedUP torrents (completed, paused on upload)', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=pausedup2';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 1.0,
          dlspeed: 0, upspeed: 0, downloaded: 1000, uploaded: 0,
          eta: 0, state: 'pausedUP', category: 'readmeabook', tags: '',
          save_path: '/data/torrents/readmeabook/', content_path: '/tmp/incomplete/Audiobook',
          completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info!.status).toBe('seeding');
      expect(info!.downloadPath).toBe(path.join('/data/torrents/readmeabook/', 'Audiobook'));
    });

    it('uses save_path for stoppedUP torrents (qBittorrent v5.x completed)', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=stoppedup2';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 1.0,
          dlspeed: 0, upspeed: 0, downloaded: 1000, uploaded: 100,
          eta: 0, state: 'stoppedUP', category: 'readmeabook', tags: '',
          save_path: '/downloads/', content_path: '/incomplete/Audiobook',
          completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info!.status).toBe('seeding');
      expect(info!.downloadPath).toBe(path.join('/downloads/', 'Audiobook'));
    });

    it('uses content_path for actively downloading torrents', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=downloading';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 0.5,
          dlspeed: 5000, upspeed: 0, downloaded: 500, uploaded: 0,
          eta: 100, state: 'downloading', category: 'readmeabook', tags: '',
          save_path: '/downloads/', content_path: '/incomplete/Audiobook',
          completion_on: 0, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info!.status).toBe('downloading');
      // During download, content_path is used (points to where files currently are)
      expect(info!.downloadPath).toBe('/incomplete/Audiobook');
    });

    it('falls back to save_path + name when content_path is empty during download', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=nocontent';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 0.3,
          dlspeed: 1000, upspeed: 0, downloaded: 300, uploaded: 0,
          eta: 700, state: 'downloading', category: 'readmeabook', tags: '',
          save_path: '/downloads/', content_path: '',
          completion_on: 0, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info!.status).toBe('downloading');
      expect(info!.downloadPath).toBe(path.join('/downloads/', 'Audiobook'));
    });

    it('uses save_path for forcedUP torrents (force-resumed seeding)', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=forcedup2';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 1.0,
          dlspeed: 0, upspeed: 10000, downloaded: 1000, uploaded: 2000,
          eta: 0, state: 'forcedUP', category: 'readmeabook', tags: '',
          save_path: '/downloads/', content_path: '/incomplete/Audiobook',
          completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info!.status).toBe('seeding');
      expect(info!.downloadPath).toBe(path.join('/downloads/', 'Audiobook'));
    });

    it('uses save_path for queuedUP torrents (completed, queued for upload)', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=queuedup';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 1.0,
          dlspeed: 0, upspeed: 0, downloaded: 1000, uploaded: 0,
          eta: 0, state: 'queuedUP', category: 'readmeabook', tags: '',
          save_path: '/downloads/', content_path: '/incomplete/Audiobook',
          completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info!.status).toBe('seeding');
      expect(info!.downloadPath).toBe(path.join('/downloads/', 'Audiobook'));
    });

    it('uses content_path basename when torrent name differs from folder name on disk', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=namemismatch';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123',
          name: 'Harry Potter and the Sorcerers Stone [Full-Cast] (aka Harry Potter and the Philosophers Stone) - J.K. Rowling',
          size: 3006477107, progress: 1.0,
          dlspeed: 0, upspeed: 0, downloaded: 3006477107, uploaded: 500000,
          eta: 0, state: 'uploading', category: 'readmeabook', tags: '',
          save_path: '/downloads/books/',
          content_path: '/incomplete/Harry Potter and the Sorcerers Stone (Full-Cast Edition) EAC3+Atmos 6ch - J.K. Rowling',
          completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info!.status).toBe('seeding');
      // Must use the content_path basename (actual folder on disk), NOT torrent.name
      expect(info!.downloadPath).toBe(
        path.join('/downloads/books/', 'Harry Potter and the Sorcerers Stone (Full-Cast Edition) EAC3+Atmos 6ch - J.K. Rowling')
      );
      // Must NOT use the torrent name (which differs from the real folder)
      expect(info!.downloadPath).not.toContain('[Full-Cast]');
      expect(info!.downloadPath).not.toContain('incomplete');
    });

    it('falls back to torrent name when content_path is empty for finished torrents', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=nocontent-finished';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123', name: 'Audiobook', size: 1000, progress: 1.0,
          dlspeed: 0, upspeed: 0, downloaded: 1000, uploaded: 0,
          eta: 0, state: 'pausedUP', category: 'readmeabook', tags: '',
          save_path: '/downloads/', content_path: '',
          completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info!.status).toBe('seeding');
      // With no content_path, falls back to torrent name
      expect(info!.downloadPath).toBe(path.join('/downloads/', 'Audiobook'));
    });

    it('uses content_path basename for single-file torrent where name differs', async () => {
      const service = new QBittorrentService('http://qb', 'user', 'pass');
      (service as any).cookie = 'SID=singlefile';
      clientMock.get.mockResolvedValueOnce({
        data: [{
          hash: 'abc123',
          name: 'My Audiobook - Special Edition',
          size: 500000000, progress: 1.0,
          dlspeed: 0, upspeed: 1000, downloaded: 500000000, uploaded: 100000,
          eta: 0, state: 'uploading', category: 'readmeabook', tags: '',
          save_path: '/downloads/books/',
          content_path: '/incomplete/My Audiobook.m4b',
          completion_on: 1700000000, added_on: 1699000000,
        }],
      });

      const info = await service.getDownload('abc123');

      expect(info!.status).toBe('seeding');
      // Single file: basename is the filename itself
      expect(info!.downloadPath).toBe(path.join('/downloads/books/', 'My Audiobook.m4b'));
      expect(info!.downloadPath).not.toContain('Special Edition');
    });
  });

  it('authenticates and stores a session cookie', async () => {
    axiosMock.post.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      data: 'Ok.',
      headers: { 'set-cookie': ['SID=abc; Path=/;'] },
    });

    const service = new QBittorrentService('http://qb', 'user', 'pass');
    await service.login();

    expect((service as any).cookie).toBe('SID=abc');
  });

  it('throws when login response lacks a cookie', async () => {
    axiosMock.post.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      data: 'Ok.',
      headers: {},
    });

    const service = new QBittorrentService('http://qb', 'user', 'pass');

    await expect(service.login()).rejects.toThrow('Failed to authenticate with qBittorrent');
  });

  it('rejects empty torrent URLs', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');

    await expect(service.addTorrent('')).rejects.toThrow('Invalid download URL');
  });

  it('skips adding duplicate magnet links', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=dup';
    vi.spyOn(service as any, 'ensureCategory').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getTorrent').mockResolvedValue({ hash: 'existing' });

    const hash = await service.addTorrent('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567');

    expect(hash).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(clientMock.post).not.toHaveBeenCalled();
  });

  it('adds magnet links when not already present', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=add';
    vi.spyOn(service as any, 'ensureCategory').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getTorrent').mockRejectedValue(new Error('not found'));
    clientMock.post.mockResolvedValue({ data: 'Ok.' });

    const hash = await service.addTorrent(
      'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
      { tags: ['tag1', 'tag2'] }
    );

    expect(hash).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(clientMock.post).toHaveBeenCalledWith(
      '/torrents/add',
      expect.any(URLSearchParams),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      })
    );
  });

  it('throws when magnet link is invalid', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=badmagnet';

    await expect(
      (service as any).addMagnetLink('magnet:?xt=urn:btih:', 'readmeabook')
    ).rejects.toThrow('Invalid magnet link');
  });

  it('throws when qBittorrent rejects magnet uploads', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=rejected';
    vi.spyOn(service as any, 'getTorrent').mockRejectedValue(new Error('not found'));
    clientMock.post.mockResolvedValue({ data: 'Nope' });

    await expect(
      (service as any).addMagnetLink(
        'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
        'readmeabook'
      )
    ).rejects.toThrow('qBittorrent rejected magnet link');
  });

  it('re-authenticates after a 403 and retries adding torrents', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=old';

    vi.spyOn(service as any, 'ensureCategory').mockResolvedValue(undefined);
    const loginSpy = vi.spyOn(service, 'login').mockResolvedValue();
    const addMagnetSpy = vi.spyOn(service as any, 'addMagnetLink')
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 403 } })
      .mockResolvedValueOnce('rehash');

    const hash = await service.addTorrent('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567');

    expect(hash).toBe('rehash');
    expect(loginSpy).toHaveBeenCalledTimes(1);
    expect(addMagnetSpy).toHaveBeenCalledTimes(2);
  });

  it('follows redirect to magnet link when downloading torrent files', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=redir';
    vi.spyOn(service as any, 'ensureCategory').mockResolvedValue(undefined);
    const addMagnetSpy = vi.spyOn(service as any, 'addMagnetLink').mockResolvedValue('redirect-hash');

    axiosMock.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 302, headers: { location: 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01' } },
    });

    const hash = await service.addTorrent('http://example.com/file.torrent');

    expect(hash).toBe('redirect-hash');
    expect(addMagnetSpy).toHaveBeenCalled();
  });

  it('treats magnet response bodies as magnet links', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=body';
    vi.spyOn(service as any, 'ensureCategory').mockResolvedValue(undefined);
    const addMagnetSpy = vi.spyOn(service as any, 'addMagnetLink').mockResolvedValue('body-hash');

    axiosMock.get.mockResolvedValueOnce({
      data: Buffer.from('magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01'),
    });

    const hash = await service.addTorrent('http://example.com/file.torrent');

    expect(hash).toBe('body-hash');
    expect(addMagnetSpy).toHaveBeenCalled();
    expect(parseTorrentMock).not.toHaveBeenCalled();
  });

  it('adds torrent files after parsing successfully', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=ok';
    vi.spyOn(service as any, 'ensureCategory').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getTorrent').mockRejectedValue(new Error('not found'));

    axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('torrent') });
    parseTorrentMock.mockResolvedValueOnce({ infoHash: 'hash-1', name: 'Book' });
    clientMock.post.mockResolvedValue({ data: 'Ok.' });

    const hash = await service.addTorrent('http://example.com/file.torrent');

    expect(hash).toBe('hash-1');
    expect(clientMock.post).toHaveBeenCalledWith(
      '/torrents/add',
      expect.any(Object),
      expect.objectContaining({ maxBodyLength: Infinity })
    );
  });

  it('throws for invalid redirect locations when fetching torrents', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');

    axiosMock.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 302, headers: { location: 'ftp://bad' } },
      message: 'redirect',
    });

    await expect(
      (service as any).addTorrentFile('http://example.com/file.torrent', 'readmeabook')
    ).rejects.toThrow('Invalid redirect location');
  });

  it('throws when torrent file parsing fails directly', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');

    axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('torrent') });
    parseTorrentMock.mockRejectedValueOnce(new Error('bad torrent'));

    await expect(
      (service as any).addTorrentFile('http://example.com/file.torrent', 'readmeabook')
    ).rejects.toThrow('Invalid .torrent file - failed to parse');
  });

  it('throws when torrent file has no info hash', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');

    axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('torrent') });
    parseTorrentMock.mockResolvedValueOnce({ infoHash: null });

    await expect(
      (service as any).addTorrentFile('http://example.com/file.torrent', 'readmeabook')
    ).rejects.toThrow('Failed to extract info_hash');
  });

  it('throws when qBittorrent rejects torrent file uploads', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=reject';
    vi.spyOn(service as any, 'getTorrent').mockRejectedValue(new Error('not found'));

    axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('torrent') });
    parseTorrentMock.mockResolvedValueOnce({ infoHash: 'hash-2', name: 'Book' });
    clientMock.post.mockResolvedValue({ data: 'Nope' });

    await expect(
      (service as any).addTorrentFile('http://example.com/file.torrent', 'readmeabook')
    ).rejects.toThrow('qBittorrent rejected .torrent file');
  });

  it('throws when torrent parsing fails', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=parse';
    vi.spyOn(service as any, 'ensureCategory').mockResolvedValue(undefined);

    axiosMock.get.mockResolvedValueOnce({ data: Buffer.from('not-a-torrent') });
    parseTorrentMock.mockRejectedValueOnce(new Error('bad torrent'));

    await expect(service.addTorrent('http://example.com/file.torrent')).rejects.toThrow(
      'Failed to add torrent to qBittorrent'
    );
  });

  it('creates categories when missing', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass', '/downloads');
    (service as any).cookie = 'SID=newcat';
    clientMock.get.mockResolvedValue({ data: {} });
    clientMock.post.mockResolvedValue({ data: 'Ok.' });

    await (service as any).ensureCategory('readmeabook');

    expect(clientMock.post).toHaveBeenCalledWith(
      '/torrents/createCategory',
      expect.any(URLSearchParams),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      })
    );
  });

  it('does not throw when ensuring categories fails', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=catfail';
    clientMock.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 500 },
    });

    await expect((service as any).ensureCategory('readmeabook')).resolves.toBeUndefined();
  });

  it('updates category when save path mismatches', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass', '/downloads');
    (service as any).cookie = 'SID=cat';
    clientMock.get.mockResolvedValue({
      data: {
        readmeabook: { savePath: '/old' },
      },
    });
    clientMock.post.mockResolvedValue({ data: 'Ok.' });

    await (service as any).ensureCategory('readmeabook');

    expect(clientMock.post).toHaveBeenCalledWith(
      '/torrents/editCategory',
      expect.any(URLSearchParams),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      })
    );
  });

  it('does not update category when save path matches', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass', '/downloads');
    (service as any).cookie = 'SID=cat-ok';
    clientMock.get.mockResolvedValue({
      data: {
        readmeabook: { savePath: '/downloads' },
      },
    });

    await (service as any).ensureCategory('readmeabook');

    expect(clientMock.post).not.toHaveBeenCalled();
  });

  it('applies reverse path mapping when creating category', async () => {
    const service = new QBittorrentService(
      'http://qb',
      'user',
      'pass',
      '/downloads',
      'readmeabook',
      false,
      { enabled: true, remotePath: 'F:\\Docker\\downloads', localPath: '/downloads' }
    );
    (service as any).cookie = 'SID=pathmap';
    clientMock.get.mockResolvedValue({ data: {} }); // No existing categories
    clientMock.post.mockResolvedValue({ data: 'Ok.' });

    await (service as any).ensureCategory('readmeabook');

    expect(clientMock.post).toHaveBeenCalledWith(
      '/torrents/createCategory',
      expect.any(URLSearchParams),
      expect.any(Object)
    );

    // Verify the savePath was reverse transformed (local → remote)
    const postCall = clientMock.post.mock.calls[0];
    const params = postCall[1] as URLSearchParams;
    expect(params.get('savePath')).toBe('F:\\Docker\\downloads');
  });

  it('applies reverse path mapping when updating category', async () => {
    const service = new QBittorrentService(
      'http://qb',
      'user',
      'pass',
      '/downloads',
      'readmeabook',
      false,
      { enabled: true, remotePath: 'F:\\Docker\\downloads', localPath: '/downloads' }
    );
    (service as any).cookie = 'SID=pathmap-update';
    // Category exists with old path
    clientMock.get.mockResolvedValue({
      data: {
        readmeabook: { savePath: 'F:\\OldPath' },
      },
    });
    clientMock.post.mockResolvedValue({ data: 'Ok.' });

    await (service as any).ensureCategory('readmeabook');

    expect(clientMock.post).toHaveBeenCalledWith(
      '/torrents/editCategory',
      expect.any(URLSearchParams),
      expect.any(Object)
    );

    // Verify the savePath was reverse transformed (local → remote)
    const postCall = clientMock.post.mock.calls[0];
    const params = postCall[1] as URLSearchParams;
    expect(params.get('savePath')).toBe('F:\\Docker\\downloads');
  });

  it('does not update category when remote path already matches', async () => {
    const service = new QBittorrentService(
      'http://qb',
      'user',
      'pass',
      '/downloads',
      'readmeabook',
      false,
      { enabled: true, remotePath: 'F:\\Docker\\downloads', localPath: '/downloads' }
    );
    (service as any).cookie = 'SID=pathmap-match';
    // Category already has the correct remote path
    clientMock.get.mockResolvedValue({
      data: {
        readmeabook: { savePath: 'F:\\Docker\\downloads' },
      },
    });

    await (service as any).ensureCategory('readmeabook');

    // Should not call post since path already matches
    expect(clientMock.post).not.toHaveBeenCalled();
  });

  it('pauses and resumes torrents', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=pause';
    clientMock.post.mockResolvedValue({ data: 'Ok.' });

    await service.pauseTorrent('hash-1');
    await service.resumeTorrent('hash-1');

    expect(clientMock.post).toHaveBeenCalledWith(
      '/torrents/pause',
      expect.any(URLSearchParams),
      expect.any(Object)
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      '/torrents/resume',
      expect.any(URLSearchParams),
      expect.any(Object)
    );
  });

  it('throws when torrent state updates fail', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=fail';
    clientMock.post.mockRejectedValue(new Error('boom'));

    await expect(service.pauseTorrent('hash-1')).rejects.toThrow('Failed to pause torrent');
    await expect(service.resumeTorrent('hash-1')).rejects.toThrow('Failed to resume torrent');
    await expect(service.deleteTorrent('hash-1', false)).rejects.toThrow('Failed to delete torrent');
    await expect(service.setCategory('hash-1', 'books')).rejects.toThrow('Failed to set torrent category');
  });

  it('sets categories, deletes torrents, and fetches files', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=ops';
    clientMock.post.mockResolvedValue({ data: 'Ok.' });
    clientMock.get.mockResolvedValue({ data: [{ name: 'file1' }] });

    await service.setCategory('hash-1', 'books');
    await service.deleteTorrent('hash-1', true);
    const files = await service.getFiles('hash-1');

    expect(files).toEqual([{ name: 'file1' }]);
    expect(clientMock.post).toHaveBeenCalledWith(
      '/torrents/setCategory',
      expect.any(URLSearchParams),
      expect.any(Object)
    );
    expect(clientMock.post).toHaveBeenCalledWith(
      '/torrents/delete',
      expect.any(URLSearchParams),
      expect.any(Object)
    );
  });

  it('throws when fetching torrent files fails', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=files';
    clientMock.get.mockRejectedValue(new Error('no files'));

    await expect(service.getFiles('hash-1')).rejects.toThrow('Failed to get torrent files');
  });

  it('throws when torrent is not found', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=missing';
    clientMock.get.mockResolvedValueOnce({ data: [] });

    await expect(service.getTorrent('hash-404')).rejects.toThrow('Torrent hash-404 not found');
  });

  it('ignores unrelated torrents returned by RDTClient-like clients that ignore hash filter', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=rdtclient';
    // RDTClient ignores the hashes param and returns all torrents
    clientMock.get.mockResolvedValueOnce({
      data: [
        { hash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555', name: 'Other Book' },
        { hash: 'ffff6666aaaa7777bbbb8888cccc9999dddd0000', name: 'Another Book' },
      ],
    });

    await expect(
      service.getTorrent('0f54898dc1b8e49d96e32827377f651ea6c935af')
    ).rejects.toThrow('Torrent 0f54898dc1b8e49d96e32827377f651ea6c935af not found');
  });

  it('finds the correct torrent when RDTClient returns all torrents including the match', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=rdtclient2';
    clientMock.get.mockResolvedValueOnce({
      data: [
        { hash: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555', name: 'Other Book' },
        { hash: '0F54898DC1B8E49D96E32827377F651EA6C935AF', name: 'Target Book' },
      ],
    });

    const result = await service.getTorrent('0f54898dc1b8e49d96e32827377f651ea6c935af');

    expect(result.name).toBe('Target Book');
  });

  it('returns error when getTorrents fails', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=list';
    clientMock.get.mockRejectedValue(new Error('boom'));

    await expect(service.getTorrents()).rejects.toThrow('Failed to get torrents from qBittorrent');
  });

  it('returns torrent lists with a category filter', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    (service as any).cookie = 'SID=list';
    clientMock.get.mockResolvedValueOnce({ data: [{ hash: 'h1' }] });

    const torrents = await service.getTorrents('books');

    expect(torrents).toEqual([{ hash: 'h1' }]);
    expect(clientMock.get).toHaveBeenCalledWith(
      '/torrents/info',
      expect.objectContaining({ params: { category: 'books' } })
    );
  });

  it('returns unknown state for unrecognized torrent states', () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    const progress = service.getDownloadProgress({
      progress: 0,
      downloaded: 0,
      size: 1,
      dlspeed: 0,
      eta: 0,
      state: 'weird' as any,
    } as any);

    expect(progress.state).toBe('unknown');
  });

  it('throws specific errors for invalid credentials in testConnectionWithCredentials', async () => {
    axiosMock.post.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: 'Ok.',
      headers: { 'set-cookie': ['SID=abc; Path=/;'] },
    });
    axiosMock.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401 },
      config: { url: 'http://qb/api/v2/app/version' },
      message: 'Unauthorized',
    });

    await expect(
      QBittorrentService.testConnectionWithCredentials('http://qb', 'user', 'bad')
    ).rejects.toThrow('Authentication failed');
  });

  it('returns version on successful credential test', async () => {
    axiosMock.post.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: 'Ok.',
      headers: { 'set-cookie': ['SID=abc; Path=/;'] },
    });
    axiosMock.get.mockResolvedValueOnce({
      data: 'v4.6.0',
      headers: {},
    });

    const version = await QBittorrentService.testConnectionWithCredentials('http://qb', 'user', 'pass');

    expect(version).toBe('4.6.0');
  });

  it('throws when test connection receives no cookies', async () => {
    axiosMock.post.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      data: 'Ok.',
      headers: {},
    });

    await expect(
      QBittorrentService.testConnectionWithCredentials('http://qb', 'user', 'pass')
    ).rejects.toThrow('Failed to authenticate - no session cookie received');
  });

  it('throws SSL-specific errors for certificate failures', async () => {
    axiosMock.post.mockRejectedValueOnce({
      isAxiosError: true,
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      message: 'self signed',
      config: { url: 'https://qb/api/v2/auth/login' },
    });

    await expect(
      QBittorrentService.testConnectionWithCredentials('https://qb', 'user', 'pass', true)
    ).rejects.toThrow('SSL certificate verification failed');
  });

  it('throws when connection is refused', async () => {
    axiosMock.post.mockRejectedValueOnce({
      isAxiosError: true,
      code: 'ECONNREFUSED',
      message: 'refused',
      config: { url: 'http://qb/api/v2/auth/login' },
    });

    await expect(
      QBittorrentService.testConnectionWithCredentials('http://qb', 'user', 'pass')
    ).rejects.toThrow('Connection refused');
  });

  it('throws when server returns 404', async () => {
    axiosMock.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404 },
      message: 'Not found',
      config: { url: 'http://qb/api/v2/auth/login' },
    });

    await expect(
      QBittorrentService.testConnectionWithCredentials('http://qb', 'user', 'pass')
    ).rejects.toThrow('qBittorrent Web UI not found');
  });

  it('throws on qBittorrent server errors', async () => {
    axiosMock.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 503 },
      message: 'Server error',
      config: { url: 'http://qb/api/v2/auth/login' },
    });

    await expect(
      QBittorrentService.testConnectionWithCredentials('http://qb', 'user', 'pass')
    ).rejects.toThrow('qBittorrent server error');
  });

  it('throws when qBittorrent configuration is incomplete', async () => {
    // Mock: no qBittorrent client configured
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue(null);

    await expect(getQBittorrentService()).rejects.toThrow('qBittorrent is not configured');
  });

  it('returns a cached instance after successful initialization', async () => {
    // Mock: qBittorrent client configured
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      url: 'http://qb',
      username: 'user',
      password: 'pass',
      disableSSLVerify: false,
      remotePathMappingEnabled: false,
    });
    configServiceMock.get.mockResolvedValue('/downloads');

    const testConnectionSpy = vi.spyOn(QBittorrentService.prototype, 'testConnection').mockResolvedValue({ success: true, message: 'Connected' });

    const first = await getQBittorrentService();
    const second = await getQBittorrentService();

    expect(first).toBe(second);
    // Should only call getClientForProtocol once (cached after first call)
    expect(downloadClientManagerMock.getClientForProtocol).toHaveBeenCalledTimes(1);

    testConnectionSpy.mockRestore();
  });

  it('throws when connection test fails during service creation', async () => {
    // Mock: qBittorrent client configured
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({
      id: 'client-1',
      type: 'qbittorrent',
      name: 'qBittorrent',
      enabled: true,
      url: 'http://qb',
      username: 'user',
      password: 'pass',
      disableSSLVerify: false,
      remotePathMappingEnabled: false,
    });
    configServiceMock.get.mockResolvedValue('/downloads');

    const testConnectionSpy = vi.spyOn(QBittorrentService.prototype, 'testConnection').mockResolvedValue({ success: false, message: 'qBittorrent connection test failed. Please check your configuration in admin settings.' });

    await expect(getQBittorrentService()).rejects.toThrow('qBittorrent connection test failed');

    testConnectionSpy.mockRestore();
  });

  it('returns false when connection test fails', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    const loginSpy = vi.spyOn(service, 'login').mockRejectedValue(new Error('bad auth'));

    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(loginSpy).toHaveBeenCalled();
  });

  it('returns true when connection test succeeds', async () => {
    const service = new QBittorrentService('http://qb', 'user', 'pass');
    const loginSpy = vi.spyOn(service, 'login').mockResolvedValue();

    const result = await service.testConnection();

    expect(result.success).toBe(true);
    expect(loginSpy).toHaveBeenCalled();
  });
});
