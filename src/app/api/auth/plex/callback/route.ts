/**
 * Component: Plex OAuth Callback Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPlexService } from '@/lib/integrations/plex.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { prisma } from '@/lib/db';

/**
 * GET /api/auth/plex/callback?pinId=12345
 * Polls Plex PIN status and completes OAuth flow
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const pinId = searchParams.get('pinId');

    if (!pinId) {
      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Missing pinId parameter',
        },
        { status: 400 }
      );
    }

    const plexService = getPlexService();
    const encryptionService = getEncryptionService();

    // Check PIN status
    const authToken = await plexService.checkPin(parseInt(pinId, 10));

    if (!authToken) {
      // Still waiting for user to authorize
      return NextResponse.json(
        {
          success: false,
          authorized: false,
          message: 'Waiting for user authorization',
        },
        { status: 202 } // 202 Accepted - still processing
      );
    }

    // Get user info from Plex
    const plexUser = await plexService.getUserInfo(authToken);

    // Check if this is the first user (should be promoted to admin)
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;
    const role = isFirstUser ? 'admin' : 'user';

    // Create or update user in database
    const user = await prisma.user.upsert({
      where: { plexId: plexUser.id.toString() },
      create: {
        plexId: plexUser.id.toString(),
        plexUsername: plexUser.username,
        plexEmail: plexUser.email,
        role,
        avatarUrl: plexUser.thumb,
        authToken: encryptionService.encrypt(authToken),
        lastLoginAt: new Date(),
      },
      update: {
        plexUsername: plexUser.username,
        plexEmail: plexUser.email,
        avatarUrl: plexUser.thumb,
        authToken: encryptionService.encrypt(authToken),
        lastLoginAt: new Date(),
      },
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
      authorized: true,
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
    console.error('Failed to complete Plex OAuth:', error);
    return NextResponse.json(
      {
        error: 'OAuthError',
        message: 'Failed to complete authentication',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
