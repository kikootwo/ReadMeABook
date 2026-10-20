/**
 * Component: Prowlarr Indexers API Route
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getProwlarrService } from '@/lib/integrations/prowlarr.service';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { invalidIndexerLimit, toSavedIndexerConfig, type IndexerConfigInput } from '@/lib/utils/indexer-config';

const logger = RMABLogger.create('API.Admin.Settings.ProwlarrIndexers');

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
        const savedIndexers: IndexerConfigInput[] = savedConfigStr ? JSON.parse(savedConfigStr) : [];

        // Get saved flag configuration
        const flagConfigStr = await configService.get('indexer_flag_config');
        const flagConfigs = flagConfigStr ? JSON.parse(flagConfigStr) : [];

        // Merge live Prowlarr indexers with saved settings. Identity (name, protocol)
        // comes from Prowlarr; per-indexer settings come from the saved entry.
        const savedIndexersMap = new Map<number, IndexerConfigInput>(
          savedIndexers.map((idx) => [idx.id, idx])
        );

        const indexersWithConfig = indexers.map((indexer: any) => {
          const saved = savedIndexersMap.get(indexer.id);
          const isAdded = !!saved;

          return {
            ...toSavedIndexerConfig({
              ...saved,
              id: indexer.id,
              name: indexer.name,
              protocol: indexer.protocol,
            }),
            privacy: indexer.privacy,
            enabled: isAdded, // Enabled if in saved list
            isAdded, // Explicit flag for UI (new card-based interface)
            supportsRss: indexer.capabilities?.supportsRss !== false, // Default to true if not specified
          };
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

const badRequest = (status: number, error: string) =>
  NextResponse.json({ success: false, error }, { status });

/**
 * PUT /api/admin/settings/prowlarr/indexers
 * Save indexer configuration and flag configs.
 * Body: { indexers, flagConfigs?, allowEmpty? }. An empty list never replaces
 * saved indexers unless allowEmpty is true (the client loaded the list and the
 * admin removed every indexer); a client whose list failed to load sends none.
 */
export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        let body: any;
        try {
          body = await req.json();
        } catch {
          return badRequest(400, 'Request body must be JSON');
        }
        const { indexers, flagConfigs, allowEmpty } = body ?? {};
        if (!Array.isArray(indexers)) {
          return badRequest(400, 'indexers must be an array');
        }

        const enabled = indexers.filter((indexer: any) => indexer && typeof indexer === 'object' && indexer.enabled);
        for (const indexer of enabled) {
          const invalid = invalidIndexerLimit(indexer);
          if (invalid) return badRequest(400, invalid);
        }

        const configService = getConfigService();
        if (enabled.length === 0 && allowEmpty !== true) {
          const savedStr = await configService.get('prowlarr_indexers');
          const saved = savedStr ? JSON.parse(savedStr) : [];
          if (Array.isArray(saved) && saved.length > 0) {
            return badRequest(
              409,
              `Refusing to remove all ${saved.length} saved indexer(s): the list sent was empty. Reload the indexers from Prowlarr and save again.`
            );
          }
        }

        // Convert to the persisted shape
        const enabledIndexers = enabled.map((indexer: IndexerConfigInput) => toSavedIndexerConfig(indexer));

        // Save to configuration (matches wizard format)
        const configUpdates = [
          {
            key: 'prowlarr_indexers',
            value: JSON.stringify(enabledIndexers),
            category: 'indexer',
            description: 'Prowlarr indexer settings (enabled, priority, seeding time, ratio limit)',
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
