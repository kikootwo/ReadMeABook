/**
 * Component: Admin Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings');

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Fetch all configuration
    const configs = await prisma.configuration.findMany();
    const configMap = new Map(configs.map((c) => [c.key, c.value]));

    // Check if any local users exist (for validation)
    const hasLocalUsers = (await prisma.user.count({
      where: { authProvider: 'local' }
    })) > 0;

    // Check if any local admin users exist (for validation)
    const hasLocalAdmins = (await prisma.user.count({
      where: {
        authProvider: 'local',
        role: 'admin'
      }
    })) > 0;

    // Mask sensitive values
    const maskValue = (key: string, value: string | null | undefined) => {
      const sensitiveKeys = ['token', 'api_key', 'password', 'secret'];
      if (value && sensitiveKeys.some((k) => key.includes(k))) {
        return '••••••••••••';
      }
      return value || '';
    };

    // Build response object
    const settings = {
      backendMode: configMap.get('system.backend_mode') || 'plex',
      hasLocalUsers,
      hasLocalAdmins,
      audibleRegion: configMap.get('audible.region') || 'us',
      plex: {
        url: configMap.get('plex_url') || '',
        token: maskValue('token', configMap.get('plex_token')),
        libraryId: configMap.get('plex_audiobook_library_id') || '',
        triggerScanAfterImport: configMap.get('plex.trigger_scan_after_import') === 'true',
      },
      audiobookshelf: {
        serverUrl: configMap.get('audiobookshelf.server_url') || '',
        apiToken: maskValue('api_token', configMap.get('audiobookshelf.api_token')),
        libraryId: configMap.get('audiobookshelf.library_id') || '',
        triggerScanAfterImport: configMap.get('audiobookshelf.trigger_scan_after_import') === 'true',
      },
      oidc: {
        enabled: configMap.get('oidc.enabled') === 'true',
        providerName: configMap.get('oidc.provider_name') || '',
        issuerUrl: configMap.get('oidc.issuer_url') || '',
        clientId: configMap.get('oidc.client_id') || '',
        clientSecret: maskValue('client_secret', configMap.get('oidc.client_secret')),
        accessControlMethod: configMap.get('oidc.access_control_method') || 'open',
        accessGroupClaim: configMap.get('oidc.access_group_claim') || 'groups',
        accessGroupValue: configMap.get('oidc.access_group_value') || '',
        allowedEmails: configMap.get('oidc.allowed_emails') || '[]',
        allowedUsernames: configMap.get('oidc.allowed_usernames') || '[]',
        adminClaimEnabled: configMap.get('oidc.admin_claim_enabled') === 'true',
        adminClaimName: configMap.get('oidc.admin_claim_name') || 'groups',
        adminClaimValue: configMap.get('oidc.admin_claim_value') || '',
      },
      registration: {
        enabled: configMap.get('auth.registration_enabled') === 'true',
        requireAdminApproval: configMap.get('auth.require_admin_approval') === 'true',
      },
      prowlarr: {
        url: configMap.get('prowlarr_url') || '',
        apiKey: maskValue('api_key', configMap.get('prowlarr_api_key')),
      },
      // downloadClient is populated from multi-client format for backward compatibility
      // The DownloadTab component now uses DownloadClientManagement which reads from /api/admin/settings/download-clients
      downloadClient: (() => {
        // Try to read from new multi-client format first
        const downloadClientsJson = configMap.get('download_clients');
        if (downloadClientsJson) {
          try {
            const clients = JSON.parse(downloadClientsJson);
            // Return the first enabled client for backward compatibility
            const firstClient = clients.find((c: any) => c.enabled) || clients[0];
            if (firstClient) {
              return {
                type: firstClient.type || 'qbittorrent',
                url: firstClient.url || '',
                username: firstClient.username || '',
                password: maskValue('password', firstClient.password),
                disableSSLVerify: firstClient.disableSSLVerify === true,
                seedingTimeMinutes: parseInt(configMap.get('seeding_time_minutes') || '0'),
                remotePathMappingEnabled: firstClient.remotePathMappingEnabled === true,
                remotePath: firstClient.remotePath || '',
                localPath: firstClient.localPath || '',
              };
            }
          } catch {
            // Fall through to legacy format
          }
        }
        // Fall back to legacy flat keys
        return {
          type: configMap.get('download_client_type') || 'qbittorrent',
          url: configMap.get('download_client_url') || '',
          username: configMap.get('download_client_username') || '',
          password: maskValue('password', configMap.get('download_client_password')),
          disableSSLVerify: configMap.get('download_client_disable_ssl_verify') === 'true',
          seedingTimeMinutes: parseInt(configMap.get('seeding_time_minutes') || '0'),
          remotePathMappingEnabled: configMap.get('download_client_remote_path_mapping_enabled') === 'true',
          remotePath: configMap.get('download_client_remote_path') || '',
          localPath: configMap.get('download_client_local_path') || '',
        };
      })(),
      paths: {
        downloadDir: configMap.get('download_dir') || '/downloads',
        mediaDir: configMap.get('media_dir') || '/media/audiobooks',
        audiobookPathTemplate: configMap.get('audiobook_path_template') || '{author}/{title} {asin}',
        metadataTaggingEnabled: configMap.get('metadata_tagging_enabled') === 'true',
        chapterMergingEnabled: configMap.get('chapter_merging_enabled') === 'true',
      },
      ebook: {
        // New granular source toggles (with migration from legacy ebook_sidecar_enabled)
        annasArchiveEnabled: configMap.get('ebook_annas_archive_enabled') === 'true' ||
          // Migration: if old key is true and new key doesn't exist, use old value
          (configMap.get('ebook_annas_archive_enabled') === undefined && configMap.get('ebook_sidecar_enabled') === 'true'),
        indexerSearchEnabled: configMap.get('ebook_indexer_search_enabled') === 'true',
        // Anna's Archive specific settings
        baseUrl: configMap.get('ebook_sidecar_base_url') || 'https://annas-archive.li',
        flaresolverrUrl: configMap.get('ebook_sidecar_flaresolverr_url') || '',
        // General settings
        preferredFormat: configMap.get('ebook_sidecar_preferred_format') || 'epub',
      },
      general: {
        appName: configMap.get('app_name') || 'ReadMeABook',
        allowRegistrations: configMap.get('allow_registrations') === 'true',
        maxConcurrentDownloads: parseInt(
          configMap.get('max_concurrent_downloads') || '3'
        ),
        autoApproveRequests: configMap.get('auto_approve_requests') === 'true',
      },
    };

    return NextResponse.json(settings);
      } catch (error) {
        logger.error('Failed to fetch settings', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to fetch settings' },
          { status: 500 }
        );
      }
    });
  });
}
