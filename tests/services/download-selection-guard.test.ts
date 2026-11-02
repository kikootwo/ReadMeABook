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
    [
      'a different host (Prowlarr behind a proxy that rewrites Host)',
      'https://prowlarr.example',
      'https://127.0.0.1:9663/3/download?link=abc&file=Book',
      'https://prowlarr.example/3/download?link=abc&file=Book',
    ],
    [
      'a different non-default port on the same host',
      'http://prowlarr:9696',
      'http://prowlarr:9697/3/download?link=abc',
      'http://prowlarr:9696/3/download?link=abc',
    ],
    [
      'same host but a non-default port while configured on the default one',
      'https://prowlarr.example',
      'http://prowlarr.example:8080/3/download?link=abc',
      'https://prowlarr.example/3/download?link=abc',
    ],
    [
      'outside the configured base path',
      'http://prowlarr:9696/prowlarr',
      'http://prowlarr:9696/3/download?link=abc',
      'http://prowlarr:9696/prowlarr/3/download?link=abc',
    ],
    [
      'another host with its own path prefix (always dropped)',
      'http://prowlarr:9696/prowlarr',
      'https://proxy.example:8443/otherapp/prowlarr/3/download?link=abc#f',
      'http://prowlarr:9696/prowlarr/3/download?link=abc#f',
    ],
    [
      'another host with its own credentials (dropped)',
      'http://admin:s3cret@prowlarr:9696',
      'http://u:p@127.0.0.1:9696/3/download?link=abc',
      'http://prowlarr:9696/3/download?link=abc',
    ],
    [
      'an IPv6 configured host',
      'http://[::1]:9696',
      'http://127.0.0.1:9663/3/download?link=abc',
      'http://[::1]:9696/3/download?link=abc',
    ],
    [
      'a configured base with a trailing slash',
      'http://prowlarr:9696/prowlarr/',
      'http://127.0.0.1:9663/prowlarr/3/download?link=abc',
      'http://prowlarr:9696/prowlarr/3/download?link=abc',
    ],
  ])('accepts a proxy link on %s and rewrites it onto the configured base', async (_label, configured, picked, expected) => {
    connection.baseUrl = configured;
    await expect(checkClientDownloadUrl(picked)).resolves.toEqual({ ok: true, value: expected });
  });

  it.each([
    ['a different host without link=', 'https://prowlarr.example', 'http://evil.example/3/download'],
    ['a different port without link=', 'http://prowlarr:9696', 'http://prowlarr:9697/3/download'],
    ['same host, non-default port, without link=', 'https://prowlarr.example', 'http://prowlarr.example:8080/3/download'],
    ['outside the configured base path without link=', 'http://prowlarr:9696/prowlarr', 'http://prowlarr:9696/3/download'],
    ['a non-download Prowlarr path', 'http://prowlarr:9696', 'http://prowlarr:9696/api/v1/indexer'],
    ['another host, a path past the download step', 'http://prowlarr:9696', 'http://evil.example/12/download/x?link=abc'],
    ['another host, /download without an id', 'http://prowlarr:9696', 'http://evil.example/download?link=abc'],
    ['another host, a non-numeric id', 'http://prowlarr:9696', 'http://evil.example/abc/download?link=abc'],
    ['another host, an empty link=', 'http://prowlarr:9696', 'http://evil.example/12/download?link=&file=x'],
    ['another host, link in the fragment only', 'http://prowlarr:9696', 'http://evil.example/12/download#link=abc'],
    ['a non-http scheme', 'http://prowlarr:9696', 'ftp://evil.example/12/download?link=abc'],
    ['a magnet with whitespace', 'http://prowlarr:9696', 'magnet:?xt=urn:btih:abc\nhttp://evil.example/12/download?link=a'],
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
