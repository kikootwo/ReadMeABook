/**
 * Component: Local Admin Login Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcrypt';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Auth.AdminLogin');

/**
 * POST /api/auth/admin/login
 * Authenticates local admin users with username and password
 */
export async function POST(request: NextRequest) {
  try {
    // Check if local login is disabled
    if (process.env.DISABLE_LOCAL_LOGIN === 'true') {
      return NextResponse.json(
        { error: 'Local login is disabled' },
        { status: 403 }
      );
    }

    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Username and password are required',
        },
        { status: 400 }
      );
    }

    const normalizedUsername = username.trim().toLowerCase();

    // Find user by local admin identifier
    const user = await prisma.user.findUnique({
      where: { plexId: `local-${normalizedUsername}` },
    });

    if (!user) {
      return NextResponse.json(
        {
          error: 'AuthenticationError',
          message: 'Invalid username or password',
        },
        { status: 401 }
      );
    }

    // Verify password
    // authToken contains an encrypted bcrypt hash, so we need to decrypt it first
    let passwordValid = false;
    try {
      const encryptionService = getEncryptionService();
      const decryptedHash = encryptionService.decrypt(user.authToken || '');
      passwordValid = await bcrypt.compare(password, decryptedHash);
    } catch (error) {
      logger.error('Password verification failed', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        {
          error: 'AuthenticationError',
          message: 'Invalid username or password',
        },
        { status: 401 }
      );
    }

    if (!passwordValid) {
      return NextResponse.json(
        {
          error: 'AuthenticationError',
          message: 'Invalid username or password',
        },
        { status: 401 }
      );
    }

    // Update last login time
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate JWT tokens
    const accessToken = generateAccessToken({
      sub: user.id,
      plexId: user.plexId,
      username: user.plexUsername,
      role: user.role,
    });

    const refreshToken = generateRefreshToken(user.id);

    // Return tokens and user info
    return NextResponse.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        plexId: user.plexId,
        username: user.plexUsername,
        email: user.plexEmail,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    logger.error('Failed to authenticate admin user', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: 'AuthenticationError',
        message: 'Failed to authenticate',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
