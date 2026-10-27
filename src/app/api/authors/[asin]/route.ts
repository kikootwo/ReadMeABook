/**
 * Component: Author Detail API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { AUDIBLE_REGIONS, DEFAULT_AUDIBLE_REGION, AudibleRegion } from '@/lib/types/audible';
import { RMABLogger } from '@/lib/utils/logger';
import {
  AudnexusAuthorDetail,
  fetchAuthorDetail,
} from '@/lib/integrations/audnexus-authors';

const logger = RMABLogger.create('API.Authors.Detail');

const SIMILAR_AUTHORS_LIMIT = 15;

/**
 * GET /api/authors/{asin}
 * Fetch author detail from Audnexus with enriched similar author images
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  return requireAuth(request, async () => {
    try {
      const { asin } = await params;

      if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Valid author ASIN is required' },
          { status: 400 }
        );
      }

      const configService = getConfigService();
      const audibleRegion: AudibleRegion = await configService.getAudibleRegion();
      const regionConfig = AUDIBLE_REGIONS[audibleRegion] || AUDIBLE_REGIONS[DEFAULT_AUDIBLE_REGION];
      const region = regionConfig.audnexusParam;

      logger.info(`Fetching author detail: ${asin} (region: ${region})`);

      // Fetch the primary author detail
      const detail = await fetchAuthorDetail(asin, region);
      if (!detail) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Author not found' },
          { status: 404 }
        );
      }

      // Fetch images for similar authors in parallel (capped)
      const similarSlice = (detail.similar || []).slice(0, SIMILAR_AUTHORS_LIMIT);
      const similarDetails = await Promise.all(
        similarSlice.map(s => fetchAuthorDetail(s.asin, region))
      );

      const similarAuthors = similarSlice.map((s, i) => ({
        asin: s.asin,
        name: s.name,
        image: similarDetails[i]?.image || undefined,
      }));

      const author = {
        asin: detail.asin,
        name: detail.name,
        description: detail.description || undefined,
        image: detail.image || undefined,
        genres: detail.genres?.map(g => g.name) || [],
        similar: similarAuthors,
        audibleUrl: `${regionConfig.baseUrl}/author/${asin}`,
      };

      logger.info(`Author detail complete: "${detail.name}" (${similarAuthors.length} similar authors)`);

      return NextResponse.json({ success: true, author });
    } catch (error) {
      logger.error('Failed to fetch author detail', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: 'FetchError', message: 'Failed to fetch author details' },
        { status: 500 }
      );
    }
  });
}
