/**
 * User Approval API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;
        const body = await request.json();
        const { approve } = body; // true = approve, false = reject

        const user = await prisma.user.findUnique({
          where: { id },
          select: {
            id: true,
            plexUsername: true,
            registrationStatus: true,
          },
        });

        if (!user) {
          return NextResponse.json(
            { error: 'User not found' },
            { status: 404 }
          );
        }

        if (user.registrationStatus !== 'pending_approval') {
          return NextResponse.json(
            { error: 'User is not pending approval' },
            { status: 400 }
          );
        }

        if (approve) {
          // Approve user
          await prisma.user.update({
            where: { id },
            data: { registrationStatus: 'approved' },
          });

          return NextResponse.json({
            success: true,
            message: `User ${user.plexUsername} has been approved`
          });
        } else {
          // Reject user (delete the account)
          await prisma.user.delete({
            where: { id },
          });

          return NextResponse.json({
            success: true,
            message: `User ${user.plexUsername} has been rejected and removed`
          });
        }
      } catch (error) {
        console.error('[Admin] Failed to approve/reject user:', error);
        return NextResponse.json(
          { error: 'Failed to process user approval' },
          { status: 500 }
        );
      }
    });
  });
}
