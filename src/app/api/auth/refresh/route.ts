/**
 * Component: Token Refresh Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRefreshToken, generateAccessToken } from '@/lib/utils/jwt';
import { prisma } from '@/lib/db';

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { refreshToken } = body;

    if (!refreshToken) {
      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Refresh token is required',
        },
        { status: 400 }
      );
    }

    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken);

    if (!payload) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired refresh token',
        },
        { status: 401 }
      );
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'User not found',
        },
        { status: 401 }
      );
    }

    // Generate new access token
    const accessToken = generateAccessToken({
      sub: user.id,
      plexId: user.plexId,
      username: user.plexUsername,
      role: user.role,
    });

    return NextResponse.json({
      success: true,
      accessToken,
      expiresIn: 3600, // 1 hour in seconds
    });
  } catch (error) {
    console.error('Failed to refresh token:', error);
    return NextResponse.json(
      {
        error: 'RefreshError',
        message: 'Failed to refresh access token',
      },
      { status: 500 }
    );
  }
}
