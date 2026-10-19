/**
 * Component: Admin Settings Test Prowlarr API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { ProwlarrService } from '@/lib/integrations/prowlarr.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedProwlarrCredential } from '@/lib/services/saved-credentials.service';

const logger = RMABLogger.create('API.Admin.Settings.TestProwlarr');

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { url, apiKey } = await request.json();

        if (!url || !apiKey) {
          return NextResponse.json(
            { success: false, error: 'URL and API key are required' },
            { status: 400 }
          );
        }

        // A masked API key reuses the saved one — only for the saved Prowlarr URL
        const resolved = await resolveSecretForUrl({
          kind: 'prowlarr',
          url,
          supplied: apiKey,
          missingMessage: 'No stored API key found. Please re-enter your Prowlarr API key.',
          loadSaved: savedProwlarrCredential,
        });
        if (!resolved.ok) {
          return NextResponse.json({ success: false, error: resolved.error }, { status: 400 });
        }
        const actualApiKey = resolved.secret;

        // Create a new ProwlarrService instance with test credentials
        const prowlarrService = new ProwlarrService(url, actualApiKey);

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
            supportsRss: indexer.capabilities?.supportsRss !== false,
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
  });
}
