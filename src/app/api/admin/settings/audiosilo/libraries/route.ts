/**
 * AudioSilo Libraries API
 * Documentation: documentation/features/audiosilo-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { describeFetchError, fetchErrorDetails } from '@/lib/utils/fetch-error';

interface SiloLibrary {
  id: number;
  name: string;
  kind: string;
}

const logger = RMABLogger.create('API.AudioSiloLibraries');

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();
        const serverUrl = await configService.get('audiosilo.server_url');
        const apiToken = await configService.get('audiosilo.api_token');

        if (!serverUrl || !apiToken) {
          return NextResponse.json({ error: 'AudioSilo not configured' }, { status: 400 });
        }

        const librariesUrl = `${serverUrl.replace(/\/$/, '')}/api/v1/libraries`;
        let response: Response;
        try {
          response = await fetch(librariesUrl, { headers: { Authorization: `Bearer ${apiToken}` } });
        } catch (error) {
          const reason = describeFetchError(error, librariesUrl, { service: 'AudioSilo', secrets: [apiToken] });
          logger.error('Failed to fetch AudioSilo libraries', { reason, ...fetchErrorDetails(error, librariesUrl, [apiToken]) });
          return NextResponse.json({ error: reason }, { status: 500 });
        }

        if (!response.ok) {
          return NextResponse.json({ error: 'Failed to fetch libraries from AudioSilo' }, { status: response.status });
        }

        const data = await response.json();
        const libraries = (data.libraries || [])
          .filter((lib: SiloLibrary) => lib.kind === 'books')
          .map((lib: SiloLibrary) => ({ id: String(lib.id), name: lib.name, type: lib.kind, itemCount: 0 }));

        return NextResponse.json({ libraries });
      } catch (error) {
        logger.error('Failed to fetch AudioSilo libraries', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Failed to fetch libraries' }, { status: 500 });
      }
    });
  });
}
