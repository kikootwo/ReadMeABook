/**
 * Component: Setup Wizard Test Prowlarr API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { ProwlarrService } from '@/lib/integrations/prowlarr.service';

export async function POST(request: NextRequest) {
  try {
    const { url, apiKey } = await request.json();

    if (!url || !apiKey) {
      return NextResponse.json(
        { success: false, error: 'URL and API key are required' },
        { status: 400 }
      );
    }

    // Create a new ProwlarrService instance with test credentials
    const prowlarrService = new ProwlarrService(url, apiKey);

    // Test connection and get indexers
    const indexers = await prowlarrService.getIndexers();

    // Only return enabled indexers
    const enabledIndexers = indexers.filter((indexer) => indexer.enable);

    return NextResponse.json({
      success: true,
      indexerCount: enabledIndexers.length,
      totalIndexers: indexers.length,
      indexers: enabledIndexers.map((indexer) => ({
        id: indexer.id,
        name: indexer.name,
        protocol: indexer.protocol,
        supportsRss: indexer.capabilities?.supportsRss !== false, // Default to true if not specified
      })),
    });
  } catch (error) {
    console.error('[Setup] Prowlarr test failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect to Prowlarr',
      },
      { status: 500 }
    );
  }
}
