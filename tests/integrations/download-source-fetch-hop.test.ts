/**
 * Component: Download Source Fetcher Tests (which server answered a failed fetch, #298)
 * Documentation: documentation/phase3/download-clients.md
 */

import type { ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceServers, TEST_PROWLARR_KEY, redirectTo } from '../helpers/source-servers';
import { fetchDownloadSource } from '@/lib/integrations/download-source';
import { DownloadSourceError } from '@/lib/interfaces/download-client.interface';

vi.mock('@/lib/utils/logger', () => {
  const noop = () => undefined;
  return { RMABLogger: { create: () => ({ info: noop, debug: noop, warn: noop, error: noop }) } };
});

const servers = new SourceServers();
const answer = (status: number, headers: Record<string, string> = {}) => (res: ServerResponse) => {
  res.writeHead(status, headers).end('denied');
};

async function failedFetch(url: string): Promise<DownloadSourceError> {
  const error = await fetchDownloadSource(url, {
    sourceAuth: { prowlarrBaseUrl: `${servers.prowlarrUrl}/prowlarr`, apiKey: TEST_PROWLARR_KEY },
    allowMagnet: true,
    timeoutMs: 5000,
  }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DownloadSourceError);
  return error as DownloadSourceError;
}

/** Nothing about the request beyond scheme + host may appear on the error */
function expectNoLeak(error: DownloadSourceError, ...secrets: string[]): void {
  const fields = JSON.stringify({ message: error.message, sourceUrl: error.sourceUrl, failure: error.failure });
  for (const secret of [TEST_PROWLARR_KEY, '/download', 'link=', ...secrets]) {
    expect(fields).not.toContain(secret);
  }
}

describe('fetchDownloadSource: the failing hop is reported (#298)', () => {
  beforeAll(() => servers.start());
  afterAll(() => servers.stop());
  beforeEach(() => servers.reset());

  it('marks a 401 from the configured Prowlarr address as the Prowlarr hop, with only the auth scheme word', async () => {
    servers.on('prowlarr', '/prowlarr/12/download', answer(401, { 'WWW-Authenticate': 'Basic realm="Top Secret Realm"' }));

    const error = await failedFetch(`${servers.prowlarrUrl}/prowlarr/12/download?link=abc`);

    expect(error.status).toBe(401);
    expect(error.sourceUrl).toBe(servers.prowlarrUrl);
    expect(error.failure).toEqual({ hop: 'prowlarr', redirects: 0, authScheme: 'Basic' });
    expectNoLeak(error, 'Top Secret', 'realm');
  });

  it.each([403, 500])('marks HTTP %i from the configured Prowlarr address as the Prowlarr hop', async (status) => {
    servers.on('prowlarr', '/prowlarr/12/download', answer(status));

    const error = await failedFetch(`${servers.prowlarrUrl}/prowlarr/12/download?link=abc`);

    expect(error.status).toBe(status);
    expect(error.failure).toEqual({ hop: 'prowlarr', redirects: 0 });
    expectNoLeak(error);
  });

  it('marks a 401 after a redirect off Prowlarr as the redirect hop and names that host only', async () => {
    servers.on('prowlarr', '/prowlarr/12/download', redirectTo(`${servers.otherUrl}/getnzb/abc?apikey=indexer-key-777`));
    servers.on('other', '/getnzb/abc', answer(401, { 'WWW-Authenticate': 'Bearer error="invalid_token"' }));

    const error = await failedFetch(`${servers.prowlarrUrl}/prowlarr/12/download?link=abc`);

    expect(error.status).toBe(401);
    expect(error.sourceUrl).toBe(servers.otherUrl);
    expect(error.failure).toEqual({ hop: 'redirect', redirects: 1, authScheme: 'Bearer' });
    expectNoLeak(error, 'indexer-key-777', '/getnzb', 'invalid_token');
  });

  it('marks a direct (non-Prowlarr) link that fails without a redirect as the direct hop', async () => {
    servers.on('other', '/file.torrent', answer(403, { 'WWW-Authenticate': '=garbage' }));

    const error = await failedFetch(`${servers.otherUrl}/file.torrent?passkey=tracker-pass-55`);

    expect(error.failure).toEqual({ hop: 'direct', redirects: 0 });
    expectNoLeak(error, 'tracker-pass-55', '/file.torrent', 'garbage');
  });
});
