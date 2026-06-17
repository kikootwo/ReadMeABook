/**
 * Component: Fetch Ebook by ASIN API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Thin HTTP wrapper around createEbookRequestForUser() (src/lib/services/ebook-request-creator.service.ts).
 * The shared service is also used by the Discord /checkout ebook flow so both surfaces run an
 * identical code path (including the approval gate and the "must already own the audiobook" rule).
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

      if (!result.success) {
        // Map service reason → original HTTP status codes
        switch (result.reason) {
          case 'feature_disabled':
            return NextResponse.json({ error: result.message }, { status: 400 });
          case 'not_found_on_audible':
            return NextResponse.json({ error: result.message }, { status: 404 });
          case 'not_available':
            return NextResponse.json({ error: result.message }, { status: 400 });
          case 'already_active':
            return NextResponse.json(
              { success: false, message: result.message, requestId: result.requestId },
              { status: 409 }
            );
          case 'user_not_found':
            return NextResponse.json({ error: result.message }, { status: 404 });
          default:
            return NextResponse.json({ error: result.message }, { status: 500 });
        }
      }

      return NextResponse.json(
        {
          success: true,
          message: result.message,
          requestId: result.requestId,
          needsApproval: result.needsApproval,
        },
        { status: 201 }
      );
    } catch (error) {
      logger.error('Unexpected error', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
