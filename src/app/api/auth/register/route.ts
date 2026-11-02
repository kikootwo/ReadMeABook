/**
 * User Registration Endpoint
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { LocalAuthProvider } from '@/lib/services/auth/LocalAuthProvider';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody, AUTH_JSON_BODY_LIMIT_BYTES } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Auth.Register');

// Rate limiting map (in production, use Redis)
const registrationAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempts = registrationAttempts.get(ip);

  if (!attempts || now > attempts.resetAt) {
    registrationAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (attempts.count >= MAX_ATTEMPTS) {
    return false;
  }

  attempts.count++;
  return true;
}

export async function POST(request: NextRequest) {
  // Check if local login is disabled
  if (process.env.DISABLE_LOCAL_LOGIN === 'true') {
    return NextResponse.json(
      { error: 'Local registration is disabled' },
      { status: 403 }
    );
  }

  // Rate limiting
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Please try again later.' },
      { status: 429 }
    );
  }

  try {
    const bodyResult = await readJsonBody(request, { maxBytes: AUTH_JSON_BODY_LIMIT_BYTES });
    if (!bodyResult.ok) return bodyResult.response;
    const { username, password } = bodyResult.data;

    const provider = new LocalAuthProvider();
    const result = await provider.register({ username, password });

    if (!result.success) {
      if (result.requiresApproval) {
        return NextResponse.json({
          success: false,
          pendingApproval: true,
          message: 'Account created. Waiting for admin approval.',
        });
      }
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    // Return tokens for auto-login
    return NextResponse.json({
      success: true,
      user: result.user,
      accessToken: result.tokens!.accessToken,
      refreshToken: result.tokens!.refreshToken,
    });
  } catch (error) {
    logger.error('Registration error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
