/**
 * Component: Request Book Details
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * A request's book title, author and cover come from the Audible metadata the server looks up by ASIN
 * (Audnexus, then the Audible catalog). The details sent with a request fill a new book only
 * where that lookup has nothing; an existing book's saved title and author are not changed by them.
 * A cover sent with a request is used only when it is an Audible image or a cached thumbnail.
 */

import { getAudibleService, type AudibleAudiobook } from '@/lib/integrations/audible.service';
import { ASIN_PATTERN } from '@/lib/utils/asin';
import { isLibraryCoverSource, sanitizeCoverArtUrl } from '@/lib/utils/cover-art-url';

/** Book details from the server's lookup or sent with a request (empty strings count as missing) */
export interface BookDetailsSource {
  title?: string | null;
  author?: string | null;
  narrator?: string | null;
  description?: string | null;
  coverArtUrl?: string | null;
}

export interface NewBookDetails {
  title: string;
  author: string;
  narrator?: string;
  description?: string;
}

/**
 * The Audible lookup for a book (`getAudiobookDetails`, which also looks up only ASIN-shaped values),
 * made only for an ASIN-shaped value (10 letters/digits); any other value gets null, the same as a
 * lookup that finds nothing.
 */
export async function lookUpBookDetails(asin: string, options?: { fillSeries?: boolean }): Promise<AudibleAudiobook | null> {
  if (!ASIN_PATTERN.test(asin)) return null;
  const audibleService = getAudibleService();
  return options ? audibleService.getAudiobookDetails(asin, options) : audibleService.getAudiobookDetails(asin);
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function pick(lookedUp: string | null | undefined, sent: string | null | undefined): string | undefined {
  if (present(lookedUp)) return lookedUp;
  return present(sent) ? sent : undefined;
}

/** Details for a new book row: the looked-up value per field, the sent one when the lookup has none */
export function detailsForNewBook(
  lookedUp: BookDetailsSource | null | undefined,
  sent: { title: string; author: string; narrator?: string | null; description?: string | null },
): NewBookDetails {
  return {
    title: pick(lookedUp?.title, sent.title) ?? sent.title,
    author: pick(lookedUp?.author, sent.author) ?? sent.author,
    narrator: pick(lookedUp?.narrator, sent.narrator),
    description: pick(lookedUp?.description, sent.description),
  };
}

/** Title/author changes for an existing book row: only looked-up values that differ from the saved ones */
export function lookedUpTitleAuthorUpdates(
  lookedUp: BookDetailsSource | null | undefined,
  saved: { title: string; author: string },
): { title?: string; author?: string } {
  const updates: { title?: string; author?: string } = {};
  if (present(lookedUp?.title) && lookedUp.title !== saved.title) updates.title = lookedUp.title;
  if (present(lookedUp?.author) && lookedUp.author !== saved.author) updates.author = lookedUp.author;
  return updates;
}

/**
 * Cover for a book requested by a user: the looked-up cover; else the sent one only when it is
 * https on an Audible/Amazon image host (`COVER_ART_HOSTS`) or a cached thumbnail path; else none.
 */
export function coverForRequestedBook(
  lookedUp: BookDetailsSource | null | undefined,
  sent: string | null | undefined,
): string | undefined {
  const lookedUpCover = sanitizeCoverArtUrl(lookedUp?.coverArtUrl);
  if (lookedUpCover) return lookedUpCover;
  return sent && isLibraryCoverSource(sent) ? sent : undefined;
}
