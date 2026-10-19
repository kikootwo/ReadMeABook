/**
 * Audiobookshelf Settings API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { ConfigUpdate } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.Audiobookshelf');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const { serverUrl, apiToken, libraryId, triggerScanAfterImport, tagRequester } = body;

        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();

        // Detect a false→true transition of the requester-tagging setting so we
        // can backfill tags onto already-available requests one time.
        const previousTagRequester = (await configService.get('audiobookshelf.tag_requester')) === 'true';
        const newTagRequester = tagRequester === true;

        // Build updates array, skipping masked values
        const updates: ConfigUpdate[] = [
          { key: 'audiobookshelf.server_url', value: serverUrl || '' },
          { key: 'audiobookshelf.library_id', value: libraryId || '' },
          { key: 'audiobookshelf.trigger_scan_after_import', value: triggerScanAfterImport === true ? 'true' : 'false' },
          { key: 'audiobookshelf.tag_requester', value: newTagRequester ? 'true' : 'false' },
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

        // On a false→true toggle, enqueue a one-time backfill that tags existing
        // available audiobook requests with their requester's `req:<username>` tag.
        if (!previousTagRequester && newTagRequester) {
          try {
            const { getJobQueueService } = await import('@/lib/services/job-queue.service');
            await getJobQueueService().addBackfillRequesterTagsJob();
            logger.info('Enqueued requester-tag backfill job (setting toggled on)');
          } catch (error) {
            logger.error('Failed to enqueue requester-tag backfill job', { error: error instanceof Error ? error.message : String(error) });
          }
        }

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
