/**
 * User Registration Endpoint
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { LocalAuthProvider } from '@/lib/services/auth/LocalAuthProvider';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody, AUTH_JSON_BODY_LIMIT_BYTES } from '@/lib/utils/request-body';
import { checkRegisterRateLimit } from '@/lib/utils/rateLimit';
import { clientAddressKey } from '@/lib/utils/client-address';

const logger = RMABLogger.create('API.Auth.Register');

export async function POST(request: NextRequest) {
  // Check if local login is disabled
  if (process.env.DISABLE_LOCAL_LOGIN === 'true') {
    return NextResponse.json(
      { error: 'Local registration is disabled' },
      { status: 403 }
    );
  }

  // 5 attempts per hour per client address
  const rateLimit = checkRegisterRateLimit(clientAddressKey(request.headers));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
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
