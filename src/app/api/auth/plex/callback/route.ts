/**
 * Component: Plex OAuth Callback Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPlexService } from '@/lib/integrations/plex.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { getConfigService } from '@/lib/services/config.service';
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

    // Validate user info
    if (!plexUser || !plexUser.id) {
      console.error('[Plex OAuth] Invalid user info received:', plexUser);
      return NextResponse.json(
        {
          error: 'OAuthError',
          message: 'Failed to get user information from Plex',
          details: 'User ID is missing from Plex response',
        },
        { status: 500 }
      );
    }

    if (!plexUser.username) {
      console.error('[Plex OAuth] Username missing from Plex user:', plexUser);
      return NextResponse.json(
        {
          error: 'OAuthError',
          message: 'Failed to get user information from Plex',
          details: 'Username is missing from Plex response',
        },
        { status: 500 }
      );
    }

    // Convert id to string safely
    const plexIdString = typeof plexUser.id === 'string' ? plexUser.id : plexUser.id.toString();

    // Get configured Plex server settings
    const configService = getConfigService();
    const plexConfig = await configService.getPlexConfig();

    // Verify server is configured
    if (!plexConfig.serverUrl || !plexConfig.authToken) {
      console.error('[Plex OAuth] Server not configured');
      return NextResponse.json(
        {
          error: 'ConfigurationError',
          message: 'Plex server is not configured. Please contact your administrator.',
        },
        { status: 503 }
      );
    }

    // Get server machine identifier for access verification
    let serverMachineId: string;
    try {
      const serverInfo = await plexService.testConnection(plexConfig.serverUrl, plexConfig.authToken);
      if (!serverInfo.success || !serverInfo.info?.machineIdentifier) {
        console.error('[Plex OAuth] Could not get server machine ID');
        return NextResponse.json(
          {
            error: 'ConfigurationError',
            message: 'Server configuration error. Please contact your administrator.',
          },
          { status: 503 }
        );
      }
      serverMachineId = serverInfo.info.machineIdentifier;
      console.log('[Plex OAuth] Server machine ID:', serverMachineId);
    } catch (error) {
      console.error('[Plex OAuth] Failed to get server info:', error);
      return NextResponse.json(
        {
          error: 'ConfigurationError',
          message: 'Could not verify server configuration. Please contact your administrator.',
        },
        { status: 503 }
      );
    }

    // SECURITY: Verify user has access to the configured Plex server
    // This checks if the server appears in the user's list of accessible servers from plex.tv
    // This properly validates shared access permissions
    const hasAccess = await plexService.verifyServerAccess(
      plexConfig.serverUrl,
      serverMachineId,
      authToken
    );

    if (!hasAccess) {
      console.warn('[Plex OAuth] User attempted to authenticate without server access:', {
        plexId: plexIdString,
        username: plexUser.username,
        serverMachineId,
      });
      return NextResponse.json(
        {
          error: 'AccessDenied',
          message: 'You do not have access to this Plex server. Please contact the administrator to share their library with you.',
        },
        { status: 403 }
      );
    }

    console.log('[Plex OAuth] User verified with server access:', plexUser.username);

    // Check if this is the first user (should be promoted to admin)
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;
    const role = isFirstUser ? 'admin' : 'user';

    // Create or update user in database
    const user = await prisma.user.upsert({
      where: { plexId: plexIdString },
      create: {
        plexId: plexIdString,
        plexUsername: plexUser.username,
        plexEmail: plexUser.email || null,
        role,
        avatarUrl: plexUser.thumb || null,
        authToken: encryptionService.encrypt(authToken),
        lastLoginAt: new Date(),
      },
      update: {
        plexUsername: plexUser.username,
        plexEmail: plexUser.email || null,
        avatarUrl: plexUser.thumb || null,
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

    // Detect if this is a browser request (mobile redirect) vs AJAX (desktop popup polling)
    const accept = request.headers.get('accept') || '';
    const isBrowserRequest = accept.includes('text/html');

    // For browser requests (mobile), set cookies and redirect to login page
    if (isBrowserRequest) {
      const response = NextResponse.redirect(new URL('/login?auth=success', request.url));

      // Set tokens in cookies
      response.cookies.set('accessToken', accessToken, {
        httpOnly: false, // Need to be accessible to JavaScript
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60, // 1 hour
        path: '/',
      });

      response.cookies.set('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      });

      // Also set user data as cookie for immediate access
      response.cookies.set('userData', JSON.stringify({
        id: user.id,
        plexId: user.plexId,
        username: user.plexUsername,
        email: user.plexEmail,
        role: user.role,
        avatarUrl: user.avatarUrl,
      }), {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60, // 1 hour
        path: '/',
      });

      return response;
    }

    // Return tokens and user info (for AJAX requests from desktop popup)
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
