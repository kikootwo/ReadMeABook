/**
 * Component: Admin Prowlarr Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { getConfigService } from '@/lib/services/config.service';
import { invalidateProwlarrService } from '@/lib/integrations/prowlarr.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedProwlarrCredential } from '@/lib/services/saved-credentials.service';

const logger = RMABLogger.create('API.Admin.Settings.Prowlarr');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { url, apiKey } = await request.json();

        if (!url || !apiKey) {
          return NextResponse.json(
            { error: 'URL and API key are required' },
            { status: 400 }
          );
        }
        if (typeof url !== 'string' || typeof apiKey !== 'string') {
          return NextResponse.json({ error: 'URL and API key must be text' }, { status: 400 });
        }

        // A masked key keeps the saved one — only when the URL stays the saved URL (checked before saving)
        const resolvedKey = await resolveSecretForUrl({
          kind: 'prowlarr',
          url,
          supplied: apiKey,
          missingMessage: 'No stored API key found. Please re-enter your Prowlarr API key.',
          loadSaved: savedProwlarrCredential,
        });
        if (!resolvedKey.ok) {
          return NextResponse.json({ error: resolvedKey.error }, { status: 400 });
        }

        // Encrypt first, so a failure can't leave the saved key paired with a new URL
        const encryptedApiKey = resolvedKey.reusedSaved ? null : getEncryptionService().encrypt(resolvedKey.secret);

        // Update configuration
        await prisma.configuration.upsert({
          where: { key: 'prowlarr_url' },
          update: { value: url },
          create: { key: 'prowlarr_url', value: url },
        });

        // Only update API key if a new one was entered
        if (encryptedApiKey) {
          await prisma.configuration.upsert({
            where: { key: 'prowlarr_api_key' },
            update: { value: encryptedApiKey, encrypted: true },
            create: { key: 'prowlarr_api_key', value: encryptedApiKey, encrypted: true },
          });
        }

        // Written straight to the DB: drop cached values so the next read (and re-save) sees them
        const configCache = getConfigService();
        configCache.clearCache('prowlarr_url');
        configCache.clearCache('prowlarr_api_key');

        // Invalidate cached singleton so background jobs use new credentials
        invalidateProwlarrService();

        logger.info('Prowlarr settings updated');

        return NextResponse.json({
          success: true,
          message: 'Prowlarr settings updated successfully',
        });
      } catch (error) {
        logger.error('Failed to update Prowlarr settings', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update settings',
          },
          { status: 500 }
        );
      }
    });
  });
}
