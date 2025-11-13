/**
 * Component: Plex Libraries API Route
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getPlexService } from '@/lib/integrations/plex.service';

/**
 * GET /api/admin/settings/plex/libraries
 * Fetch available Plex libraries
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const plexService = await getPlexService();

        // Get Plex configuration
        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();
        const plexUrl = await configService.get('plex_url');
        const plexToken = await configService.get('plex_token');

        if (!plexUrl || !plexToken) {
          return NextResponse.json(
            {
              success: false,
              error: 'Plex not configured',
              message: 'Please configure Plex URL and token first',
            },
            { status: 400 }
          );
        }

        // Fetch all libraries from Plex
        const libraries = await plexService.getLibraries(plexUrl, plexToken);

        // Filter for audiobook/music libraries (type 8 or 15)
        const audioLibraries = libraries.filter((lib: any) =>
          lib.type === 'artist' || lib.type === 'music' || lib.title.toLowerCase().includes('audio')
        );

        return NextResponse.json({
          success: true,
          libraries: audioLibraries.map((lib: any) => ({
            id: lib.key,
            title: lib.title,
            type: lib.type,
          })),
        });
      } catch (error) {
        console.error('[Plex] Failed to fetch libraries:', error);
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to fetch Plex libraries',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          { status: 500 }
        );
      }
    });
  });
}
