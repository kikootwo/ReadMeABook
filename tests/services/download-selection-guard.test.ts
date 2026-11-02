/**
 * Component: Download Selection Guard Tests (configured-base matching + rewrite)
 * Documentation: documentation/phase3/download-clients.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProwlarrBase } from '@/lib/utils/prowlarr-url';

const connection = vi.hoisted(() => ({ baseUrl: 'http://prowlarr:9696' }));
vi.mock('@/lib/integrations/prowlarr-connection', async () => {
  const { parseProwlarrBase: parse } = await import('@/lib/utils/prowlarr-url');
  return {
    getProwlarrConnection: async () => ({ baseUrl: connection.baseUrl, apiKey: 'k', base: parse(connection.baseUrl) }),
  };
});

import { checkClientDownloadUrl, guardTorrentSelection } from '@/lib/services/download-selection-guard';

describe('checkClientDownloadUrl against the configured Prowlarr base', () => {
  beforeEach(() => {
    connection.baseUrl = 'http://prowlarr:9696';
  });

  it.each([
    [
      '(a) TLS proxy: configured https, Prowlarr publishes http links',
      'https://prowlarr.example',
      'http://prowlarr.example/3/download?link=abc&file=Book',
      'https://prowlarr.example/3/download?link=abc&file=Book',
    ],
    [
      '(b) configured URL carries credentials (never copied into the pick)',
      'http://admin:s3cret@prowlarr:9696',
      'http://prowlarr:9696/3/download?link=abc',
      'http://prowlarr:9696/3/download?link=abc',
    ],
    [
      'a pick that carries its own credentials (discarded)',
      'http://admin:s3cret@prowlarr:9696',
      'http://other:x@prowlarr:9696/3/download?link=abc',
      'http://prowlarr:9696/3/download?link=abc',
    ],
    [
      '(c) URL base differs in case',
      'http://prowlarr:9696/prowlarr',
      'http://PROWLARR:9696/Prowlarr/3/download?link=abc',
      'http://prowlarr:9696/prowlarr/3/download?link=abc',
    ],
    [
      'exact match',
      'http://prowlarr:9696',
      'http://prowlarr:9696/3/download?link=abc',
      'http://prowlarr:9696/3/download?link=abc',
    ],
  ])('accepts %s and rewrites onto the configured base', async (_label, configured, picked, expected) => {
    connection.baseUrl = configured;
    await expect(checkClientDownloadUrl(picked)).resolves.toEqual({ ok: true, value: expected });
  });

  it.each([
    ['a different host', 'https://prowlarr.example', 'http://evil.example/3/download'],
    ['a different non-default port on the same host', 'http://prowlarr:9696', 'http://prowlarr:9697/3/download'],
    ['same host but a non-default port while configured on the default one', 'https://prowlarr.example', 'http://prowlarr.example:8080/3/download'],
    ['a non-download Prowlarr path', 'http://prowlarr:9696', 'http://prowlarr:9696/api/v1/indexer'],
    ['outside the configured base path', 'http://prowlarr:9696/prowlarr', 'http://prowlarr:9696/3/download'],
  ])('rejects %s', async (_label, configured, picked) => {
    connection.baseUrl = configured;
    const result = await checkClientDownloadUrl(picked);
    expect(result.ok).toBe(false);
  });

  it('keeps magnets as-is and returns the normalized pick', async () => {
    const magnet = 'magnet:?xt=urn:btih:abc';
    await expect(checkClientDownloadUrl(magnet)).resolves.toEqual({ ok: true, value: magnet });

    connection.baseUrl = 'https://prowlarr.example';
    const pick = await guardTorrentSelection({ title: 'T', downloadUrl: 'http://prowlarr.example/1/download' });
    expect(pick).toEqual({ ok: true, value: { title: 'T', downloadUrl: 'https://prowlarr.example/1/download' } });
  });

  it('parses a configured base with credentials', () => {
    expect(parseProwlarrBase('http://admin:s3cret@prowlarr:9696/x/')).toMatchObject({
      userinfo: 'admin:s3cret@', host: 'prowlarr:9696', basePath: '/x', defaultPort: false,
    });
  });
});
