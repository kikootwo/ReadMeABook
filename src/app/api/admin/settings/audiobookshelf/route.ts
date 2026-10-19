/**
 * Audiobookshelf Settings API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { ConfigUpdate } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { isMaskedSecret, resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedAudiobookshelfCredential } from '@/lib/services/saved-credentials.service';

const logger = RMABLogger.create('API.Admin.Settings.Audiobookshelf');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const { serverUrl, apiToken, libraryId, triggerScanAfterImport } = body;

        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();

        // A masked token keeps the saved one — only when the URL stays the saved URL (checked before saving)
        if (apiToken && isMaskedSecret(apiToken)) {
          const resolvedToken = await resolveSecretForUrl({
            kind: 'audiobookshelf',
            url: serverUrl,
            supplied: apiToken,
            loadSaved: savedAudiobookshelfCredential,
          });
          if (!resolvedToken.ok) {
            return NextResponse.json({ error: resolvedToken.error }, { status: 400 });
          }
        }

        // Build updates array, skipping masked values
        const updates: ConfigUpdate[] = [
          { key: 'audiobookshelf.server_url', value: serverUrl || '' },
          { key: 'audiobookshelf.library_id', value: libraryId || '' },
          { key: 'audiobookshelf.trigger_scan_after_import', value: triggerScanAfterImport === true ? 'true' : 'false' },
        ];

        // Only update API token if it's not the masked placeholder
        if (apiToken && !apiToken.startsWith('••••')) {
          updates.push({
            key: 'audiobookshelf.api_token',
            value: apiToken,
            encrypted: true,
          });
        }

        // Update configuration
        await configService.setMany(updates);

        return NextResponse.json({
          success: true,
          message: 'Audiobookshelf settings saved successfully'
        });
      } catch (error) {
        logger.error('Failed to save Audiobookshelf settings', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
    });
  });
}
