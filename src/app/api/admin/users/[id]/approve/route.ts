/**
 * User Approval API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.Users.Approve');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;
        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const body = bodyResult.data;
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
        logger.error('Failed to approve/reject user', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to process user approval' },
          { status: 500 }
        );
      }
    });
  });
}
