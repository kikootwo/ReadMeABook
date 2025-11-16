/**
 * Component: Admin Settings Test Plex API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getPlexService } from '@/lib/integrations/plex.service';

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { url, token } = await request.json();

        if (!url || !token) {
          return NextResponse.json(
            { success: false, error: 'URL and token are required' },
            { status: 400 }
          );
        }

        // If token is masked, fetch the actual value from database
        let actualToken = token;
        if (token.startsWith('••••')) {
          const storedToken = await prisma.configuration.findUnique({
            where: { key: 'plex_token' },
          });

          if (!storedToken?.value) {
            return NextResponse.json(
              { success: false, error: 'No stored token found. Please re-enter your Plex token.' },
              { status: 400 }
            );
          }

          actualToken = storedToken.value;
        }

        const plexService = getPlexService();

        // Test connection and get server info
        const connectionResult = await plexService.testConnection(url, actualToken);

        if (!connectionResult.success || !connectionResult.info) {
          return NextResponse.json(
            { success: false, error: connectionResult.message },
            { status: 400 }
          );
        }

        // Get libraries
        const libraries = await plexService.getLibraries(url, actualToken);

        // Format server name safely
        const serverName = connectionResult.info
          ? `${connectionResult.info.platform || 'Plex Server'} v${connectionResult.info.version || 'Unknown'}`
          : 'Plex Server';

        return NextResponse.json({
          success: true,
          serverName,
          version: connectionResult.info?.version || 'Unknown',
          machineIdentifier: connectionResult.info?.machineIdentifier || 'unknown',
          libraries: libraries.map((lib) => ({
            id: lib.id,
            title: lib.title,
            type: lib.type,
          })),
        });
      } catch (error) {
        console.error('[Admin Settings] Plex test failed:', error);
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to connect to Plex',
          },
          { status: 500 }
        );
      }
    });
  });
}
