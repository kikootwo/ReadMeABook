/**
 * Component: Bulk Import Match API (Change match / Find match on the review screen)
 * Documentation: documentation/features/bulk-import.md
 *
 * GET /api/admin/bulk-import/match?q=<title, author or ASIN>. Admin session only: an API token is
 * refused by requireAuth because this path is not on the token allowlist. A typed ASIN resolves
 * the way the import does (audiobooks row, Audible cache, live); anything else runs an Audible
 * search with no language filter (the files are already on disk). Each result carries the scan's
 * flags, so books the import would refuse show but can't be picked.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { getConfigService } from '@/lib/services/config.service';
import { AUDIBLE_REGIONS } from '@/lib/types/audible';
import { typedAsin } from '@/lib/utils/asin';
import { getImportBlocks, resolveBookByAsin, type BookMatch } from '@/lib/utils/bulk-import-checks';
import { MATCH_QUERY_MAX_LENGTH, MATCH_RESULT_LIMIT } from '@/lib/constants/bulk-import';

const logger = RMABLogger.create('API.Admin.BulkImport.Match');

/** The store's host for the not-found text (audible.com, audible.co.uk, ...). */
function storeName(baseUrl: string | undefined): string {
  return (baseUrl ?? 'https://www.audible.com').replace(/^https?:\/\/(www\.)?/, '');
}

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
      if (!q || q.length > MATCH_QUERY_MAX_LENGTH) {
        return NextResponse.json(
          { error: `q is required (at most ${MATCH_QUERY_MAX_LENGTH} characters)` },
          { status: 400 }
        );
      }

      try {
        const region = await getConfigService().getAudibleRegion();
        const store = storeName(AUDIBLE_REGIONS[region]?.baseUrl);
        const asin = typedAsin(q);

        let books: BookMatch[];
        if (asin) {
          const resolved = await resolveBookByAsin(asin, { fillSeries: false });
          books = resolved ? [resolved.match] : [];
        } else {
          const found = await getAudibleService().search(q, 1, { ignoreLanguageFilter: true });
          books = found.results.slice(0, MATCH_RESULT_LIMIT).map((b) => ({
            asin: b.asin, title: b.title, author: b.author, narrator: b.narrator,
            coverArtUrl: b.coverArtUrl, durationMinutes: b.durationMinutes,
          }));
        }

        const blocks = await getImportBlocks(books.map((b) => b.asin));
        const results = books.map((b) => ({
          ...b,
          inLibrary: blocks.get(b.asin)?.inLibrary ?? false,
          hasActiveRequest: blocks.get(b.asin)?.hasActiveRequest ?? false,
        }));

        return NextResponse.json({ kind: asin ? 'asin' : 'search', asin, store, results });
      } catch (error) {
        logger.error('Bulk import match lookup failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Audible lookup failed' }, { status: 502 });
      }
    });
  });
}
