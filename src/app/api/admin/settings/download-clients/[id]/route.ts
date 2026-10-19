/**
 * Component: Admin Download Client by ID API
 * Documentation: documentation/phase3/download-clients.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { getDownloadClientManager, invalidateDownloadClientManager } from '@/lib/services/download-client-manager.service';
import { DownloadClientConfig } from '@/lib/services/download-client-manager.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { RMABLogger } from '@/lib/utils/logger';
import { MASKED_PASSWORD, resolveSecretForUrl } from '@/lib/utils/saved-credential';
import { savedClientCredential } from '@/lib/services/saved-credentials.service';

const logger = RMABLogger.create('API.Admin.Settings.DownloadClients.ID');

/**
 * PUT - Update download client by ID
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Await params in Next.js 15+
        const { id } = await params;
        const body = await request.json();
        const {
          name,
          enabled,
          url,
          username,
          password,
          disableSSLVerify,
          remotePathMappingEnabled,
          remotePath,
          localPath,
          category,
          customPath,
          postImportCategory,
        } = body;

        const config = await getConfigService();
        const manager = getDownloadClientManager(config);
        const clients = await manager.getAllClients();

        const clientIndex = clients.findIndex(c => c.id === id);
        if (clientIndex === -1) {
          return NextResponse.json(
            { error: 'Download client not found' },
            { status: 404 }
          );
        }

        const existingClient = clients[clientIndex];

        // Validate customPath: reject paths containing ".."
        if (customPath && customPath.includes('..')) {
          return NextResponse.json(
            { error: 'Custom path cannot contain ".."' },
            { status: 400 }
          );
        }

        // Keeping the saved password/API key is only allowed for the saved URL
        const nextUrl = url !== undefined ? url : existingClient.url;
        const resolvedPassword = await resolveSecretForUrl({
          kind: 'downloadClient',
          url: nextUrl,
          supplied: password,
          acceptPasswordMask: true,
          emptyMeansSaved: Boolean(existingClient.password),
          loadSaved: () => savedClientCredential(existingClient),
        });
        if (!resolvedPassword.ok) {
          return NextResponse.json({ error: resolvedPassword.error }, { status: 400 });
        }

        // Build updated client (preserve fields not in request)
        const updatedClient: DownloadClientConfig = {
          ...existingClient,
          name: name !== undefined ? name : existingClient.name,
          enabled: enabled !== undefined ? enabled : existingClient.enabled,
          url: nextUrl,
          username: username !== undefined ? username : existingClient.username,
          password: resolvedPassword.secret || existingClient.password,
          disableSSLVerify: disableSSLVerify !== undefined ? disableSSLVerify : existingClient.disableSSLVerify,
          remotePathMappingEnabled: remotePathMappingEnabled !== undefined ? remotePathMappingEnabled : existingClient.remotePathMappingEnabled,
          remotePath: remotePath !== undefined ? remotePath : existingClient.remotePath,
          localPath: localPath !== undefined ? localPath : existingClient.localPath,
          category: category !== undefined ? category : existingClient.category,
          customPath: customPath !== undefined ? (customPath || undefined) : existingClient.customPath,
          postImportCategory: postImportCategory !== undefined ? (postImportCategory || undefined) : existingClient.postImportCategory,
        };

        // Validate path mapping if enabled
        if (updatedClient.remotePathMappingEnabled) {
          if (!updatedClient.remotePath || !updatedClient.localPath) {
            return NextResponse.json(
              { error: 'Remote path and local path are required when path mapping is enabled' },
              { status: 400 }
            );
          }
        }

        // Test connection if credentials/URL changed (skip if disabling client)
        const isDisabling = enabled === false;
        if (
          !isDisabling &&
          (
            url !== undefined ||
            username !== undefined ||
            (password && password !== MASKED_PASSWORD) ||
            disableSSLVerify !== undefined
          )
        ) {
          const testResult = await manager.testConnection(updatedClient);
          if (!testResult.success) {
            return NextResponse.json(
              { error: `Connection test failed: ${testResult.message}` },
              { status: 400 }
            );
          }
        }

        // Update clients array and encrypt passwords before saving
        clients[clientIndex] = updatedClient;
        const encryptionService = getEncryptionService();
        const encryptedClients = clients.map(c => ({
          ...c,
          password: c.password ? encryptionService.encrypt(c.password) : '',
        }));
        await config.setMany([
          { key: 'download_clients', value: JSON.stringify(encryptedClients) },
        ]);

        // Invalidate cache
        invalidateDownloadClientManager();

        logger.info('Download client updated', { id, type: updatedClient.type, name: updatedClient.name });

        return NextResponse.json({
          message: 'Download client updated successfully',
          client: {
            ...updatedClient,
            password: MASKED_PASSWORD,
          },
        });
      } catch (error) {
        logger.error('Failed to update download client', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to update download client' },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * DELETE - Remove download client by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Await params in Next.js 15+
        const { id } = await params;

        const config = await getConfigService();
        const manager = getDownloadClientManager(config);
        const clients = await manager.getAllClients();

        const clientIndex = clients.findIndex(c => c.id === id);
        if (clientIndex === -1) {
          return NextResponse.json(
            { error: 'Download client not found' },
            { status: 404 }
          );
        }

        const deletedClient = clients[clientIndex];

        // Remove client from array and encrypt passwords before saving
        const updatedClients = clients.filter(c => c.id !== id);
        const encryptionService = getEncryptionService();
        const encryptedClients = updatedClients.map(c => ({
          ...c,
          password: c.password ? encryptionService.encrypt(c.password) : '',
        }));
        await config.setMany([
          { key: 'download_clients', value: JSON.stringify(encryptedClients) },
        ]);

        // Invalidate cache
        invalidateDownloadClientManager();

        logger.info('Download client deleted', { id, type: deletedClient.type, name: deletedClient.name });

        return NextResponse.json({
          message: 'Download client deleted successfully',
        });
      } catch (error) {
        logger.error('Failed to delete download client', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to delete download client' },
          { status: 500 }
        );
      }
    });
  });
}
