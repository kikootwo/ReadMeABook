/**
 * Component: Download Source Fetcher Tests (real HTTP servers)
 * Documentation: documentation/phase3/download-clients.md
 */

import { Agent as HttpsAgent } from 'node:https';
import axios from 'axios';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SourceServers,
  TEST_MAGNET,
  TEST_PROWLARR_KEY,
  TEST_TORRENT,
  redirectTo,
  serve,
} from '../helpers/source-servers';
import { fetchDownloadSource } from '@/lib/integrations/download-source';
import { parseProwlarrBase, toConfiguredProwlarrUrl } from '@/lib/utils/prowlarr-url';
import { DownloadSourceError, UnusableDownloadSourceError } from '@/lib/interfaces/download-client.interface';
import { isTransientConnectionError } from '@/lib/utils/connection-errors';

const logged = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/utils/logger', () => {
  const record = (...args: unknown[]) => { logged.push(JSON.stringify(args)); };
  return { RMABLogger: { create: () => ({ info: record, debug: record, warn: record, error: record }) } };
});

const servers = new SourceServers();
const auth = () => ({ prowlarrBaseUrl: servers.prowlarrUrl, apiKey: TEST_PROWLARR_KEY });
const fetchTorrent = (url: string) =>
  fetchDownloadSource(url, { sourceAuth: auth(), allowMagnet: true, timeoutMs: 5000 });

describe('fetchDownloadSource', () => {
  beforeAll(() => servers.start());
  afterAll(() => servers.stop());
  beforeEach(() => {
    servers.reset();
    logged.length = 0;
  });

  it('sends the key to the Prowlarr download hop but not to an absolute redirect on another origin', async () => {
    servers.on('prowlarr', '/1/download', redirectTo(`${servers.otherUrl}/file.torrent`));
    servers.on('other', '/file.torrent', serve(TEST_TORRENT));

    const result = await fetchTorrent(`${servers.prowlarrUrl}/1/download?link=abc`);

    expect(result.kind).toBe('file');
    expect(servers.keyed('prowlarr')).toHaveLength(1);
    expect(servers.keyed('other')).toHaveLength(0);
    expect(servers.requests.find((r) => r.server === 'other')).toBeDefined();
  });

  it('resolves relative redirects against the current hop and keeps the key on Prowlarr only', async () => {
    servers.on('prowlarr', '/1/download', redirectTo('/2/download'));
    servers.on('prowlarr', '/2/download', redirectTo(`${servers.otherUrl}/jackett/dl`));
    servers.on('other', '/jackett/dl', redirectTo('../files/book.torrent', 301));
    servers.on('other', '/files/book.torrent', serve(TEST_TORRENT));

    const result = await fetchTorrent(`${servers.prowlarrUrl}/1/download`);

    expect(result).toMatchObject({ kind: 'file' });
    expect(servers.keyed('prowlarr')).toHaveLength(2);
    expect(servers.keyed('other')).toHaveLength(0);
  });

  it('never attaches the key to other Prowlarr paths, even on the Prowlarr origin', async () => {
    servers.on('other', '/start', redirectTo(`${servers.prowlarrUrl}/api/v1/indexer`));
    servers.on('prowlarr', '/api/v1/indexer', serve(TEST_TORRENT));

    await fetchTorrent(`${servers.otherUrl}/start`);

    expect(servers.keyed()).toHaveLength(0);
  });

  it('restores the apikey query parameter on Prowlarr download hops when it was stripped', async () => {
    servers.on('prowlarr', '/7/download', serve(TEST_TORRENT));

    await fetchTorrent(`${servers.prowlarrUrl}/7/download?link=abc`);

    const [request] = servers.requests;
    expect(new URL(request.url, 'http://x').searchParams.get('apikey')).toBe(TEST_PROWLARR_KEY);
    expect(request.headers['x-api-key']).toBe(TEST_PROWLARR_KEY);
  });

  it.each([2, 3])('returns a magnet found at redirect hop %i', async (hop) => {
    servers.on('prowlarr', '/1/download', redirectTo(`${servers.otherUrl}/hop1`));
    servers.on('other', '/hop1', redirectTo(hop === 2 ? TEST_MAGNET : `${servers.otherUrl}/hop2`));
    servers.on('other', '/hop2', redirectTo(TEST_MAGNET));

    await expect(fetchTorrent(`${servers.prowlarrUrl}/1/download`)).resolves.toEqual({
      kind: 'magnet',
      magnetUrl: TEST_MAGNET,
    });
  });

  it('returns a magnet served as the response body', async () => {
    servers.on('other', '/magnet', serve(Buffer.from(`${TEST_MAGNET}\n`), 'text/plain'));
    await expect(fetchTorrent(`${servers.otherUrl}/magnet`)).resolves.toMatchObject({ kind: 'magnet' });
  });

  it('rejects a magnet when the caller needs a file (usenet)', async () => {
    servers.on('other', '/nzb', redirectTo(TEST_MAGNET));
    await expect(
      fetchDownloadSource(`${servers.otherUrl}/nzb`, { allowMagnet: false, timeoutMs: 5000 })
    ).rejects.toThrow('needs an .nzb file');
  });

  it('stops after the redirect hop limit', async () => {
    servers.on('other', '/loop', redirectTo('/loop'));
    await expect(fetchTorrent(`${servers.otherUrl}/loop`)).rejects.toThrow('Too many redirects');
    expect(servers.requests).toHaveLength(6);
  });

  it('aborts a slow-drip source at the overall deadline', async () => {
    servers.on('other', '/drip', (res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const timer = setInterval(() => res.write('d'), 50);
      res.on('close', () => clearInterval(timer));
    });
    const started = Date.now();

    const error = await fetchDownloadSource(`${servers.otherUrl}/drip`, { allowMagnet: true, timeoutMs: 500 })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Timed out resolving download source');
    expect(Date.now() - started).toBeLessThan(2500);
    // Retryable like an axios timeout was before (Bull retries the job instead of failing the request)
    expect(isTransientConnectionError(error)).toBe(true);
  });

  it('rejects a redirect to a magnet with embedded whitespace', async () => {
    // A tab is a legal header byte; a client that split on whitespace would fetch the second URL
    servers.on('other', '/smuggle', redirectTo(`${TEST_MAGNET}\thttp://evil.example/x`));
    await expect(fetchTorrent(`${servers.otherUrl}/smuggle`)).rejects.toThrow('Invalid redirect location');
  });

  it('adds configured Prowlarr credentials only at grab time, and the grab authenticates', async () => {
    servers.on('prowlarr', '/1/download', serve(TEST_TORRENT));
    const configured = servers.prowlarrUrl.replace('http://', 'http://admin:S3cret@');
    const base = parseProwlarrBase(configured);
    const stored = toConfiguredProwlarrUrl(`${servers.prowlarrUrl}/1/download?link=a`, base);
    expect(stored).not.toContain('S3cret');

    const grabUrl = toConfiguredProwlarrUrl(stored!, base, { withCredentials: true })!;
    await fetchDownloadSource(grabUrl, {
      sourceAuth: { prowlarrBaseUrl: configured, apiKey: TEST_PROWLARR_KEY }, allowMagnet: true, timeoutMs: 5000,
    });

    const [request] = servers.requests;
    expect(request.headers.authorization).toBe(`Basic ${Buffer.from('admin:S3cret').toString('base64')}`);
    expect(request.headers['x-api-key']).toBe(TEST_PROWLARR_KEY);
    expect(logged.join('\n')).not.toContain('S3cret');
  });

  it('rejects redirects to non-http schemes', async () => {
    servers.on('other', '/bad', redirectTo('file:///etc/passwd'));
    await expect(fetchTorrent(`${servers.otherUrl}/bad`)).rejects.toThrow('Invalid redirect location');
  });

  it('ignores a configured Prowlarr URL that is not plain http(s)', async () => {
    servers.on('prowlarr', '/1/download', serve(TEST_TORRENT));
    await fetchDownloadSource(`${servers.prowlarrUrl}/1/download`, {
      sourceAuth: { prowlarrBaseUrl: 'javascript:alert(1)', apiKey: TEST_PROWLARR_KEY },
      allowMagnet: true,
      timeoutMs: 5000,
    });
    expect(servers.keyed()).toHaveLength(0);
  });

  it('throws DownloadSourceError with a redacted URL and keeps the key out of logs', async () => {
    servers.on('prowlarr', '/1/download', redirectTo(`${servers.otherUrl}/gone?passkey=tracker-secret`));
    servers.on('other', '/gone', (res) => res.writeHead(410).end());

    const error = await fetchTorrent(`${servers.prowlarrUrl}/1/download?apikey=${TEST_PROWLARR_KEY}`).catch((e) => e);

    expect(error).toBeInstanceOf(DownloadSourceError);
    expect(error.status).toBe(410);
    expect(error.sourceUrl).not.toContain('tracker-secret');
    expect(logged.join('\n')).not.toContain(TEST_PROWLARR_KEY);
    expect(logged.join('\n')).not.toContain('tracker-secret');
  });
});

