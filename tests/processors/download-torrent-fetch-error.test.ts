/**
 * Component: Download Torrent Processor Tests (a failed grab names the server that answered, #298)
 * Documentation: documentation/phase3/download-clients.md
 *
 * Runs the real shared fetcher against local HTTP servers; the job log is read from
 * the persisted job events (what System Logs shows), the user message from the request.
 */

import type { ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';
import { SourceServers, redirectTo } from '../helpers/source-servers';
import type { SourceAuth } from '@/lib/integrations/download-source';
import type { DownloadSourceError } from '@/lib/interfaces/download-client.interface';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn(), getMany: vi.fn() }));
const jobQueueMock = createJobQueueMock();
const downloadClientManagerMock = vi.hoisted(() => ({
  getClientForProtocol: vi.fn(),
  getClientServiceForProtocol: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({
  ProwlarrService: { isNZBResult: vi.fn(() => false) },
}));

const KEY = 'prowlarr-key-298-abcdef';
const PROXY_HINT =
  "This usually means a reverse proxy asks for a login on Prowlarr's download links " +
  '(<Prowlarr URL>/<number>/download) while <Prowlarr URL>/api is open.';
// Never in any message, log line or error field
const SECRETS = [KEY, 'S3cret', 'SECRETLINK', '/12/download', '/prowlarr/', 'Top Secret', 'indexer-key-777', '/getnzb'];

const servers = new SourceServers();
const answer = (status: number, headers: Record<string, string> = {}) => (res: ServerResponse) => {
  res.writeHead(status, headers).end('denied');
};

const payload = () => ({
  requestId: 'req-298',
  audiobook: { id: 'book-298', title: 'Book', author: 'Author' },
  torrent: {
    indexer: 'NZBgeek',
    indexerId: 12,
    title: 'Book - Author',
    size: 50 * 1024 * 1024,
    seeders: 10,
    publishDate: new Date(),
    downloadUrl: `${servers.prowlarrUrl}/prowlarr/12/download?link=SECRETLINK&file=Book`,
    guid: 'guid-298',
    format: 'M4B',
    protocol: 'torrent',
  },
  jobId: 'job-298',
});

async function grab(): Promise<{ error: Error; requestMessage: string | undefined; jobLog: string }> {
  const { processDownloadTorrent } = await import('@/lib/processors/download-torrent.processor');
  const error = await processDownloadTorrent(payload()).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  type Write = { data?: { status?: string; errorMessage?: string } };
  const failedWrite = (prismaMock.request.updateMany.mock.calls as Write[][])
    .map(([args]) => args?.data)
    .find((data) => data?.status === 'failed');
  const jobLog = (prismaMock.jobEvent.create.mock.calls as Write[][]).map(([args]) => JSON.stringify(args.data)).join('\n');
  return { error: error as Error, requestMessage: failedWrite?.errorMessage, jobLog };
}

const errorFields = (error: Error) => {
  const { message, status, sourceUrl, failure } = error as DownloadSourceError;
  return JSON.stringify({ message, status, sourceUrl, failure });
};

function expectNoLeak(...texts: (string | undefined)[]): void {
  const all = texts.join('\n');
  for (const secret of SECRETS) expect(all).not.toContain(secret);
}

describe('processDownloadTorrent: a failed grab names the server that answered (#298)', () => {
  beforeAll(() => servers.start());
  afterAll(() => servers.stop());

  beforeEach(() => {
    vi.clearAllMocks();
    servers.reset();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.findUnique.mockResolvedValue({ type: 'audiobook', status: 'downloading', user: { plexUsername: 'u' } });
    prismaMock.jobEvent.create.mockResolvedValue({});
    const host = servers.prowlarrUrl.replace('http://', '');
    configMock.getMany.mockResolvedValue({ prowlarr_url: `http://admin:S3cret@${host}/prowlarr`, prowlarr_api_key: KEY });
    // A torrent client that fetches the source with the real shared fetcher
    const addDownload = vi.fn(async (url: string, options: { sourceAuth?: SourceAuth }) => {
      const { fetchDownloadSource } = await import('@/lib/integrations/download-source');
      return fetchDownloadSource(url, { sourceAuth: options.sourceAuth, allowMagnet: true, timeoutMs: 5000 });
    });
    downloadClientManagerMock.getClientServiceForProtocol.mockResolvedValue({ clientType: 'qbittorrent', protocol: 'torrent', addDownload });
    downloadClientManagerMock.getClientForProtocol.mockResolvedValue({ id: 'client-1', type: 'qbittorrent', enabled: true });
  });

  it.each([401, 403])('names Prowlarr, adds the proxy hint and logs the hop for HTTP %i from the Prowlarr address', async (status) => {
    servers.on('prowlarr', '/prowlarr/12/download', answer(status, { 'WWW-Authenticate': 'Basic realm="Top Secret"' }));

    const { error, requestMessage, jobLog } = await grab();

    const expected = `Grab failed: Prowlarr returned HTTP ${status} for "Book - Author" (NZBgeek). ${PROXY_HINT}`;
    expect(error.message).toBe(expected);
    expect(requestMessage).toBe(expected);
    expect(requestMessage).not.toContain('127.0.0.1');
    expect(jobLog).toContain(
      `Download link answered HTTP ${status} from ${servers.prowlarrUrl} (the configured Prowlarr address) after 0 redirects; WWW-Authenticate: Basic`
    );
    expectNoLeak(error.message, requestMessage, jobLog, errorFields(error));
  });

  it('names Prowlarr without the hint for HTTP 500 and logs that no WWW-Authenticate came back', async () => {
    servers.on('prowlarr', '/prowlarr/12/download', answer(500));

    const { error, requestMessage, jobLog } = await grab();

    expect(error.message).toBe('Grab failed: Prowlarr returned HTTP 500 for "Book - Author" (NZBgeek)');
    expect(requestMessage).toBeUndefined(); // 5xx: Bull retries, the request is not failed yet
    expect(jobLog).toContain(
      `Download link answered HTTP 500 from ${servers.prowlarrUrl} (the configured Prowlarr address) after 0 redirects; no WWW-Authenticate`
    );
    expectNoLeak(error.message, jobLog, errorFields(error));
  });

  it('names the indexer after a redirect, without the hint, and logs the redirect target host', async () => {
    servers.on('prowlarr', '/prowlarr/12/download', redirectTo(`${servers.otherUrl}/getnzb/abc?apikey=indexer-key-777`));
    servers.on('other', '/getnzb/abc', answer(401));

    const { error, requestMessage, jobLog } = await grab();

    const expected = 'Grab failed: NZBgeek returned HTTP 401 for "Book - Author" after a redirect';
    expect(error.message).toBe(expected);
    expect(requestMessage).toBe(expected);
    expect(jobLog).toContain(
      `Download link answered HTTP 401 from ${servers.otherUrl} (a redirect target) after 1 redirect; no WWW-Authenticate`
    );
    expectNoLeak(error.message, requestMessage, jobLog, errorFields(error));
  });
});
