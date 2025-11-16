/**
 * Component: Admin User Update API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;
        const body = await request.json();
        const { role } = body;

        // Validate role
        if (!role || (role !== 'user' && role !== 'admin')) {
          return NextResponse.json(
            { error: 'Invalid role. Must be "user" or "admin"' },
            { status: 400 }
          );
        }

        // Prevent user from demoting themselves
        if (req.user && id === req.user.sub) {
          return NextResponse.json(
            { error: 'You cannot change your own role' },
            { status: 403 }
          );
        }

        // Update user role
        const updatedUser = await prisma.user.update({
          where: { id },
          data: { role },
          select: {
            id: true,
            plexUsername: true,
            role: true,
          },
        });

        return NextResponse.json({ user: updatedUser });
      } catch (error) {
        console.error('[Admin] Failed to update user:', error);
        return NextResponse.json(
          { error: 'Failed to update user' },
          { status: 500 }
        );
      }
    });
  });
}
