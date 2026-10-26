/**
 * Component: FlareSolverr Connection Test API
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { testFlareSolverrConnection } from '@/lib/services/ebook-scraper';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.Settings.TestFlareSolverr');

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const { url, baseUrl } = bodyResult.data;

        if (!url) {
          return NextResponse.json(
            { error: 'FlareSolverr URL is required' },
            { status: 400 }
          );
        }

        if (!url.startsWith('http')) {
          return NextResponse.json(
            { error: 'URL must start with http:// or https://' },
            { status: 400 }
          );
        }

        const result = await testFlareSolverrConnection(url, baseUrl);

        return NextResponse.json(result);
      } catch (error) {
        logger.error('FlareSolverr test failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          { status: 500 }
        );
      }
    });
  });
}
