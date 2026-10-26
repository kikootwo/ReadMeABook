/**
 * Component: Setup Wizard Download Client Categories API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getConfigService } from '@/lib/services/config.service';
import { getDownloadClientManager, DownloadClientConfig } from '@/lib/services/download-client-manager.service';
import { SUPPORTED_CLIENT_TYPES } from '@/lib/interfaces/download-client.interface';
import { requireSetupIncomplete } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Setup.DownloadClientCategories');

/**
 * POST - Fetch categories from a download client during setup wizard
 */
export async function POST(request: NextRequest) {
  return requireSetupIncomplete(request, async (req) => {
    try {
      const bodyResult = await readJsonBody(req);
      if (!bodyResult.ok) return bodyResult.response;
      const { type, name, url, username, password, disableSSLVerify } = bodyResult.data;

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

      const testConfig: DownloadClientConfig = {
        id: 'setup-categories',
        type,
        name: name || type,
        enabled: true,
        url,
        username: username || '',
        password: password || '',
        disableSSLVerify: disableSSLVerify || false,
        remotePathMappingEnabled: false,
      };

      const configService = getConfigService();
      const manager = getDownloadClientManager(configService);
      const service = await manager.createClientFromConfig(testConfig);
      const categories = await service.getCategories();

      return NextResponse.json({ success: true, categories });
    } catch (error) {
      logger.error('Failed to fetch categories', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Failed to fetch categories' },
        { status: 500 }
      );
    }
  });
}
