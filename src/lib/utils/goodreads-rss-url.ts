/**
 * Component: Goodreads RSS URL Rules
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Goodreads shelf feeds are only ever fetched from Goodreads itself, over https.
 * Client-safe (no server imports): the add/manage shelf modals use it too.
 */

import { parseHttpUrl } from './prowlarr-url';

/** Hosts a Goodreads shelf feed (and any redirect while fetching it) may use */
export const GOODREADS_HOSTS: readonly string[] = ['goodreads.com', 'www.goodreads.com'];

/** Host every saved/fetched feed URL is normalised to */
export const GOODREADS_CANONICAL_HOST = 'www.goodreads.com';

/** Path every Goodreads shelf RSS feed starts with */
export const GOODREADS_RSS_PATH_PREFIX = '/review/list_rss/';

export const GOODREADS_RSS_URL_HINT = 'https://www.goodreads.com/review/list_rss/...';

export const GOODREADS_RSS_URL_ERROR = `URL must be a Goodreads shelf RSS URL (${GOODREADS_RSS_URL_HINT})`;

/** Shown when adding a shelf whose feed Goodreads answers with 404/410 (#514) */
export const GOODREADS_FEEDS_ENDED_ADD_MESSAGE =
  "Goodreads no longer serves shelf RSS feeds, so a Goodreads shelf can't be added. Hardcover lists still work.";

/** Shown on every saved Goodreads shelf: the feeds are gone, so the shelf no longer syncs (#514) */
export const GOODREADS_FEEDS_ENDED_NOTICE =
  'Goodreads no longer serves shelf RSS feeds, so this shelf has stopped syncing. Hardcover lists still work.';

/** HTTP statuses Goodreads answers a shelf feed with now that the feeds are gone */
export const GOODREADS_FEED_ENDED_STATUSES: readonly number[] = [404, 410];

/** A shelf feed request answered 404/410: Goodreads no longer serves shelf RSS feeds (#514) */
export class GoodreadsFeedEndedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Goodreads answered HTTP ${status}: it no longer serves shelf RSS feeds`);
    this.name = 'GoodreadsFeedEndedError';
    this.status = status;
  }
}

/** Goodreads host, default port, no credentials (URL already lowercases the host) */
function isPlainGoodreadsHost(url: URL): boolean {
  return GOODREADS_HOSTS.includes(url.hostname) && url.port === '' && url.username === '' && url.password === '';
}

/** True for an https URL on a Goodreads host with no credentials or custom port. */
export function isGoodreadsHttpsUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  return url !== null && url.protocol === 'https:' && isPlainGoodreadsHost(url);
}

/**
 * Normalise a Goodreads shelf RSS URL to `https://www.goodreads.com/review/list_rss/...`
 * (an http:// or bare goodreads.com link is accepted and rewritten). Returns null for
 * anything that is not a Goodreads shelf feed.
 */
export function toGoodreadsRssUrl(value: string): string | null {
  const url = parseHttpUrl(value);
  if (!url || !isPlainGoodreadsHost(url) || !url.pathname.startsWith(GOODREADS_RSS_PATH_PREFIX)) return null;
  url.protocol = 'https:';
  url.hostname = GOODREADS_CANONICAL_HOST;
  return url.toString();
}
