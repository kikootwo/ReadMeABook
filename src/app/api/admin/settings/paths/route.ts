/**
 * Component: Admin Paths Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.Paths');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { downloadDir, mediaDir, audiobookPathTemplate, ebookPathTemplate, metadataTaggingEnabled, chapterMergingEnabled, fileRenameEnabled, fileRenameTemplate } = await request.json();

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

        // Update audiobook path template
        if (audiobookPathTemplate !== undefined) {
          await prisma.configuration.upsert({
            where: { key: 'audiobook_path_template' },
            update: { value: audiobookPathTemplate },
            create: {
              key: 'audiobook_path_template',
              value: audiobookPathTemplate,
              category: 'automation',
              description: 'Template for organizing audiobook files in media directory',
            },
          });
        }

        // Update ebook path template
        if (ebookPathTemplate !== undefined) {
          await prisma.configuration.upsert({
            where: { key: 'ebook_path_template' },
            update: { value: ebookPathTemplate },
            create: {
              key: 'ebook_path_template',
              value: ebookPathTemplate,
              category: 'automation',
              description: 'Template for organizing ebook files in media directory',
            },
          });
        }

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

        // Update chapter merging setting
        await prisma.configuration.upsert({
          where: { key: 'chapter_merging_enabled' },
          update: { value: String(chapterMergingEnabled ?? false) },
          create: {
            key: 'chapter_merging_enabled',
            value: String(chapterMergingEnabled ?? false),
            category: 'automation',
            description: 'Automatically merge multi-file chapter downloads into single M4B with chapter markers',
          },
        });

        // Update file rename setting
        await prisma.configuration.upsert({
          where: { key: 'file_rename_enabled' },
          update: { value: String(fileRenameEnabled ?? false) },
          create: {
            key: 'file_rename_enabled',
            value: String(fileRenameEnabled ?? false),
            category: 'automation',
            description: 'Rename audio and ebook files using a custom naming template during organization',
          },
        });

        // Update file rename template
        if (fileRenameTemplate !== undefined) {
          await prisma.configuration.upsert({
            where: { key: 'file_rename_template' },
            update: { value: fileRenameTemplate },
            create: {
              key: 'file_rename_template',
              value: fileRenameTemplate,
              category: 'automation',
              description: 'Template for renaming audio and ebook files during organization',
            },
          });
        }

        logger.info('Paths settings updated');

        // Clear config cache for all updated keys so services get fresh values
        const configService = getConfigService();
        configService.clearCache('download_dir');
        configService.clearCache('media_dir');
        configService.clearCache('audiobook_path_template');
        configService.clearCache('ebook_path_template');
        configService.clearCache('metadata_tagging_enabled');
        configService.clearCache('chapter_merging_enabled');
        configService.clearCache('file_rename_enabled');
        configService.clearCache('file_rename_template');

        // Invalidate all download client singletons to force reload of download_dir
        const { invalidateDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
        invalidateDownloadClientManager();
        const { invalidateQBittorrentService } = await import('@/lib/integrations/qbittorrent.service');
        invalidateQBittorrentService();
        const { invalidateSABnzbdService } = await import('@/lib/integrations/sabnzbd.service');
        invalidateSABnzbdService();
        const { invalidateNZBGetService } = await import('@/lib/integrations/nzbget.service');
        invalidateNZBGetService();
        const { invalidateTransmissionService } = await import('@/lib/integrations/transmission.service');
        invalidateTransmissionService();

        return NextResponse.json({
          success: true,
          message: 'Paths settings updated successfully',
        });
      } catch (error) {
        logger.error('Failed to update paths settings', { error: error instanceof Error ? error.message : String(error) });
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
