/**
 * Component: Ebook Status API Route
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Returns ebook availability status for a specific audiobook
 * Used by AudiobookDetailsModal to determine if ebook buttons should be shown
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { ebookSourcesEnabled } from '@/lib/services/ebook-sources';

const logger = RMABLogger.create('API.Audiobooks.EbookStatus');

// Statuses that indicate an active/in-progress ebook request
const ACTIVE_EBOOK_STATUSES = [
  'pending',
  'awaiting_approval',
  'searching',
  'downloading',
  'processing',
  'downloaded',
  'available',
];

/**
 * GET /api/audiobooks/[asin]/ebook-status
 * Returns whether ebook sources are enabled and if an active ebook request exists
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      const { asin } = await params;

      if (!asin || asin.length !== 10) {
        return NextResponse.json(
          { error: 'Valid ASIN is required' },
          { status: 400 }
        );
      }

      // If no ebook sources enabled, return early
      if (!(await ebookSourcesEnabled())) {
        return NextResponse.json({
          ebookSourcesEnabled: false,
          hasActiveEbookRequest: false,
          existingEbookStatus: null,
        });
      }

      // Find the audiobook by ASIN
      const audiobook = await prisma.audiobook.findFirst({
        where: { audibleAsin: asin },
        select: { id: true },
      });

      if (!audiobook) {
        // Audiobook not in database - that's fine, just no ebook request possible
        return NextResponse.json({
          ebookSourcesEnabled: true,
          hasActiveEbookRequest: false,
          existingEbookStatus: null,
        });
      }

      // Check for any active ebook request for this audiobook
      const existingEbookRequest = await prisma.request.findFirst({
        where: {
          audiobookId: audiobook.id,
          type: 'ebook',
          deletedAt: null,
          status: { in: ACTIVE_EBOOK_STATUSES },
        },
        select: {
          id: true,
          status: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return NextResponse.json({
        ebookSourcesEnabled: true,
        hasActiveEbookRequest: !!existingEbookRequest,
        existingEbookStatus: existingEbookRequest?.status || null,
        existingEbookRequestId: existingEbookRequest?.id || null,
      });

    } catch (error) {
      logger.error('Failed to get ebook status', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: 'Failed to fetch ebook status' },
        { status: 500 }
      );
    }
  });
}
