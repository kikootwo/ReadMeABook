/**
 * Component: Token Login Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateAccessToken, generateRefreshToken } from '@/lib/utils/jwt';
import { RMABLogger } from '@/lib/utils/logger';
import { checkTokenLoginRateLimit } from '@/lib/utils/authRateLimit';
import crypto from 'crypto';

const logger = RMABLogger.create('API.Auth.TokenLogin');

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
    const rateLimit = checkTokenLoginRateLimit(ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: 'Missing token parameter' }, { status: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        loginTokenHash: tokenHash,
        deletedAt: null,
      },
      select: {
        id: true,
        plexId: true,
        plexUsername: true,
        plexEmail: true,
        avatarUrl: true,
        role: true,
      },
    });

    if (!user) {
      logger.warn('Token login failed - not found or user deleted');
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = generateAccessToken({
      sub: user.id,
      plexId: user.plexId,
      username: user.plexUsername,
      role: user.role,
    });

    const refreshToken = generateRefreshToken(user.id);

    logger.info('Token login successful', { username: user.plexUsername });

    return NextResponse.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.plexUsername,
        email: user.plexEmail,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error('Token login error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
