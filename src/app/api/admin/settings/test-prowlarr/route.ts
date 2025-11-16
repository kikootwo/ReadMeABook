/**
 * Component: Admin Settings Test Prowlarr API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { ProwlarrService } from '@/lib/integrations/prowlarr.service';

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

        // If API key is masked, fetch the actual value from database
        let actualApiKey = apiKey;
        if (apiKey.startsWith('••••')) {
          const storedApiKey = await prisma.configuration.findUnique({
            where: { key: 'prowlarr_api_key' },
          });

          if (!storedApiKey?.value) {
            return NextResponse.json(
              { success: false, error: 'No stored API key found. Please re-enter your Prowlarr API key.' },
              { status: 400 }
            );
          }

          actualApiKey = storedApiKey.value;
        }

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
        console.error('[Admin Settings] Prowlarr test failed:', error);
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
