/**
 * Component: Authentication Middleware
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { API_TOKEN_PREFIX, isEndpointAllowed } from '../constants/api-tokens';
import {
  getRegistrationRefusal,
  getSessionRefusal,
  type SessionRefusal,
} from '../services/auth/local-account-status';

const logger = RMABLogger.create('Auth');

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
 * Authenticate via static API token (rmab_ prefix).
 * Returns a synthetic TokenPayload if valid, null otherwise.
 * Updates lastUsedAt asynchronously.
 */
async function authenticateApiToken(token: string): Promise<TokenPayload | null> {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash },
    include: {
      tokenUser: {
        select: {
          id: true,
          plexId: true,
          plexUsername: true,
          role: true,
          deletedAt: true,
          registrationStatus: true,
        },
      },
    },
  });

  if (!apiToken) return null;

  // Check expiration
  if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
    logger.warn('API token expired', { tokenPrefix: apiToken.tokenPrefix });
    return null;
  }

  // Reject tokens for missing, soft-deleted, pending-approval or rejected users
  const user = apiToken.tokenUser;
  const refusal = user ? getRegistrationRefusal(user.registrationStatus) : null;
  if (!user || user.deletedAt || refusal) {
    logger.warn('API token used by a missing, deleted or unapproved user', {
      tokenPrefix: apiToken.tokenPrefix,
      userId: user?.id,
      reason: !user ? 'missing' : user.deletedAt ? 'deleted' : refusal,
    });
    return null;
  }

  // Update lastUsedAt (fire-and-forget)
  prisma.apiToken.update({
    where: { id: apiToken.id },
    data: { lastUsedAt: new Date() },
  }).catch((err) => {
    logger.debug('Failed to update API token lastUsedAt', {
      error: err instanceof Error ? err.message : String(err),
      tokenId: apiToken.id,
    });
  });

  // Use the token's target user (userId), not the creator (createdById).
  // The token's role is an upper bound: it never exceeds the owner's current role.
  return {
    sub: user.id,
    plexId: user.plexId,
    username: user.plexUsername,
    role: apiToken.role === 'admin' && user.role === 'admin' ? 'admin' : 'user',
  };
}

type AuthenticatedUser = NonNullable<AuthenticatedRequest['user']>;

type SessionCheck =
  | { user: AuthenticatedUser; reason?: undefined }
  | { user?: undefined; reason: 'invalid_token' | SessionRefusal; userId?: string };

/**
 * The account check for an access token: a valid signature, then the account row
 * (missing, deleted, pending, rejected, revoked). The role comes from the row.
 */
async function checkAccessToken(token: string): Promise<SessionCheck> {
  const payload = verifyAccessToken(token);
  if (!payload) return { reason: 'invalid_token' };

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      role: true,
      deletedAt: true,
      sessionsInvalidatedAt: true,
      registrationStatus: true,
    },
  });

  const refusal = getSessionRefusal(user, payload.iat);
  if (!user || refusal) return { reason: refusal ?? 'missing', userId: payload.sub };

  // The role comes from the account, not the token, so role changes apply now
  return { user: { ...payload, id: payload.sub, role: user.role } };
}

/**
 * Middleware: Require authentication
 * Verifies JWT token or static API token and adds user to request
 */
