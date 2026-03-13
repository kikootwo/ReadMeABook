/**
 * Component: Admin User Login Token
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { generateApiToken } from '@/lib/utils/api-token';

const logger = RMABLogger.create('API.Admin.Users.LoginToken');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;

        const targetUser = await prisma.user.findUnique({
          where: { id },
          select: { plexUsername: true, deletedAt: true },
        });

        if (!targetUser) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        if (targetUser.deletedAt) {
          return NextResponse.json(
            { error: 'Cannot generate token for deleted user' },
            { status: 403 }
          );
        }

        const { fullToken, tokenHash } = generateApiToken();

        await prisma.user.update({
          where: { id },
          data: { loginTokenHash: tokenHash },
        });

        logger.info('Admin generated login token for user', {
          targetUser: targetUser.plexUsername,
          createdBy: req.user!.username,
        });

        return NextResponse.json({ fullToken }, { status: 201 });
      } catch (error) {
        logger.error('Failed to generate login token', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Failed to generate login token' }, { status: 500 });
      }
    });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;

        const targetUser = await prisma.user.findUnique({
          where: { id },
          select: { plexUsername: true },
        });

        if (!targetUser) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        await prisma.user.update({
          where: { id },
          data: { loginTokenHash: null },
        });

        logger.info('Admin revoked login token for user', {
          targetUser: targetUser.plexUsername,
          revokedBy: req.user!.username,
        });

        return NextResponse.json({ success: true });
      } catch (error) {
        logger.error('Failed to revoke login token', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Failed to revoke login token' }, { status: 500 });
      }
    });
  });
}
