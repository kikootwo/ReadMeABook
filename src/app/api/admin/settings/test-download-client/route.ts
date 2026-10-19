/**
 * Component: Admin Settings Test Download Client API (DEPRECATED)
 * Documentation: documentation/settings-pages.md
 *
 * DEPRECATED: Use /api/admin/settings/download-clients/test instead.
 * Maintained for backward compatibility.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { getDownloadClientManager, DownloadClientConfig } from '@/lib/services/download-client-manager.service';
import { SUPPORTED_CLIENT_TYPES } from '@/lib/interfaces/download-client.interface';
import { RMABLogger } from '@/lib/utils/logger';
import { isSameServiceUrl, resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedClientCredential } from '@/lib/services/saved-credentials.service';

const logger = RMABLogger.create('API.TestDownloadClient');

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const {
          type,
          name: clientName,
          url,
          username,
          password,
          disableSSLVerify,
          remotePathMappingEnabled,
          remotePath,
          localPath,
        } = await request.json();

        logger.debug('Received request', { type, url, hasUsername: !!username, hasPassword: !!password });

        if (!type || !url) {
          return NextResponse.json(
            { success: false, error: 'Type and URL are required' },
            { status: 400 }
          );
        }

        if (!SUPPORTED_CLIENT_TYPES.includes(type)) {
          return NextResponse.json(
            { success: false, error: `Invalid client type. Must be one of: ${SUPPORTED_CLIENT_TYPES.join(', ')}` },
            { status: 400 }
          );
        }

        // A masked password reuses a saved one — from the client of this type saved at this URL
        const resolved = await resolveSecretForUrl({
          kind: 'downloadClient',
          url,
          supplied: password,
          acceptPasswordMask: true,
          missingMessage: 'No stored password/API key found. Please re-enter it.',
          loadSaved: async () => {
            const manager = getDownloadClientManager(getConfigService());
            const sameType = (await manager.getAllClients()).filter((c) => c.type === type && c.password);
            const atThisUrl = sameType.find((c) => isSameServiceUrl(url, c.url));
            // No client at this URL: report the first saved one so the URL mismatch is explained
            return savedClientCredential(atThisUrl ?? sameType[0]);
          },
        });
        if (!resolved.ok) {
          return NextResponse.json({ success: false, error: resolved.error }, { status: 400 });
        }
        const actualPassword = resolved.secret;

        // Build a temporary config for testing
        const testConfig: DownloadClientConfig = {
          id: 'legacy-test',
          type,
          name: clientName || type,
          enabled: true,
          url,
          username: username || '',
          password: actualPassword || '',
          disableSSLVerify: disableSSLVerify || false,
          remotePathMappingEnabled: remotePathMappingEnabled || false,
          remotePath: remotePath || undefined,
          localPath: localPath || undefined,
          category: 'readmeabook',
        };

        const configService = getConfigService();
        const manager = getDownloadClientManager(configService);
        const result = await manager.testConnection(testConfig);

        // If path mapping enabled, validate local path exists
        if (result.success && remotePathMappingEnabled) {
          if (!remotePath || !localPath) {
            return NextResponse.json(
              {
                success: false,
                error: 'Remote path and local path are required when path mapping is enabled',
              },
              { status: 400 }
            );
          }

          // Check if local path is accessible
          const fs = await import('fs/promises');
          try {
            await fs.access(localPath, fs.constants.R_OK);
          } catch (accessError) {
            return NextResponse.json(
              {
                success: false,
                error: `Local path "${localPath}" is not accessible. Please verify the path exists and has correct permissions.`,
              },
              { status: 400 }
            );
          }
        }

        if (result.success) {
          return NextResponse.json({ success: true, message: result.message });
        }

        return NextResponse.json(
          { success: false, error: result.message },
          { status: 400 }
        );
      } catch (error) {
        logger.error('Download client test failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to connect to download client',
          },
          { status: 500 }
        );
      }
    });
  });
}
