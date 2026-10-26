/**
 * Component: User Password Change API
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import bcrypt from 'bcrypt';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Auth.ChangePassword');

/**
 * POST /api/auth/change-password
 * Change password for any authenticated local user
 *
 * Security:
 * - Only available to local users (authProvider='local')
 * - Requires current password verification
 * - New password must be at least 8 characters
 * - New password must be different from current password
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      const bodyResult = await readJsonBody(request);
      if (!bodyResult.ok) return bodyResult.response;
      const { currentPassword, newPassword, confirmPassword } = bodyResult.data;

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
      const allowWeakPassword = process.env.ALLOW_WEAK_PASSWORD === 'true';
      if (!allowWeakPassword && newPassword.length < 8) {
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
        where: { id: req.user!.id },
        select: {
          id: true,
          authToken: true,
          authProvider: true,
          plexId: true,
          plexUsername: true,
        },
      });

      if (!user) {
        return NextResponse.json(
          {
            success: false,
            error: 'User not found',
          },
          { status: 404 }
        );
      }

      // Check if user is a local user (can change password)
      if (user.authProvider !== 'local') {
        return NextResponse.json(
          {
            success: false,
            error: 'Password change is only available for local users. Your account is managed by an external provider.',
          },
          { status: 403 }
        );
      }

      if (!user.authToken) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid account configuration',
          },
          { status: 400 }
        );
      }

      // Decrypt the stored hash before comparing
      const encryptionService = getEncryptionService();
      let decryptedHash: string;
      try {
        decryptedHash = encryptionService.decrypt(user.authToken);
      } catch (error) {
        logger.error('Failed to decrypt password hash', {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to verify current password',
          },
          { status: 500 }
        );
      }

      // Verify current password
      const currentPasswordValid = await bcrypt.compare(currentPassword, decryptedHash);

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

      // Encrypt the new hash before storing
      const encryptedHash = encryptionService.encrypt(hashedPassword);

      // Update password in database
      await prisma.user.update({
        where: { id: user.id },
        data: {
          authToken: encryptedHash,
          updatedAt: new Date(),
        },
      });

      logger.info('Password changed successfully', {
        userId: user.id,
        username: user.plexUsername
      });

      return NextResponse.json({
        success: true,
        message: 'Password changed successfully',
      });
    } catch (error) {
      logger.error('Failed to change password', {
        error: error instanceof Error ? error.message : String(error)
      });
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to change password',
        },
        { status: 500 }
      );
    }
  });
}
