/**
 * Component: Setup Wizard Test Plex API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPlexService } from '@/lib/integrations/plex.service';

export async function POST(request: NextRequest) {
  try {
    const { url, token } = await request.json();

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
    console.error('[Setup] Plex test failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect to Plex',
      },
      { status: 500 }
    );
  }
}
