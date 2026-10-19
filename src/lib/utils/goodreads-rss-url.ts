/**
 * Component: Goodreads RSS URL Rules
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Goodreads shelf feeds are only ever fetched from Goodreads itself, over https.
 */

import { z } from 'zod';

/** Hosts a Goodreads shelf feed (and any redirect while fetching it) may use */
export const GOODREADS_HOSTS: readonly string[] = ['goodreads.com', 'www.goodreads.com'];

/** Path every Goodreads shelf RSS feed starts with */
export const GOODREADS_RSS_PATH_PREFIX = '/review/list_rss/';

export const GOODREADS_RSS_URL_HINT = 'https://www.goodreads.com/review/list_rss/...';

function parse(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

/** True for an https URL on a Goodreads host with no credentials or custom port. */
export function isGoodreadsHttpsUrl(value: string): boolean {
  const url = parse(value);
  return (
    url !== null &&
    url.protocol === 'https:' &&
    GOODREADS_HOSTS.includes(url.hostname.toLowerCase()) &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  );
}

/**
 * Normalise a pasted Goodreads shelf RSS URL: an http:// Goodreads link is upgraded to
 * https://. Returns null unless the result is an https Goodreads /review/list_rss/ URL.
 */
export function toGoodreadsRssUrl(value: string): string | null {
  const url = parse(value);
  if (!url) return null;
  if (url.protocol === 'http:' && GOODREADS_HOSTS.includes(url.hostname.toLowerCase()) && url.port === '') {
    url.protocol = 'https:';
  }
  const normalised = url.toString();
  if (!isGoodreadsHttpsUrl(normalised) || !url.pathname.startsWith(GOODREADS_RSS_PATH_PREFIX)) return null;
  return normalised;
}

/** Request-body field for a Goodreads shelf RSS URL; parses to the normalised https URL. */
export const goodreadsRssUrlSchema = z.string().transform((value, ctx) => {
  const feedUrl = toGoodreadsRssUrl(value);
  if (!feedUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `URL must be a Goodreads shelf RSS URL (${GOODREADS_RSS_URL_HINT})` });
    return z.NEVER;
  }
  return feedUrl;
});
