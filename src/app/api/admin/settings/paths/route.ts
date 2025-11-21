/**
 * Component: Admin Paths Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { downloadDir, mediaDir, metadataTaggingEnabled } = await request.json();

        if (!downloadDir || !mediaDir) {
          return NextResponse.json(
            { error: 'Download directory and media directory are required' },
            { status: 400 }
          );
        }

        // Validate paths are not the same
        if (downloadDir === mediaDir) {
          return NextResponse.json(
            { error: 'Download and media directories must be different' },
            { status: 400 }
          );
        }

        // Update configuration
        await prisma.configuration.upsert({
          where: { key: 'download_dir' },
          update: { value: downloadDir },
          create: { key: 'download_dir', value: downloadDir },
        });

        await prisma.configuration.upsert({
          where: { key: 'media_dir' },
          update: { value: mediaDir },
          create: { key: 'media_dir', value: mediaDir },
        });

        // Update metadata tagging setting
        await prisma.configuration.upsert({
          where: { key: 'metadata_tagging_enabled' },
          update: { value: String(metadataTaggingEnabled ?? true) },
          create: {
            key: 'metadata_tagging_enabled',
            value: String(metadataTaggingEnabled ?? true),
            category: 'automation',
            description: 'Automatically tag audio files with correct metadata during file organization',
          },
        });

        console.log('[Admin] Paths settings updated');

        return NextResponse.json({
          success: true,
          message: 'Paths settings updated successfully',
        });
      } catch (error) {
        console.error('[Admin] Failed to update paths settings:', error);
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
