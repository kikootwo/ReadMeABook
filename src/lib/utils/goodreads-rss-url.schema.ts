/**
 * Component: Goodreads RSS URL request schema (server routes)
 * Documentation: documentation/backend/services/goodreads-sync.md
 */

import { z } from 'zod';
import { GOODREADS_RSS_URL_ERROR, toGoodreadsRssUrl } from './goodreads-rss-url';

/** Request-body field for a Goodreads shelf RSS URL; parses to the normalised URL. */
export const goodreadsRssUrlSchema = z.string().transform((value, ctx) => {
  const feedUrl = toGoodreadsRssUrl(value);
  if (!feedUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: GOODREADS_RSS_URL_ERROR });
    return z.NEVER;
  }
  return feedUrl;
});
