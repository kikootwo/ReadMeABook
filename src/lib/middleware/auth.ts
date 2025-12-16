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
    console.error('[Auth Middleware] No token provided');
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
    console.error('[Auth Middleware] Token verification failed');
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
    console.error('[Auth Middleware] User not found in database:', payload.sub);
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

/**
 * Middleware: Require local admin (setup admin)
 * Must be chained after requireAuth
 * Only allows local admin users (created during setup with username/password)
 */
export async function requireLocalAdmin(
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

  // Verify user is admin
  if (request.user.role !== 'admin') {
    return NextResponse.json(
      {
        error: 'Forbidden',
        message: 'Admin access required',
      },
      { status: 403 }
    );
  }

  // Fetch user from database to check isSetupAdmin flag
  const user = await prisma.user.findUnique({
    where: { id: request.user.id },
    select: {
      isSetupAdmin: true,
      plexId: true,
    },
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

  // Check if user is local admin (setup admin with local authentication)
  const isLocalAdmin = user.isSetupAdmin && user.plexId.startsWith('local-');

  if (!isLocalAdmin) {
    return NextResponse.json(
      {
        error: 'Forbidden',
        message: 'This action is only available to the local admin account',
      },
      { status: 403 }
    );
  }

  return handler(request);
}

/**
 * Helper: Check if user is local admin (setup admin with local authentication)
 */
export async function isLocalAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isSetupAdmin: true,
      plexId: true,
    },
  });

  if (!user) return false;

  return user.isSetupAdmin && user.plexId.startsWith('local-');
}
