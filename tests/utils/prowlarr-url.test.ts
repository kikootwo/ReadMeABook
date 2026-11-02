/**
 * Component: Prowlarr Download URL Rules Tests
 * Documentation: documentation/phase3/download-clients.md
 */

import { describe, expect, it } from 'vitest';
import {
  foreignProxyLinkOrigins,
  isMagnetUri,
  isProwlarrDownloadUrl,
  parseProwlarrBase,
  urlForLog,
  stripApiKey,
  toConfiguredProwlarrUrl,
  withApiKeyParam,
} from '@/lib/utils/prowlarr-url';

const KEY = 'abc123key';

describe('parseProwlarrBase', () => {
  it('keeps origin, host, port and base path', () => {
    expect(parseProwlarrBase('http://Prowlarr:9696/prowlarr/')).toMatchObject({
      origin: 'http://prowlarr:9696', hostname: 'prowlarr', port: '9696', defaultPort: false, userinfo: '', basePath: '/prowlarr',
    });
    expect(parseProwlarrBase('https://p.example')).toMatchObject({ port: '443', defaultPort: true, host: 'p.example' });
  });

  it.each(['', 'ftp://prowlarr', 'javascript:alert(1)', 'not a url'])(
    'rejects %j',
    (value) => expect(parseProwlarrBase(value)).toBeNull()
  );
});

describe('isProwlarrDownloadUrl', () => {
  const base = parseProwlarrBase('http://prowlarr:9696');
  const withPath = parseProwlarrBase('https://media.example/prowlarr');

  it.each([
    ['http://prowlarr:9696/12/download?apikey=x&link=y', base, true],
    ['http://prowlarr:9696:/12/download', base, false],
    ['http://prowlarr:9696/api/v1/indexer', base, false],
    ['http://prowlarr:9696/12/download/../../api/v1/system', base, false],
    ['http://prowlarr:9696/12/api', base, false],
    ['http://prowlarr:9697/12/download', base, false],
    ['https://prowlarr:9696/12/download', base, false],
    ['http://prowlarr.evil:9696/12/download', base, false],
    ['http://u:p@prowlarr:9696/12/download', base, false],
    ['https://media.example/prowlarr/3/download', withPath, true],
    ['https://media.example/3/download', withPath, false],
    ['https://media.example/prowlarrx/3/download', withPath, false],
    ['https://media.example/Prowlarr/3/download', withPath, true],
    ['http://media.example/prowlarr/3/download', withPath, false],
    ['http://a:b@prowlarr:9696/12/download', parseProwlarrBase('http://a:b@prowlarr:9696'), true],
  ])('%s → %s', (url, b, expected) => {
    expect(isProwlarrDownloadUrl(url, b as any)).toBe(expected);
  });

  it('is false without a configured base', () => {
    expect(isProwlarrDownloadUrl('http://prowlarr:9696/1/download', null)).toBe(false);
  });
});

describe('toConfiguredProwlarrUrl', () => {
  const base = parseProwlarrBase('http://prowlarr:9696');
  const withPath = parseProwlarrBase('https://admin:pw@media.example:8443/prowlarr/');
  const ipv6 = parseProwlarrBase('http://[fd00::5]:9696/p');

  it.each([
    // Links on the configured address keep today's rules (no link= needed)
    ['http://prowlarr:9696/12/download', base, 'http://prowlarr:9696/12/download'],
    ['https://prowlarr/12/download?x=1', base, null],
    // Proxy links on any host are rebuilt on the configured base
    ['https://127.0.0.1:9663/12/download?link=L&file=B', base, 'http://prowlarr:9696/12/download?link=L&file=B'],
    ['http://prowlarr:9697/12/download?link=L', base, 'http://prowlarr:9696/12/download?link=L'],
    ['http://u:p@other.example/12/download?link=L', base, 'http://prowlarr:9696/12/download?link=L'],
    ['http://other.example/a/b/12/DOWNLOAD?link=L#f', base, 'http://prowlarr:9696/12/download?link=L#f'],
    ['http://other.example/12/download?link=L', withPath, 'https://media.example:8443/prowlarr/12/download?link=L'],
    ['http://media.example:8443/12/download?link=L', withPath, 'https://media.example:8443/prowlarr/12/download?link=L'],
    ['http://127.0.0.1:9663/p/12/download?link=L', ipv6, 'http://[fd00::5]:9696/p/12/download?link=L'],
    // Not proxy links
    ['http://other.example/12/download', base, null],
    ['http://other.example/12/download?link=', base, null],
    ['http://other.example/12/download?file=B', base, null],
    ['http://other.example/12/download/x?link=L', base, null],
    ['http://other.example/download?link=L', base, null],
    ['http://other.example/abc/download?link=L', base, null],
    ['http://other.example/12/api?link=L', base, null],
    ['ftp://other.example/12/download?link=L', base, null],
    ['magnet:?xt=urn:btih:abc', base, null],
  ])('%s → %s', (url, b, expected) => {
    expect(toConfiguredProwlarrUrl(url, b)).toBe(expected);
  });

  it('adds configured credentials only with withCredentials', () => {
    const link = 'https://127.0.0.1:9663/12/download?link=L';
    expect(toConfiguredProwlarrUrl(link, withPath)).toBe('https://media.example:8443/prowlarr/12/download?link=L');
    expect(toConfiguredProwlarrUrl(link, withPath, { withCredentials: true })).toBe(
      'https://admin:pw@media.example:8443/prowlarr/12/download?link=L'
    );
  });

  it('is null without a configured base', () => {
    expect(toConfiguredProwlarrUrl('http://other.example/12/download?link=L', null)).toBeNull();
  });

  it('gets the key only after the rewrite: the published link stays foreign, the rewritten one matches', () => {
    const published = 'https://127.0.0.1:9663/otherapp/12/download?link=L';
    const rewritten = toConfiguredProwlarrUrl(published, base)!;
    expect(isProwlarrDownloadUrl(published, base)).toBe(false);
    expect(isProwlarrDownloadUrl(rewritten, base)).toBe(true);
  });
});

