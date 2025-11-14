/**
 * Component: Admin Download Client Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { type, url, username, password } = await request.json();

        if (!type || !url || !username || !password) {
          return NextResponse.json(
            { error: 'Type, URL, username, and password are required' },
            { status: 400 }
          );
        }

        // Validate type
        if (type !== 'qbittorrent' && type !== 'transmission') {
          return NextResponse.json(
            { error: 'Invalid client type. Must be qbittorrent or transmission' },
            { status: 400 }
          );
        }

        // Update configuration
        await prisma.configuration.upsert({
          where: { key: 'download_client_type' },
          update: { value: type },
          create: { key: 'download_client_type', value: type },
        });

        await prisma.configuration.upsert({
          where: { key: 'download_client_url' },
          update: { value: url },
          create: { key: 'download_client_url', value: url },
        });

        await prisma.configuration.upsert({
          where: { key: 'download_client_username' },
          update: { value: username },
          create: { key: 'download_client_username', value: username },
        });

        // Only update password if it's not the masked value
        if (!password.startsWith('••••')) {
          await prisma.configuration.upsert({
            where: { key: 'download_client_password' },
            update: { value: password },
            create: { key: 'download_client_password', value: password },
          });
        }

        console.log('[Admin] Download client settings updated');

        return NextResponse.json({
          success: true,
          message: 'Download client settings updated successfully',
        });
      } catch (error) {
        console.error('[Admin] Failed to update download client settings:', error);
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update settings',
          },
          { status: 500 }
        );
      }
    });
  });
}
