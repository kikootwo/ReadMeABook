/**
 * Component: Test Download Client Connection API
 * Documentation: documentation/phase3/download-clients.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { getDownloadClientManager, DownloadClientConfig } from '@/lib/services/download-client-manager.service';
import { SUPPORTED_CLIENT_TYPES } from '@/lib/interfaces/download-client.interface';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedClientCredential } from '@/lib/services/saved-credentials.service';

const logger = RMABLogger.create('API.Admin.Settings.DownloadClients.Test');

/**
 * POST - Test download client connection
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const {
          clientId, // Optional: existing client ID to use stored password
          type,
          name: clientName,
          url,
          username,
          password,
          disableSSLVerify,
          remotePathMappingEnabled,
          remotePath,
          localPath,
        } = body;

        // Validate type
        if (!SUPPORTED_CLIENT_TYPES.includes(type)) {
          return NextResponse.json(
            { error: `Invalid client type. Must be one of: ${SUPPORTED_CLIENT_TYPES.join(', ')}` },
            { status: 400 }
          );
        }

        const config = await getConfigService();
        const manager = getDownloadClientManager(config);

        // URL is always required; password/API key only required for SABnzbd
        // qBittorrent supports IP whitelist auth (no credentials needed)
        if (!url) {
          return NextResponse.json(
            { error: 'URL is required' },
            { status: 400 }
          );
        }

        // If editing an existing client and password not provided, use stored password
        let effectivePassword = password;
        let effectiveUsername = username;

        if (clientId && !password) {
          const existingClients = await manager.getAllClients();
          const existingClient = existingClients.find(c => c.id === clientId);

          if (!existingClient) {
            return NextResponse.json(
              { error: 'Client not found' },
              { status: 404 }
            );
          }

          // Saved secret is only reused for the client's saved URL
          const resolved = await resolveSecretForUrl({
            kind: 'downloadClient',
            url,
            supplied: '',
            emptyMeansSaved: Boolean(existingClient.password),
            loadSaved: () => savedClientCredential(existingClient),
          });
          if (!resolved.ok) {
            return NextResponse.json({ error: resolved.error }, { status: 400 });
          }

          effectivePassword = resolved.secret;
          // Also use stored username if not provided (for qBittorrent)
          if (!username && existingClient.username) {
            effectiveUsername = existingClient.username;
          }
        }

        if (type === 'sabnzbd' && !effectivePassword) {
          return NextResponse.json(
            { error: 'API key is required for SABnzbd' },
            { status: 400 }
          );
        }

        // Create temporary client config for testing
        // qBittorrent credentials are optional (supports IP whitelist auth)
        const testConfig: DownloadClientConfig = {
          id: 'test',
          type,
          name: clientName || type,
          enabled: true,
          url,
          username: effectiveUsername || '',
          password: effectivePassword || '',
          disableSSLVerify: disableSSLVerify || false,
          remotePathMappingEnabled: remotePathMappingEnabled || false,
          remotePath: remotePath || undefined,
          localPath: localPath || undefined,
          category: 'readmeabook',
        };

        const result = await manager.testConnection(testConfig);

        if (result.success) {
          return NextResponse.json({
            success: true,
            message: result.message,
          });
        } else {
          return NextResponse.json(
            {
              success: false,
              error: result.message,
            },
            { status: 400 }
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Connection test failed', { error: message });
        return NextResponse.json(
          {
            success: false,
            error: message,
          },
          { status: 400 }
        );
      }
    });
  });
}