describe('foreignProxyLinkOrigins', () => {
  const base = parseProwlarrBase('http://prowlarr:9696');

  it('names each foreign proxy-link origin once, without path, query or credentials', () => {
    expect(foreignProxyLinkOrigins([
      'https://u:p@127.0.0.1:9663/12/download?link=L&apikey=SECRET',
      'https://127.0.0.1:9663/13/download?link=M',
      'http://prowlarr:9696/14/download?link=N',
      'magnet:?xt=urn:btih:abc',
      'http://tracker.example/file.torrent',
      undefined,
    ], base)).toEqual(['https://127.0.0.1:9663']);
  });

  it('is empty when every link is on the configured address or there is no base', () => {
    expect(foreignProxyLinkOrigins(['http://prowlarr:9696/1/download?link=L'], base)).toEqual([]);
    expect(foreignProxyLinkOrigins(['https://127.0.0.1:9663/1/download?link=L'], null)).toEqual([]);
  });
});

describe('stripApiKey', () => {
  it.each([
    [`http://p/1/download?apikey=${KEY}&link=L%2B1`, 'http://p/1/download?link=L%2B1'],
    [`http://p/1/download?link=L&apikey=${KEY}`, 'http://p/1/download?link=L'],
    [`http://p/1/download?apikey=${KEY}`, 'http://p/1/download'],
    [`https://other.example/x?a=1&APIKEY=${KEY}&b=2#frag`, 'https://other.example/x?a=1&b=2#frag'],
    ['https://other.example/x?apikey=someone-else', 'https://other.example/x?apikey=someone-else'],
  ])('%s → %s', (input, output) => {
    expect(stripApiKey(input, KEY)).toBe(output);
  });

  it('masks the key wherever else it appears', () => {
    expect(stripApiKey(`guid-${KEY}`, KEY)).toBe('guid-REDACTED');
  });

  it('is a no-op without a key', () => {
    expect(stripApiKey('http://p/1/download?apikey=x', undefined)).toBe('http://p/1/download?apikey=x');
  });
});

describe('withApiKeyParam', () => {
  it.each([
    ['http://p/1/download?link=x', `http://p/1/download?link=x&apikey=${KEY}`],
    ['http://p/1/download', `http://p/1/download?apikey=${KEY}`],
    ['http://p/1/download?link=x#f', `http://p/1/download?link=x&apikey=${KEY}#f`],
    [`http://p/1/download?apikey=${KEY}`, `http://p/1/download?apikey=${KEY}`],
  ])('%s → %s', (input, output) => {
    expect(withApiKeyParam(input, KEY)).toBe(output);
  });
});

describe('urlForLog / isMagnetUri', () => {
  it.each([
    ['https://u:p@t.example:8443/a/PASSKEY123/dl?torrent_pass=s1&authkey=s2', 'https://t.example:8443'],
    ['http://prowlarr:9696/1/download?apikey=s3&link=x', 'http://prowlarr:9696'],
    ['magnet:?xt=urn:btih:abc&tr=https%3A%2F%2Ftracker.example%2Fs4%2Fannounce', 'magnet:'],
    ['not a url', '(invalid URL)'],
  ])('logs only scheme + host for %s', (input, output) => {
    expect(urlForLog(input)).toBe(output);
  });

  it('detects magnets', () => {
    expect(isMagnetUri('magnet:?xt=urn:btih:abc')).toBe(true);
    expect(isMagnetUri('http://x/magnet:?')).toBe(false);
  });

  it.each([
    ['embedded newline', 'magnet:?xt=urn:btih:abc\nhttp://evil.example/x'],
    ['embedded CRLF', 'magnet:?xt=urn:btih:abc\r\nhttp://evil.example/x'],
    ['embedded space', 'magnet:?xt=urn:btih:abc http://evil.example/x'],
    ['embedded tab', 'magnet:?xt=urn:btih:abc\thttp://evil.example/x'],
    ['trailing newline', 'magnet:?xt=urn:btih:abc\n'],
    ['leading space', ' magnet:?xt=urn:btih:abc'],
    ['empty query', 'magnet:?'],
  ])('rejects a magnet with %s', (_label, value) => {
    expect(isMagnetUri(value)).toBe(false);
  });
});
