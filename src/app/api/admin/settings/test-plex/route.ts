/**
 * Component: Admin Settings Test Plex API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getPlexService } from '@/lib/integrations/plex.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedPlexCredential } from '@/lib/services/saved-credentials.service';

const logger = RMABLogger.create('API.Admin.Settings.TestPlex');

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

        // A masked token reuses the saved one — only for the saved server URL
        const resolved = await resolveSecretForUrl({
          kind: 'plex',
          url,
          supplied: token,
          missingMessage: 'No stored token found. Please re-enter your Plex token.',
          loadSaved: savedPlexCredential,
        });
        if (!resolved.ok) {
          return NextResponse.json({ success: false, error: resolved.error }, { status: 400 });
        }
        const actualToken = resolved.secret;

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
        logger.error('Plex test failed', { error: error instanceof Error ? error.message : String(error) });
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
