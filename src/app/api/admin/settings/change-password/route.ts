/**
 * Component: Local Admin Password Change API
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireLocalAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import bcrypt from 'bcrypt';

/**
 * POST /api/admin/settings/change-password
 * Change password for local admin user
 *
 * Security:
 * - Only available to local admin (isSetupAdmin=true AND plexId starts with 'local-')
 * - Requires current password verification
 * - New password must be at least 8 characters
 * - New password must be different from current password
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireLocalAdmin(req, async (authenticatedReq: AuthenticatedRequest) => {
      try {
        const { currentPassword, newPassword, confirmPassword } = await request.json();

        // Validate input
        if (!currentPassword || !newPassword || !confirmPassword) {
          return NextResponse.json(
            {
              success: false,
              error: 'All fields are required',
            },
            { status: 400 }
          );
        }

        // Validate new password length
        if (newPassword.length < 8) {
          return NextResponse.json(
            {
              success: false,
              error: 'New password must be at least 8 characters',
            },
            { status: 400 }
          );
        }

        // Validate passwords match
        if (newPassword !== confirmPassword) {
          return NextResponse.json(
            {
              success: false,
              error: 'New passwords do not match',
            },
            { status: 400 }
          );
        }

        // Validate new password is different from current
        if (currentPassword === newPassword) {
          return NextResponse.json(
            {
              success: false,
              error: 'New password must be different from current password',
            },
            { status: 400 }
          );
        }

        // Get user from database
        const user = await prisma.user.findUnique({
          where: { id: authenticatedReq.user!.id },
          select: {
            id: true,
            authToken: true,
            plexId: true,
            isSetupAdmin: true,
          },
        });

        if (!user || !user.authToken) {
          return NextResponse.json(
            {
              success: false,
              error: 'User not found or invalid account type',
            },
            { status: 404 }
          );
        }

        // Verify current password
        const currentPasswordValid = await bcrypt.compare(currentPassword, user.authToken);

        if (!currentPasswordValid) {
          return NextResponse.json(
            {
              success: false,
              error: 'Current password is incorrect',
            },
            { status: 400 }
          );
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password in database
        await prisma.user.update({
          where: { id: user.id },
          data: {
            authToken: hashedPassword,
            updatedAt: new Date(),
          },
        });

        console.log(`[Auth] Local admin password changed successfully for user ${user.id}`);

        return NextResponse.json({
          success: true,
          message: 'Password changed successfully',
        });
      } catch (error) {
        console.error('[Auth] Failed to change password:', error);
        return NextResponse.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to change password',
          },
          { status: 500 }
        );
      }
    });
  });
}
