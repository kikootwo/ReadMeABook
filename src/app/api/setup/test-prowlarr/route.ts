/**
 * Component: Setup Wizard Test Prowlarr API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { ProwlarrService } from '@/lib/integrations/prowlarr.service';
import { requireSetupIncomplete } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Setup.TestProwlarr');

export async function POST(request: NextRequest) {
  return requireSetupIncomplete(request, async (req) => {
  try {
    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) return bodyResult.response;
    const { url, apiKey } = bodyResult.data;

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
    logger.error('Prowlarr test failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect to Prowlarr',
      },
      { status: 500 }
    );
  }
  });
}
