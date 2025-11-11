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
    const serverInfo = await plexService.testConnection(url, token);

    // Get libraries
    const libraries = await plexService.getLibraries(url, token);

    return NextResponse.json({
      success: true,
      serverName: serverInfo.friendlyName || 'Plex Server',
      version: serverInfo.version,
      libraries: libraries.map((lib) => ({
        key: lib.key,
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
