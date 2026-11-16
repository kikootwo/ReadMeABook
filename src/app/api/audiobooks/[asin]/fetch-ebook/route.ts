/**
 * Component: Fetch Ebook by ASIN API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Creates an ebook request for an available audiobook (by ASIN)
 * Supports both audiobooks with parent requests and orphan audiobooks (imported outside RMAB)
 * Includes approval logic for non-admin users (src/lib/services/ebook-request-creator.service.ts)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { createEbookRequestForUser } from '@/lib/services/ebook-request-creator.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Audiobooks.FetchEbook');

/**
 * POST /api/audiobooks/[asin]/fetch-ebook
 * Create an ebook request for an available audiobook
 */
export async function POST(
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

      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }

      const result = await createEbookRequestForUser(req.user.id, asin);
      return NextResponse.json(result.body, { status: result.status });
    } catch (error) {
      logger.error('Unexpected error', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
