/**
 * Component: Setup Wizard Test Download Client API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getConfigService } from '@/lib/services/config.service';
import { getDownloadClientManager, DownloadClientConfig } from '@/lib/services/download-client-manager.service';
import { SUPPORTED_CLIENT_TYPES } from '@/lib/interfaces/download-client.interface';
import { requireSetupIncomplete } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Setup.TestDownloadClient');

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

    // Build a temporary config for testing
    const testConfig: DownloadClientConfig = {
      id: 'setup-test',
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
    const result = await manager.testConnection(testConfig);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
      });
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
}
