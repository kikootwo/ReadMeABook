/**
 * Component: Cover Art URL Rules Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import path from 'path';
import { describe, expect, it } from 'vitest';
import { cachedThumbnailPath, isAllowedRemoteCoverUrl, sanitizeCoverArtUrl } from '@/lib/utils/cover-art-url';

describe('cover art URL rules', () => {
  it.each([
    'https://m.media-amazon.com/images/I/abc.jpg',
    'https://images-na.ssl-images-amazon.com/images/I/abc.jpg',
    'https://media-amazon.com/x.jpg',
  ])('accepts known image host %s', (url) => {
    expect(isAllowedRemoteCoverUrl(url)).toBe(true);
    expect(sanitizeCoverArtUrl(url)).toBe(url);
  });

  it.each([
    'http://m.media-amazon.com/images/I/abc.jpg',
    'https://media-amazon.com.evil.example/x.jpg',
    'https://evilmedia-amazon.com/x.jpg',
    'https://user:pw@m.media-amazon.com/x.jpg',
    'http://127.0.0.1:8080/',
    'https://i.gr-assets.com/images/x.jpg',
    'file:///etc/passwd',
    '/etc/passwd',
  ])('never downloads a cover from %s', (url) => {
    expect(isAllowedRemoteCoverUrl(url)).toBe(false);
  });

  it.each([
    'https://i.gr-assets.com/images/S/x.jpg',
    'https://assets.hardcover.app/edition/1/cover.jpg',
    'http://example.com/cover.jpg',
  ])('keeps the display URL %s (shelf-sync fallbacks)', (url) => {
    expect(sanitizeCoverArtUrl(url)).toBe(url);
  });

  it.each(['file:///etc/passwd', '/etc/passwd', 'javascript:alert(1)', 'not a url'])('drops %s at storage', (url) => {
    expect(sanitizeCoverArtUrl(url)).toBeUndefined();
  });

  it('maps a cached thumbnail to a file inside the cache dir', () => {
    expect(cachedThumbnailPath('/api/cache/thumbnails/B000123.jpg')).toBe(path.join('/app/cache/thumbnails', 'B000123.jpg'));
    expect(sanitizeCoverArtUrl('/api/cache/thumbnails/B000123.jpg')).toBe('/api/cache/thumbnails/B000123.jpg');
  });

  it.each([
    '/api/cache/thumbnails/../secret',
    '/api/cache/thumbnails/a/../../b.jpg',
    '/api/cache/thumbnails/..%2F..%2Fetc',
    '/api/cache/thumbnails/.hidden',
    '/api/cache/thumbnails/',
    '/api/cache/thumbnails/a\\b.jpg',
  ])('rejects cache path %s', (url) => {
    expect(cachedThumbnailPath(url)).toBeNull();
    expect(sanitizeCoverArtUrl(url)).toBeUndefined();
  });
});
