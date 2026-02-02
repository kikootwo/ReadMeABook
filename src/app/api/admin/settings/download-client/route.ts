/**
 * Component: Admin Download Client Settings API (DEPRECATED)
 * Documentation: documentation/phase3/download-clients.md
 *
 * DEPRECATED: This route is deprecated in favor of /api/admin/settings/download-clients
 * which supports multiple download clients. This route is maintained for backward
 * compatibility but updates are written to the new multi-client format.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { getDownloadClientManager, invalidateDownloadClientManager, DownloadClientConfig } from '@/lib/services/download-client-manager.service';
import { PathMapper } from '@/lib/utils/path-mapper';
import { RMABLogger } from '@/lib/utils/logger';
import { randomUUID } from 'crypto';

const logger = RMABLogger.create('API.Admin.Settings.DownloadClient');

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const {
          type,
          url,
          username,
          password,
          disableSSLVerify,
          remotePathMappingEnabled,
          remotePath,
          localPath,
        } = await request.json();

        logger.warn('DEPRECATED: Using legacy single-client API. Please use /api/admin/settings/download-clients instead.');

        // Validate type
        if (type !== 'qbittorrent' && type !== 'sabnzbd') {
          return NextResponse.json(
            { error: 'Invalid client type. Must be qbittorrent or sabnzbd' },
            { status: 400 }
          );
        }

        // Validate required fields (SABnzbd only needs URL and API key)
        if (type === 'sabnzbd') {
          if (!url || !password) {
            return NextResponse.json(
              { error: 'URL and API key (password) are required for SABnzbd' },
              { status: 400 }
            );
          }
        } else if (type === 'qbittorrent') {
          if (!url || !username || !password) {
            return NextResponse.json(
              { error: 'URL, username, and password are required for qBittorrent' },
              { status: 400 }
            );
          }
        }

        // Validate path mapping if enabled
        if (remotePathMappingEnabled) {
          if (!remotePath || !localPath) {
            return NextResponse.json(
              { error: 'Remote path and local path are required when path mapping is enabled' },
              { status: 400 }
            );
          }

          try {
            PathMapper.validate({
              enabled: true,
              remotePath,
              localPath,
            });
          } catch (validationError) {
            return NextResponse.json(
              {
                error: validationError instanceof Error
                  ? validationError.message
                  : 'Invalid path mapping configuration',
              },
              { status: 400 }
            );
          }
        }

        // Get existing clients from new format
        const config = await getConfigService();
        const manager = getDownloadClientManager(config);
        const existingClients = await manager.getAllClients();

        // Find existing client of same type to update, or create new
        const existingIndex = existingClients.findIndex(c => c.type === type);

        const updatedClient: DownloadClientConfig = {
          id: existingIndex >= 0 ? existingClients[existingIndex].id : randomUUID(),
          type,
          name: type === 'qbittorrent' ? 'qBittorrent' : 'SABnzbd',
          enabled: true,
          url,
          username: username || undefined,
          // Only update password if it's not the masked value
          password: password.startsWith('••••') && existingIndex >= 0
            ? existingClients[existingIndex].password
            : password,
          disableSSLVerify: disableSSLVerify || false,
          remotePathMappingEnabled: remotePathMappingEnabled || false,
          remotePath: remotePath || undefined,
          localPath: localPath || undefined,
          category: existingIndex >= 0 ? existingClients[existingIndex].category : 'readmeabook',
        };

        // Update or add client
        let updatedClients: DownloadClientConfig[];
        if (existingIndex >= 0) {
          updatedClients = [...existingClients];
          updatedClients[existingIndex] = updatedClient;
        } else {
          updatedClients = [...existingClients, updatedClient];
        }

        // Save to new format
        await config.setMany([
          { key: 'download_clients', value: JSON.stringify(updatedClients) },
        ]);

        logger.info('Download client settings updated via legacy API', { type, id: updatedClient.id });

        // Invalidate caches
        invalidateDownloadClientManager();

        if (type === 'qbittorrent') {
          const { invalidateQBittorrentService } = await import('@/lib/integrations/qbittorrent.service');
          invalidateQBittorrentService();
        } else if (type === 'sabnzbd') {
          const { invalidateSABnzbdService } = await import('@/lib/integrations/sabnzbd.service');
          invalidateSABnzbdService();
        }

        return NextResponse.json({
          success: true,
          message: 'Download client settings updated successfully',
          deprecated: true,
          warning: 'This API is deprecated. Please use /api/admin/settings/download-clients instead.',
        });
      } catch (error) {
        logger.error('Failed to update download client settings', { error: error instanceof Error ? error.message : String(error) });
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
