/**
 * Component: Setup Wizard Test Plex API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPlexService } from '@/lib/integrations/plex.service';
import { requireSetupIncomplete } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Setup.TestPlex');

export async function POST(request: NextRequest) {
  return requireSetupIncomplete(request, async (req) => {
  try {
    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) return bodyResult.response;
    const { url, token } = bodyResult.data;

    if (!url || !token) {
      return NextResponse.json(
        { success: false, error: 'URL and token are required' },
        { status: 400 }
      );
    }

    const plexService = getPlexService();

    // Test connection and get server info
    const connectionResult = await plexService.testConnection(url, token);

    if (!connectionResult.success || !connectionResult.info) {
      return NextResponse.json(
        { success: false, error: connectionResult.message },
        { status: 400 }
      );
    }

    // Get libraries
    const libraries = await plexService.getLibraries(url, token);

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
}
