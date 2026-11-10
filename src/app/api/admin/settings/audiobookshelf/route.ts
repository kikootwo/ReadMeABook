/**
 * Audiobookshelf Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { ConfigUpdate } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedAudiobookshelfCredential } from '@/lib/services/saved-credentials.service';
import { readJsonBody } from '@/lib/utils/request-body';
import { REQUESTER_TAG_SETTING_KEY } from '@/lib/constants/requester-tags';
import { EXPLICIT_MARK_SETTING_KEY } from '@/lib/constants/explicit-mark';

const logger = RMABLogger.create('API.Admin.Settings.Audiobookshelf');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const body = bodyResult.data;
        const { serverUrl, apiToken, libraryId, ebookLibraryId, triggerScanAfterImport, tagRequester, explicitMarkEnabled } = body;

        // Ebook library: a string ('' clears it); omitted keeps the saved value
        if (ebookLibraryId !== undefined && typeof ebookLibraryId !== 'string') {
          return NextResponse.json({ error: 'ebookLibraryId must be a string' }, { status: 400 });
        }

        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();

        // Clearing both fields disconnects Audiobookshelf (URL and token removed together)
        const disconnect = !serverUrl && !apiToken;

        // A masked, empty or omitted token keeps the saved one — only when the URL stays the saved URL
        const resolvedToken = disconnect
          ? { ok: true as const, secret: '', reusedSaved: false }
          : await resolveSecretForUrl({
              kind: 'audiobookshelf',
              url: serverUrl,
              supplied: apiToken,
              emptyMeansSaved: true,
              optional: true,
              loadSaved: savedAudiobookshelfCredential,
            });
        if (!resolvedToken.ok) {
          return NextResponse.json({ error: resolvedToken.error }, { status: 400 });
        }

        const updates: ConfigUpdate[] = [
          { key: 'audiobookshelf.server_url', value: serverUrl || '' },
          { key: 'audiobookshelf.library_id', value: libraryId || '' },
          { key: 'audiobookshelf.trigger_scan_after_import', value: triggerScanAfterImport === true ? 'true' : 'false' },
        ];

        if (typeof ebookLibraryId === 'string') {
          updates.push({ key: 'audiobookshelf.ebook_library_id', value: ebookLibraryId.trim() });
        }

        // Write the token only when a new one was entered, or when disconnecting
        if (disconnect || (!resolvedToken.reusedSaved && resolvedToken.secret !== '')) {
          updates.push({
            key: 'audiobookshelf.api_token',
            value: resolvedToken.secret,
            encrypted: true,
          });
        }

        // Requester tags (#232): written only when sent as a boolean; a saved off → on change
        // queues the backfill once
        let startBackfill = false;
        if (typeof tagRequester === 'boolean') {
          const wasOn = (await configService.get(REQUESTER_TAG_SETTING_KEY)) === 'true';
          startBackfill = tagRequester && !wasOn;
          updates.push({ key: REQUESTER_TAG_SETTING_KEY, value: tagRequester ? 'true' : 'false' });
        }

        // Explicit mark (#542, off by default): written only when sent as a boolean
        if (typeof explicitMarkEnabled === 'boolean') {
          updates.push({ key: EXPLICIT_MARK_SETTING_KEY, value: explicitMarkEnabled ? 'true' : 'false' });
        }

        // Update configuration
        await configService.setMany(updates);

        if (startBackfill) {
          try {
            const { getJobQueueService } = await import('@/lib/services/job-queue.service');
            await getJobQueueService().addBackfillRequesterTagsJob();
          } catch (error) {
            logger.error('Failed to queue the requester tag backfill', { error: error instanceof Error ? error.message : String(error) });
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
