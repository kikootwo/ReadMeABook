/**
 * Backend Mode API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { ConfigurationService } from '@/lib/services/config.service';

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      const configService = new ConfigurationService();
      const backendMode = await configService.getBackendMode();

      return NextResponse.json({
        backendMode,
        isAudiobookshelf: backendMode === 'audiobookshelf'
      });
    } catch (error) {
      console.error('[BackendMode] Failed to get backend mode:', error);
      return NextResponse.json(
        { error: 'Failed to get backend mode' },
        { status: 500 }
      );
    }
  });
}

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const { mode } = body;

        if (!mode || (mode !== 'plex' && mode !== 'audiobookshelf')) {
          return NextResponse.json(
            { error: 'Invalid backend mode. Must be "plex" or "audiobookshelf"' },
            { status: 400 }
          );
        }

        const configService = new ConfigurationService();
        await configService.setMany([
          { key: 'system.backend_mode', value: mode, category: 'system' }
        ]);

        // Clear library service cache to force re-initialization with new mode
        const { clearLibraryServiceCache } = await import('@/lib/services/library');
        clearLibraryServiceCache();

        console.log(`[BackendMode] Backend mode changed to: ${mode}`);

        return NextResponse.json({
          success: true,
          backendMode: mode,
          message: `Backend mode set to ${mode}`
        });
      } catch (error) {
        console.error('[BackendMode] Failed to set backend mode:', error);
        return NextResponse.json(
          { error: 'Failed to set backend mode' },
          { status: 500 }
        );
      }
    });
  });
}
