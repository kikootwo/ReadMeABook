/**
 * Component: Goodreads RSS URL Rules Tests
 * Documentation: documentation/backend/services/goodreads-sync.md
 */

import { describe, expect, it } from 'vitest';
import { goodreadsRssUrlSchema, isGoodreadsHttpsUrl, toGoodreadsRssUrl } from '@/lib/utils/goodreads-rss-url';

describe('toGoodreadsRssUrl', () => {
  it.each([
    ['https://www.goodreads.com/review/list_rss/12345?key=abc&shelf=to-read', 'https://www.goodreads.com/review/list_rss/12345?key=abc&shelf=to-read'],
    ['https://goodreads.com/review/list_rss/12345', 'https://goodreads.com/review/list_rss/12345'],
    ['HTTPS://WWW.GOODREADS.COM/review/list_rss/1', 'https://www.goodreads.com/review/list_rss/1'],
    ['https://www.goodreads.com:443/review/list_rss/1', 'https://www.goodreads.com/review/list_rss/1'],
    ['  https://www.goodreads.com/review/list_rss/1  ', 'https://www.goodreads.com/review/list_rss/1'],
    ['http://www.goodreads.com/review/list_rss/1?shelf=read', 'https://www.goodreads.com/review/list_rss/1?shelf=read'],
  ])('accepts %s', (input, expected) => {
    expect(toGoodreadsRssUrl(input)).toBe(expected);
  });

  it.each([
    ['another host with the Goodreads path in it', 'http://10.0.0.1/goodreads.com/review/list_rss/1'],
    ['a look-alike subdomain', 'https://goodreads.com.evil.example/review/list_rss/1'],
    ['a look-alike domain', 'https://evilgoodreads.com/review/list_rss/1'],
    ['other Goodreads subdomains', 'https://api.goodreads.com/review/list_rss/1'],
    ['credentials before the host', 'https://www.goodreads.com@evil.example/review/list_rss/1'],
    ['credentials on a Goodreads host', 'https://user:pass@www.goodreads.com/review/list_rss/1'],
    ['a custom port', 'https://www.goodreads.com:8443/review/list_rss/1'],
    ['http with a custom port', 'http://www.goodreads.com:8080/review/list_rss/1'],
    ['a non-feed path', 'https://www.goodreads.com/user/show/1'],
    ['the feed path in the query only', 'https://www.goodreads.com/search?q=/review/list_rss/1'],
    ['another scheme', 'ftp://www.goodreads.com/review/list_rss/1'],
    ['not a URL', 'goodreads.com/review/list_rss/1'],
    ['an empty string', ''],
  ])('rejects %s', (_label, input) => {
    expect(toGoodreadsRssUrl(input)).toBeNull();
  });
});

describe('isGoodreadsHttpsUrl', () => {
  it('allows any https path on a Goodreads host (redirect hops)', () => {
    expect(isGoodreadsHttpsUrl('https://www.goodreads.com/user/sign_in')).toBe(true);
  });

  it.each(['http://www.goodreads.com/review/list_rss/1', 'https://127.0.0.1/review/list_rss/1', 'https://www.goodreads.com.evil.example/'])(
    'refuses %s',
    (input) => {
      expect(isGoodreadsHttpsUrl(input)).toBe(false);
    },
  );
});

describe('goodreadsRssUrlSchema', () => {
  it('parses to the normalised https URL', () => {
    expect(goodreadsRssUrlSchema.parse('http://goodreads.com/review/list_rss/9')).toBe('https://goodreads.com/review/list_rss/9');
  });

  it('fails with a message naming the expected URL', () => {
    const result = goodreadsRssUrlSchema.safeParse('http://169.254.169.254/goodreads.com/review/list_rss/1');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('https://www.goodreads.com/review/list_rss/');
  });
});
