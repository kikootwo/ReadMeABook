/**
 * Component: Authentication Middleware
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import { prisma } from '../db';

export interface AuthenticatedRequest extends NextRequest {
  user?: TokenPayload & { id: string };
}

/**
 * Extract token from Authorization header
 */
function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Middleware: Require authentication
 * Verifies JWT token and adds user to request
 */
export async function requireAuth(
  request: NextRequest,
  handler: (request: AuthenticatedRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  const token = extractToken(request);

  if (!token) {
    return NextResponse.json(
      {
        error: 'Unauthorized',
        message: 'No authentication token provided',
      },
      { status: 401 }
    );
  }

  const payload = verifyAccessToken(token);

  if (!payload) {
    return NextResponse.json(
      {
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      },
      { status: 401 }
    );
  }

  // Verify user still exists in database
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

  // Add user to request
  const authenticatedRequest = request as AuthenticatedRequest;
  authenticatedRequest.user = {
    ...payload,
    id: user.id,
  };

  return handler(authenticatedRequest);
}

/**
 * Middleware: Require admin role
 * Must be chained after requireAuth
 */
export async function requireAdmin(
  request: AuthenticatedRequest,
  handler: (request: AuthenticatedRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  if (!request.user) {
    return NextResponse.json(
      {
        error: 'Unauthorized',
        message: 'Authentication required',
      },
      { status: 401 }
    );
  }

  if (request.user.role !== 'admin') {
    return NextResponse.json(
      {
        error: 'Forbidden',
        message: 'Admin access required',
      },
      { status: 403 }
    );
  }

  return handler(request);
}

/**
 * Helper: Get current user from request (for use in API routes)
 */
export function getCurrentUser(request: NextRequest): TokenPayload | null {
  const token = extractToken(request);
  if (!token) return null;
  return verifyAccessToken(token);
}

/**
 * Helper: Check if user is admin
 */
export function isAdmin(user: TokenPayload | null): boolean {
  return user?.role === 'admin';
}
