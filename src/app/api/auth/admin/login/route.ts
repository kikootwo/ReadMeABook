/**
 * Component: Local Admin Login Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody, AUTH_JSON_BODY_LIMIT_BYTES } from '@/lib/utils/request-body';
import {
  getRegistrationRefusal,
  PENDING_APPROVAL_MESSAGE,
  REJECTED_ACCOUNT_ERROR,
} from '@/lib/services/auth/local-account-status';
import { createSignInGuard, tooManyAttemptsResponse, verifyPassword } from '@/lib/services/auth/signin-guard';

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

    const bodyResult = await readJsonBody(request, { maxBytes: AUTH_JSON_BODY_LIMIT_BYTES, requireJsonContentType: true });
    if (!bodyResult.ok) return bodyResult.response;
    const { username, password } = bodyResult.data;

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
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

    // A deleted account answers exactly like an unknown one
    const account = user && !user.deletedAt ? user : null;

    const guard = createSignInGuard(request);
    const attempt = guard.begin(normalizedUsername, account);
    if (!attempt.ok) {
      return tooManyAttemptsResponse(attempt.error, attempt.retryAfterSeconds);
    }

    // authToken holds an encrypted bcrypt hash; unknown names are checked against a dummy hash
    const passwordValid = await verifyPassword(account, password);
    guard.settle(passwordValid);

    if (!account || !passwordValid) {
      return NextResponse.json(
        {
          error: 'AuthenticationError',
          message: 'Invalid username or password',
        },
        { status: 401 }
      );
    }

    // Same registration checks as the regular local login, same responses
    const refusal = getRegistrationRefusal(account.registrationStatus);
    if (refusal === 'pending_approval') {
      return NextResponse.json({
        success: false,
        pendingApproval: true,
        message: PENDING_APPROVAL_MESSAGE,
      });
    }
    if (refusal === 'rejected') {
      return NextResponse.json({ error: REJECTED_ACCOUNT_ERROR }, { status: 401 });
    }

    // Update last login time
    await prisma.user.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate JWT tokens
    const accessToken = generateAccessToken({
      sub: account.id,
      plexId: account.plexId,
      username: account.plexUsername,
      role: account.role,
    });

    const refreshToken = generateRefreshToken(account.id);

    // Return tokens and user info
    const response = NextResponse.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: account.id,
        plexId: account.plexId,
        username: account.plexUsername,
        email: account.plexEmail,
        role: account.role,
        avatarUrl: account.avatarUrl,
      },
    });
    guard.remember(response);
    return response;
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
