/**
 * Component: Fetch Download Client Categories API
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

const logger = RMABLogger.create('API.Admin.Settings.DownloadClients.Categories');

/**
 * POST - Fetch categories from a download client
 * Accepts same connection config as the test endpoint
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const {
          clientId,
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

        if (!SUPPORTED_CLIENT_TYPES.includes(type)) {
          return NextResponse.json(
            { error: `Invalid client type. Must be one of: ${SUPPORTED_CLIENT_TYPES.join(', ')}` },
            { status: 400 }
          );
        }

        if (!url) {
          return NextResponse.json(
            { error: 'URL is required' },
            { status: 400 }
          );
        }

        const config = await getConfigService();
        const manager = getDownloadClientManager(config);

        // If editing and password not provided, use stored password
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
          if (!username && existingClient.username) {
            effectiveUsername = existingClient.username;
          }
        }

        const testConfig: DownloadClientConfig = {
          id: 'categories-fetch',
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

        const service = await manager.createClientFromConfig(testConfig);
        const categories = await service.getCategories();

        return NextResponse.json({ success: true, categories });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to fetch categories', { error: message });
        return NextResponse.json(
          { success: false, error: message },
          { status: 400 }
        );
      }
    });
  });
}