describe('fetchDownloadSource httpsAgent scope', () => {
  const agent = new HttpsAgent({ rejectUnauthorized: false });
  const redirect = (location: string) => ({ isAxiosError: true, response: { status: 302, headers: { location } } });

  const withProwlarr = (prowlarrBaseUrl: string) => ({
    sourceAuth: { prowlarrBaseUrl, apiKey: 'k' }, allowMagnet: true, timeoutMs: 5000, httpsAgent: agent,
  });

  it('uses the agent only on hops to the configured https Prowlarr origin', async () => {
    const get = vi.spyOn(axios, 'get')
      .mockRejectedValueOnce(redirect('https://other.example/file'))
      .mockResolvedValueOnce({ data: TEST_TORRENT, headers: {} });

    await fetchDownloadSource('https://PROWLARR.example/1/download', withProwlarr('https://prowlarr.example'));

    expect(get.mock.calls[0][1]?.httpsAgent).toBe(agent);
    expect(get.mock.calls[1][1]?.httpsAgent).toBeUndefined();
  });

  it('never uses the agent when the first URL names another host', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: TEST_TORRENT, headers: {} });

    await fetchDownloadSource('https://other.example/1/download', withProwlarr('https://prowlarr.example'));

    expect(get.mock.calls[0][1]?.httpsAgent).toBeUndefined();
  });

  it('never uses the agent when the configured Prowlarr is plain http', async () => {
    const get = vi.spyOn(axios, 'get')
      .mockRejectedValueOnce(redirect('https://prowlarr.example/next'))
      .mockResolvedValueOnce({ data: TEST_TORRENT, headers: {} });

    await fetchDownloadSource('http://prowlarr.example/1/download', withProwlarr('http://prowlarr.example'));

    expect(get.mock.calls.every(([, config]) => config?.httpsAgent === undefined)).toBe(true);
  });

  it('throws an unusable-source error for a redirect to a malformed magnet', async () => {
    vi.spyOn(axios, 'get').mockRejectedValueOnce(redirect('magnet:?xt=urn:btih:abc http://x.example'));

    await expect(fetchDownloadSource('https://prowlarr.example/1/download', withProwlarr('https://prowlarr.example')))
      .rejects.toBeInstanceOf(UnusableDownloadSourceError);
  });
});