export async function requireAuth(
  request: NextRequest,
  handler: (request: AuthenticatedRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  const token = extractToken(request);

  if (!token) {
    logger.error('No token provided');
    return NextResponse.json(
      {
        error: 'Unauthorized',
        message: 'No authentication token provided',
      },
      { status: 401 }
    );
  }

  // Check if this is a static API token
  if (token.startsWith(API_TOKEN_PREFIX)) {
    const apiUser = await authenticateApiToken(token);
    if (!apiUser) {
      logger.error('API token authentication failed');
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired API token',
        },
        { status: 401 }
      );
    }

    // Enforce endpoint allowlist for API token auth
    const pathname = request.nextUrl.pathname;
    const method = request.method;
    if (!isEndpointAllowed(method, pathname)) {
      logger.warn('API token used on restricted endpoint', {
        method,
        path: pathname,
      });
      return NextResponse.json(
        {
          error: 'Forbidden',
          message: 'This endpoint is not available via API token authentication',
        },
        { status: 403 }
      );
    }

    const authenticatedRequest = request as AuthenticatedRequest;
    authenticatedRequest.user = { ...apiUser, id: apiUser.sub };
    return handler(authenticatedRequest);
  }

  // Fall back to JWT verification
  const session = await checkAccessToken(token);

  if (session.reason === 'invalid_token') {
    logger.error('Token verification failed');
    return NextResponse.json({ error: 'Unauthorized', message: 'Invalid or expired token' }, { status: 401 });
  }

  if (session.reason === 'sessions_revoked') {
    logger.warn('Token issued before session invalidation', { userId: session.userId });
    return NextResponse.json({ error: 'Unauthorized', message: 'Session has been revoked' }, { status: 401 });
  }

  // Missing, deleted, pending-approval and rejected accounts are refused the same way
  if (!session.user) {
    logger.error('Session refused: user missing, deleted or not approved', { userId: session.userId, reason: session.reason });
    return NextResponse.json({ error: 'Unauthorized', message: 'User not found' }, { status: 401 });
  }

  const authenticatedRequest = request as AuthenticatedRequest;
  authenticatedRequest.user = session.user;

  return handler(authenticatedRequest);
}

/**
 * Optional authentication for routes that also answer without a session.
 * Returns the caller only when the credential passes the same account checks as
 * `requireAuth` (an API token also needs the endpoint on its allowlist); otherwise
 * null, never a 401. Per-user details must be added only for a non-null caller.
 */
export async function getOptionalAuthUser(request: NextRequest): Promise<AuthenticatedUser | null> {
  const token = extractToken(request);
  if (!token) return null;

  if (token.startsWith(API_TOKEN_PREFIX)) {
    if (!isEndpointAllowed(request.method, request.nextUrl.pathname)) return null;
    const apiUser = await authenticateApiToken(token);
    return apiUser ? { ...apiUser, id: apiUser.sub } : null;
  }

  const session = await checkAccessToken(token);
  if (!session.user) {
    logger.debug('Optional auth: no checked caller', { userId: session.userId, reason: session.reason });
    return null;
  }
  return session.user;
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

/** 503 when the setup state cannot be read (setup/admin guards fail closed). */
function setupStateUnavailable(request: NextRequest, error: unknown): NextResponse {
  logger.error('Could not read setup state; refusing request', {
    path: request.nextUrl?.pathname,
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json(
    { error: 'ServiceUnavailable', message: 'Database is not ready. Try again shortly.' },
    { status: 503 }
  );
}

/**
 * Middleware: Require setup to be incomplete
 * Blocks access to setup-only endpoints after initial setup is finished.
 * Returns 403 if setup is already complete, otherwise invokes the handler.
 */
export async function requireSetupIncomplete(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const config = await prisma.configuration.findUnique({
      where: { key: 'setup_completed' },
    });

    if (config?.value === 'true') {
      logger.warn('Setup endpoint called after setup is complete', {
        path: request.nextUrl.pathname,
      });
      return NextResponse.json(
        {
          error: 'Forbidden',
          message: 'Setup has already been completed',
        },
        { status: 403 }
      );
    }
  } catch (error) {
    // Fail closed: without the setup state we cannot tell whether this endpoint is still allowed
    return setupStateUnavailable(request, error);
  }

  return handler(request);
}

/**
 * Middleware: Require setup incomplete OR authenticated admin
 * For endpoints shared between the setup wizard and admin settings.
 * Allows access during setup (no auth needed) or after setup (admin auth required).
 */
export async function requireSetupIncompleteOrAdmin(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  let setupComplete = false;

  try {
    const config = await prisma.configuration.findUnique({
      where: { key: 'setup_completed' },
    });
    setupComplete = config?.value === 'true';
  } catch (error) {
    // Fail closed: without the setup state we cannot tell whether auth is required
    return setupStateUnavailable(request, error);
  }

  if (!setupComplete) {
    // Setup in progress — allow unauthenticated access (setup wizard)
    return handler(request);
  }

  // Setup is complete — require admin authentication
  return requireAuth(request, (authenticatedReq) =>
    requireAdmin(authenticatedReq, () => handler(request))
  );
}
