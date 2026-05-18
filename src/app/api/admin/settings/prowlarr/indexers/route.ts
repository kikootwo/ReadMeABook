/**
 * Component: Prowlarr Indexers API Route
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getProwlarrService } from '@/lib/integrations/prowlarr.service';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.ProwlarrIndexers');

interface SavedIndexerConfig {
  id: number;
  name: string;
  protocol: string;
  priority: number;
  seedingTimeMinutes?: number; // Torrents only
  ratioLimit?: number; // Torrents only (0 = no ratio requirement)
  removeAfterProcessing?: boolean; // Usenet only
  rssEnabled?: boolean;
  audiobookCategories?: number[]; // Array of category IDs for audiobooks (default: [3030])
  ebookCategories?: number[]; // Array of category IDs for ebooks (default: [7020])
  categories?: number[]; // Legacy field for migration
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

        // Get saved flag configuration
        const flagConfigStr = await configService.get('indexer_flag_config');
        const flagConfigs = flagConfigStr ? JSON.parse(flagConfigStr) : [];

        // Merge with defaults (wizard format: array of {id, name, priority, seedingTimeMinutes})
        const savedIndexersMap = new Map<number, SavedIndexerConfig>(
          savedIndexers.map((idx) => [idx.id, idx])
        );

        const indexersWithConfig = indexers.map((indexer: any) => {
          const saved = savedIndexersMap.get(indexer.id);
          const isAdded = !!saved;
          const isTorrent = indexer.protocol?.toLowerCase() === 'torrent';

          // Migration: if old 'categories' field exists but new fields don't, migrate
          const migratedAudiobookCategories = saved?.audiobookCategories ||
            saved?.categories || // Legacy migration
            [3030]; // Default to audiobooks category
          const migratedEbookCategories = saved?.ebookCategories || [7020]; // Default to ebooks category

          const config: any = {
            id: indexer.id,
            name: indexer.name,
            protocol: indexer.protocol,
            privacy: indexer.privacy,
            enabled: isAdded, // Enabled if in saved list
            isAdded, // Explicit flag for UI (new card-based interface)
            priority: saved?.priority || 10,
            rssEnabled: saved?.rssEnabled ?? false,
            audiobookCategories: migratedAudiobookCategories,
            ebookCategories: migratedEbookCategories,
            supportsRss: indexer.capabilities?.supportsRss !== false, // Default to true if not specified
          };

          // Add protocol-specific fields
          if (isTorrent) {
            config.seedingTimeMinutes = saved?.seedingTimeMinutes ?? 0;
            config.ratioLimit = saved?.ratioLimit ?? 0;
          } else {
            config.removeAfterProcessing = saved?.removeAfterProcessing ?? true;
          }

          return config;
        });

        return NextResponse.json({
          success: true,
          indexers: indexersWithConfig,
          flagConfigs,
        });
      } catch (error) {
        logger.error('Failed to fetch indexers', { error: error instanceof Error ? error.message : String(error) });
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
 * Save indexer configuration and flag configs
 */
export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { indexers, flagConfigs } = await req.json();

        // Filter to only enabled indexers and convert to wizard format
        const enabledIndexers = indexers
          .filter((indexer: any) => indexer.enabled)
          .map((indexer: any) => {
            const config: any = {
              id: indexer.id,
              name: indexer.name,
              protocol: indexer.protocol,
              priority: indexer.priority,
              rssEnabled: indexer.rssEnabled || false,
              audiobookCategories: indexer.audiobookCategories || [3030], // Default to audiobooks
              ebookCategories: indexer.ebookCategories || [7020], // Default to ebooks
            };

            // Add protocol-specific fields
            const isTorrent = indexer.protocol?.toLowerCase() === 'torrent';
            if (isTorrent) {
              config.seedingTimeMinutes = indexer.seedingTimeMinutes ?? 0;
              config.ratioLimit = indexer.ratioLimit ?? 0;
            } else {
              config.removeAfterProcessing = indexer.removeAfterProcessing ?? true;
            }

            return config;
          });

        // Save to configuration (matches wizard format)
        const configService = getConfigService();
        const configUpdates = [
          {
            key: 'prowlarr_indexers',
            value: JSON.stringify(enabledIndexers),
            category: 'indexer',
            description: 'Prowlarr indexer settings (enabled, priority, seeding time)',
          },
        ];

        // Save flag configs if provided
        if (flagConfigs !== undefined) {
          configUpdates.push({
            key: 'indexer_flag_config',
            value: JSON.stringify(flagConfigs),
            category: 'indexer',
            description: 'Indexer flag bonus/penalty configuration',
          });
        }

        await configService.setMany(configUpdates);

        return NextResponse.json({
          success: true,
          message: 'Indexer configuration saved',
        });
      } catch (error) {
        logger.error('Failed to save indexer config', { error: error instanceof Error ? error.message : String(error) });
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
