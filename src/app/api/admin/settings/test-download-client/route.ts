/**
 * Component: Admin Settings Test Download Client API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { type, url, username, password } = await request.json();

        if (!type || !url || !username || !password) {
          return NextResponse.json(
            { success: false, error: 'All fields are required' },
            { status: 400 }
          );
        }

        if (type !== 'qbittorrent') {
          return NextResponse.json(
            { success: false, error: 'Only qBittorrent is currently supported' },
            { status: 400 }
          );
        }

        // If password is masked, fetch the actual value from database
        let actualPassword = password;
        if (password.startsWith('••••')) {
          const storedPassword = await prisma.configuration.findUnique({
            where: { key: 'download_client_password' },
          });

          if (!storedPassword?.value) {
            return NextResponse.json(
              { success: false, error: 'No stored password found. Please re-enter your download client password.' },
              { status: 400 }
            );
          }

          actualPassword = storedPassword.value;
        }

        // Test connection with credentials
        const version = await QBittorrentService.testConnectionWithCredentials(
          url,
          username,
          actualPassword
        );

        return NextResponse.json({
          success: true,
          version,
        });
      } catch (error) {
        console.error('[Admin Settings] Download client test failed:', error);
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
