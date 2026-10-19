/**
 * Component: Admin Plex Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getPlexService } from '@/lib/integrations/plex.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedPlexCredential } from '@/lib/services/saved-credentials.service';

const logger = RMABLogger.create('API.AdminPlexSettings');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { url, token, libraryId, triggerScanAfterImport } = await request.json();

    if (!url || !token || !libraryId) {
      return NextResponse.json(
        { error: 'URL, token, and library ID are required' },
        { status: 400 }
      );
    }

    // A masked token keeps the saved one — only when the URL stays the saved URL (checked before saving)
    const resolvedToken = await resolveSecretForUrl({
      kind: 'plex',
      url,
      supplied: token,
      missingMessage: 'No stored token found. Please re-enter your Plex token.',
      loadSaved: savedPlexCredential,
    });
    if (!resolvedToken.ok) {
      return NextResponse.json({ error: resolvedToken.error }, { status: 400 });
    }

    // Update configuration
    await prisma.configuration.upsert({
      where: { key: 'plex_url' },
      update: { value: url },
      create: { key: 'plex_url', value: url },
    });

    // Only update token if a new one was entered
    if (!resolvedToken.reusedSaved) {
      const encryptionService = getEncryptionService();
      const encryptedToken = encryptionService.encrypt(token);
      await prisma.configuration.upsert({
        where: { key: 'plex_token' },
        update: { value: encryptedToken, encrypted: true },
        create: { key: 'plex_token', value: encryptedToken, encrypted: true },
      });
    }

    await prisma.configuration.upsert({
      where: { key: 'plex_audiobook_library_id' },
      update: { value: libraryId },
      create: { key: 'plex_audiobook_library_id', value: libraryId },
    });

    // Save trigger_scan_after_import setting
    await prisma.configuration.upsert({
      where: { key: 'plex.trigger_scan_after_import' },
      update: { value: triggerScanAfterImport === true ? 'true' : 'false' },
      create: { key: 'plex.trigger_scan_after_import', value: triggerScanAfterImport === true ? 'true' : 'false' },
    });

    // Fetch and save machine identifier (for server-specific access tokens)
    // This is needed for BookDate per-user rating functionality
    try {
      const plexService = getPlexService();
      const tokenToUse = resolvedToken.secret;

      if (tokenToUse) {
        const serverInfo = await plexService.testConnection(url, tokenToUse);
        if (serverInfo.success && serverInfo.info?.machineIdentifier) {
          await prisma.configuration.upsert({
            where: { key: 'plex_machine_identifier' },
            update: { value: serverInfo.info.machineIdentifier },
            create: { key: 'plex_machine_identifier', value: serverInfo.info.machineIdentifier },
          });
          logger.info('machineIdentifier updated', { machineIdentifier: serverInfo.info.machineIdentifier });
        } else {
          logger.warn('Could not fetch machineIdentifier');
        }
      }
    } catch (error) {
      logger.error('Error fetching machineIdentifier', { error: error instanceof Error ? error.message : String(error) });
      // Don't fail the request if machineIdentifier fetch fails
    }

    logger.info('Plex settings updated');

    return NextResponse.json({
      success: true,
      message: 'Plex settings updated successfully',
    });
      } catch (error) {
        logger.error('Failed to update Plex settings', { error: error instanceof Error ? error.message : String(error) });
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
