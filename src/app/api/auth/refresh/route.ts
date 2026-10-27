/**
 * Component: Token Refresh Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRefreshToken, generateAccessToken } from '@/lib/utils/jwt';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { getRegistrationRefusal } from '@/lib/services/auth/local-account-status';
import { readJsonBody, AUTH_JSON_BODY_LIMIT_BYTES } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Auth.Refresh');

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
export async function POST(request: NextRequest) {
  try {
    const bodyResult = await readJsonBody(request, { maxBytes: AUTH_JSON_BODY_LIMIT_BYTES });
    if (!bodyResult.ok) return bodyResult.response;
    const body = bodyResult.data;
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
      select: {
        id: true,
        plexId: true,
        plexUsername: true,
        role: true,
        deletedAt: true,
        sessionsInvalidatedAt: true,
        registrationStatus: true,
      },
    });

    // Missing, deleted, pending-approval and rejected accounts are refused the same way
    if (!user || user.deletedAt || getRegistrationRefusal(user.registrationStatus)) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'User not found',
        },
        { status: 401 }
      );
    }

    // Check if session was invalidated after this refresh token was issued
    if (user.sessionsInvalidatedAt && payload.iat &&
        payload.iat < Math.floor(user.sessionsInvalidatedAt.getTime() / 1000)) {
      logger.warn('Refresh token issued before session invalidation', { userId: payload.sub });
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Session has been revoked',
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
    logger.error('Failed to refresh token', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: 'RefreshError',
        message: 'Failed to refresh access token',
      },
      { status: 500 }
    );
  }
}
