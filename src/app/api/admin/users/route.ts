/**
 * Component: Admin Users API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Users');

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const users = await prisma.user.findMany({
          where: {
            deletedAt: null, // Exclude soft-deleted users
          },
          select: {
            id: true,
            plexId: true,
            plexUsername: true,
            plexEmail: true,
            role: true,
            isSetupAdmin: true,
            authProvider: true,
            avatarUrl: true,
            createdAt: true,
            updatedAt: true,
            lastLoginAt: true,
            autoApproveRequests: true,
            interactiveSearchAccess: true,
            downloadAccess: true,
            _count: {
              select: {
                requests: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        return NextResponse.json({ users });
      } catch (error) {
        logger.error('Failed to fetch users', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to fetch users' },
          { status: 500 }
        );
      }
    });
  });
}
