/**
 * Component: Prowlarr Indexers API Route
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getProwlarrService } from '@/lib/integrations/prowlarr.service';
import { getConfigService } from '@/lib/services/config.service';

interface SavedIndexerConfig {
  id: number;
  name: string;
  priority: number;
  seedingTimeMinutes: number;
  rssEnabled?: boolean;
}

/**
 * GET /api/admin/settings/prowlarr/indexers
 * Fetch available Prowlarr indexers with configuration
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const prowlarrService = await getProwlarrService();
        const configService = getConfigService();

        // Fetch indexers from Prowlarr
        const indexers = await prowlarrService.getIndexers();

        // Get saved indexer configuration (matches wizard format)
        const savedConfigStr = await configService.get('prowlarr_indexers');
        const savedIndexers: SavedIndexerConfig[] = savedConfigStr ? JSON.parse(savedConfigStr) : [];

        // Merge with defaults (wizard format: array of {id, name, priority, seedingTimeMinutes})
        const savedIndexersMap = new Map<number, SavedIndexerConfig>(
          savedIndexers.map((idx) => [idx.id, idx])
        );

        const indexersWithConfig = indexers.map((indexer: any) => {
          const saved = savedIndexersMap.get(indexer.id);

          return {
            id: indexer.id,
            name: indexer.name,
            protocol: indexer.protocol,
            privacy: indexer.privacy,
            enabled: !!saved, // Enabled if in saved list
            priority: saved?.priority || 10,
            seedingTimeMinutes: saved?.seedingTimeMinutes ?? 0,
            rssEnabled: saved?.rssEnabled ?? false,
            supportsRss: indexer.capabilities?.supportsRss !== false, // Default to true if not specified
          };
        });

        return NextResponse.json({
          success: true,
          indexers: indexersWithConfig,
        });
      } catch (error) {
        console.error('[Prowlarr] Failed to fetch indexers:', error);
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to fetch Prowlarr indexers',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * PUT /api/admin/settings/prowlarr/indexers
 * Save indexer configuration
 */
export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { indexers } = await req.json();

        // Filter to only enabled indexers and convert to wizard format
        const enabledIndexers = indexers
          .filter((indexer: any) => indexer.enabled)
          .map((indexer: any) => ({
            id: indexer.id,
            name: indexer.name,
            priority: indexer.priority,
            seedingTimeMinutes: indexer.seedingTimeMinutes,
            rssEnabled: indexer.rssEnabled || false,
          }));

        // Save to configuration (matches wizard format)
        const configService = getConfigService();
        await configService.setMany([
          {
            key: 'prowlarr_indexers',
            value: JSON.stringify(enabledIndexers),
            category: 'indexer',
            description: 'Prowlarr indexer settings (enabled, priority, seeding time)',
          },
        ]);

        return NextResponse.json({
          success: true,
          message: 'Indexer configuration saved',
        });
      } catch (error) {
        console.error('[Prowlarr] Failed to save indexer config:', error);
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to save indexer configuration',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          { status: 500 }
        );
      }
    });
  });
}
