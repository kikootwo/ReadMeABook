/**
 * Component: Search Anna's Archive API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Structured search against Anna's Archive with multiple results.
 * Uses direct HTTP (no FlareSolverr) for fast interactive previews.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { getLanguageForRegion } from '@/lib/constants/language-config';
import type { AudibleRegion } from '@/lib/types/audible';
import { searchAnnasArchiveMulti } from '@/lib/services/ebook-scraper';
import type { AnnasArchiveSearchParams } from '@/lib/services/ebook-scraper';

const logger = RMABLogger.create('API.SearchAnnasArchive');

const SEARCHABLE_STATUSES_EBOOK = ['pending', 'failed', 'awaiting_search', 'awaiting_release', 'unavailable'];
const SEARCHABLE_STATUSES_AUDIOBOOK = ['downloaded', 'available'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));

        const searchParams: AnnasArchiveSearchParams = {
          title: body.title || undefined,
          author: body.author || undefined,
          asinOrIsbn: body.asinOrIsbn || undefined,
          format: body.format || undefined,
          year: body.year || undefined,
          freeTextQuery: body.freeTextQuery || undefined,
        };

        const requestRecord = await prisma.request.findUnique({
          where: { id },
          include: { audiobook: true },
        });

        if (!requestRecord) {
          return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }

        const isEbook = requestRecord.type === 'ebook';
        const isAudiobook = requestRecord.type === 'audiobook';
        const validStatuses = isEbook ? SEARCHABLE_STATUSES_EBOOK : SEARCHABLE_STATUSES_AUDIOBOOK;

        if (!validStatuses.includes(requestRecord.status)) {
          return NextResponse.json(
            { error: `Cannot search for request in ${requestRecord.status} status` },
            { status: 400 }
          );
        }

        if (!isEbook && !isAudiobook) {
          return NextResponse.json({ error: 'Invalid request type' }, { status: 400 });
        }

        const configService = getConfigService();
        const baseUrl = await configService.get('ebook_sidecar_base_url') || 'https://annas-archive.gl';
        const region = await configService.getAudibleRegion() as AudibleRegion;
        const langConfig = getLanguageForRegion(region);

        logger.info(`Anna's Archive search for request ${id}: title="${searchParams.title}", author="${searchParams.author}"`);

        const results = await searchAnnasArchiveMulti(searchParams, baseUrl, langConfig.annasArchiveLang);

        logger.info(`Found ${results.length} Anna's Archive results`);

        return NextResponse.json({ results });
      } catch (error) {
        logger.error('Search failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Search failed' },
          { status: 500 }
        );
      }
    });
  });
}
