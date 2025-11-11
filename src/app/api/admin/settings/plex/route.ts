/**
 * Component: Admin Plex Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

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
    await prisma.config.upsert({
      where: { key: 'plex_url' },
      update: { value: url },
      create: { key: 'plex_url', value: url },
    });

    // Only update token if it's not the masked value
    if (!token.startsWith('••••')) {
      await prisma.config.upsert({
        where: { key: 'plex_token' },
        update: { value: token },
        create: { key: 'plex_token', value: token },
      });
    }

    await prisma.config.upsert({
      where: { key: 'plex_audiobook_library_id' },
      update: { value: libraryId },
      create: { key: 'plex_audiobook_library_id', value: libraryId },
    });

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
