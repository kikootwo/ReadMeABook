/**
 * Component: Admin Plex Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getPlexService } from '@/lib/integrations/plex.service';

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { url, token, libraryId } = await request.json();

    if (!url || !token || !libraryId) {
      return NextResponse.json(
        { error: 'URL, token, and library ID are required' },
        { status: 400 }
      );
    }

    // Update configuration
    await prisma.configuration.upsert({
      where: { key: 'plex_url' },
      update: { value: url },
      create: { key: 'plex_url', value: url },
    });

    // Only update token if it's not the masked value
    if (!token.startsWith('••••')) {
      await prisma.configuration.upsert({
        where: { key: 'plex_token' },
        update: { value: token },
        create: { key: 'plex_token', value: token },
      });
    }

    await prisma.configuration.upsert({
      where: { key: 'plex_audiobook_library_id' },
      update: { value: libraryId },
      create: { key: 'plex_audiobook_library_id', value: libraryId },
    });

    // Fetch and save machine identifier (for server-specific access tokens)
    // This is needed for BookDate per-user rating functionality
    try {
      const plexService = getPlexService();
      const actualToken = token.startsWith('••••') ? null : token;

      // Get token from DB if it was masked
      const tokenToUse = actualToken || (await prisma.configuration.findUnique({
        where: { key: 'plex_token' },
      }))?.value;

      if (tokenToUse) {
        const serverInfo = await plexService.testConnection(url, tokenToUse);
        if (serverInfo.success && serverInfo.info?.machineIdentifier) {
          await prisma.configuration.upsert({
            where: { key: 'plex_machine_identifier' },
            update: { value: serverInfo.info.machineIdentifier },
            create: { key: 'plex_machine_identifier', value: serverInfo.info.machineIdentifier },
          });
          console.log('[Admin] machineIdentifier updated:', serverInfo.info.machineIdentifier);
        } else {
          console.warn('[Admin] Could not fetch machineIdentifier');
        }
      }
    } catch (error) {
      console.error('[Admin] Error fetching machineIdentifier:', error);
      // Don't fail the request if machineIdentifier fetch fails
    }

    console.log('[Admin] Plex settings updated');

    return NextResponse.json({
      success: true,
      message: 'Plex settings updated successfully',
    });
      } catch (error) {
        console.error('[Admin] Failed to update Plex settings:', error);
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
