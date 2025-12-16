/**
 * Component: Admin Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Fetch all configuration
    const configs = await prisma.configuration.findMany();
    const configMap = new Map(configs.map((c) => [c.key, c.value]));

    // Mask sensitive values
    const maskValue = (key: string, value: string | null | undefined) => {
      const sensitiveKeys = ['token', 'api_key', 'password'];
      if (value && sensitiveKeys.some((k) => key.includes(k))) {
        return '••••••••••••';
      }
      return value || '';
    };

    // Build response object
    const settings = {
      backendMode: configMap.get('system.backend_mode') || 'plex',
      plex: {
        url: configMap.get('plex_url') || '',
        token: maskValue('token', configMap.get('plex_token')),
        libraryId: configMap.get('plex_audiobook_library_id') || '',
      },
      audiobookshelf: {
        serverUrl: configMap.get('audiobookshelf.server_url') || '',
        apiToken: maskValue('api_token', configMap.get('audiobookshelf.api_token')),
        libraryId: configMap.get('audiobookshelf.library_id') || '',
      },
      oidc: {
        enabled: configMap.get('oidc.enabled') === 'true',
        providerName: configMap.get('oidc.provider_name') || '',
        issuerUrl: configMap.get('oidc.issuer_url') || '',
        clientId: configMap.get('oidc.client_id') || '',
        clientSecret: maskValue('client_secret', configMap.get('oidc.client_secret')),
      },
      registration: {
        enabled: configMap.get('auth.registration_enabled') === 'true',
        requireAdminApproval: configMap.get('auth.require_admin_approval') === 'true',
      },
      prowlarr: {
        url: configMap.get('prowlarr_url') || '',
        apiKey: maskValue('api_key', configMap.get('prowlarr_api_key')),
      },
      downloadClient: {
        type: configMap.get('download_client_type') || 'qbittorrent',
        url: configMap.get('download_client_url') || '',
        username: configMap.get('download_client_username') || '',
        password: maskValue('password', configMap.get('download_client_password')),
        seedingTimeMinutes: parseInt(configMap.get('seeding_time_minutes') || '0'),
      },
      paths: {
        downloadDir: configMap.get('download_dir') || '/downloads',
        mediaDir: configMap.get('media_dir') || '/media/audiobooks',
        metadataTaggingEnabled: configMap.get('metadata_tagging_enabled') === 'true',
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
        console.error('[Admin] Failed to fetch settings:', error);
        return NextResponse.json(
          { error: 'Failed to fetch settings' },
          { status: 500 }
        );
      }
    });
  });
}
