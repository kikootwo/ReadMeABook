/**
 * AudioSilo Settings API
 * Documentation: documentation/features/audiosilo-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { ConfigUpdate } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedAudioSiloCredential } from '@/lib/services/saved-credentials.service';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.Settings.AudioSilo');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const { serverUrl, apiToken, libraryId, triggerScanAfterImport } = bodyResult.data;

        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();

        // Clearing both fields disconnects AudioSilo (URL and key removed together)
        const disconnect = !serverUrl && !apiToken;

        // A masked, empty or omitted key keeps the saved one, only when the URL stays the saved URL
        const resolvedToken = disconnect
          ? { ok: true as const, secret: '', reusedSaved: false }
          : await resolveSecretForUrl({
              kind: 'audiosilo',
              url: serverUrl,
              supplied: apiToken,
              emptyMeansSaved: true,
              optional: true,
              loadSaved: savedAudioSiloCredential,
            });
        if (!resolvedToken.ok) {
          return NextResponse.json({ error: resolvedToken.error }, { status: 400 });
        }

        const updates: ConfigUpdate[] = [
          { key: 'audiosilo.server_url', value: serverUrl || '' },
          { key: 'audiosilo.library_id', value: libraryId || '' },
          { key: 'audiosilo.trigger_scan_after_import', value: triggerScanAfterImport === true ? 'true' : 'false' },
        ];

        // Write the key only when a new one was entered, or when disconnecting
        if (disconnect || (!resolvedToken.reusedSaved && resolvedToken.secret !== '')) {
          updates.push({ key: 'audiosilo.api_token', value: resolvedToken.secret, encrypted: true });
        }

        await configService.setMany(updates);

        return NextResponse.json({ success: true, message: 'AudioSilo settings saved successfully' });
      } catch (error) {
        logger.error('Failed to save AudioSilo settings', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
      }
    });
  });
}
