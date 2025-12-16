/**
 * Audiobookshelf Settings API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { ConfigUpdate } from '@/lib/services/config.service';

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const { serverUrl, apiToken, libraryId } = body;

        const { getConfigService } = await import('@/lib/services/config.service');
        const configService = getConfigService();

        // Build updates array, skipping masked values
        const updates: ConfigUpdate[] = [
          { key: 'audiobookshelf.server_url', value: serverUrl || '' },
          { key: 'audiobookshelf.library_id', value: libraryId || '' },
        ];

        // Only update API token if it's not the masked placeholder
        if (apiToken && !apiToken.startsWith('••••')) {
          updates.push({
            key: 'audiobookshelf.api_token',
            value: apiToken,
            encrypted: true,
          });
        }

        // Update configuration
        await configService.setMany(updates);

        return NextResponse.json({
          success: true,
          message: 'Audiobookshelf settings saved successfully'
        });
      } catch (error) {
        console.error('[Admin] Failed to save Audiobookshelf settings:', error);
        return NextResponse.json(
          { error: 'Failed to save settings' },
          { status: 500 }
        );
      }
    });
  });
}
