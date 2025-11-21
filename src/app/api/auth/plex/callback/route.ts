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

    // Get server machine identifier from stored configuration
    // Note: machineIdentifier is stored during setup/settings configuration
    const serverMachineId = plexConfig.machineIdentifier;

    if (!serverMachineId) {
      console.error('[Plex OAuth] machineIdentifier not found in configuration');
      return NextResponse.json(
        {
          error: 'ConfigurationError',
          message: 'Server configuration incomplete. Please contact your administrator to re-configure Plex settings.',
        },
        { status: 503 }
      );
    }

    console.log('[Plex OAuth] Using stored machineIdentifier:', serverMachineId);

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

    // Check for Plex Home profiles
    const homeUsers = await plexService.getHomeUsers(authToken);
    console.log('[Plex OAuth] Found home users:', homeUsers.length);

    // If multiple home users exist, redirect to profile selection
    // (Only show selection if there's more than just the main account)
    if (homeUsers.length > 1) {
      console.log('[Plex OAuth] Account has multiple home profiles, redirecting to profile selection');

      // Detect if this is a browser request (mobile redirect) vs AJAX (desktop popup polling)
      const accept = request.headers.get('accept') || '';
      const isBrowserRequest = accept.includes('text/html');

      if (isBrowserRequest) {
        // For browser requests (mobile), construct redirect URL with session data
        const host = request.headers.get('host') || 'localhost:3030';
        const protocol = request.headers.get('x-forwarded-proto') ||
                        (process.env.NODE_ENV === 'production' ? 'https' : 'http');
        const selectProfileUrl = `${protocol}://${host}/auth/select-profile?pinId=${pinId}`;

        console.log('[Plex OAuth] Redirecting to profile selection:', selectProfileUrl);

        // Return HTML page with JavaScript to store token in sessionStorage and redirect
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Select Profile</title>
            </head>
            <body>
              <p>Loading profiles...</p>
              <script>
                // Store main account token in session storage for profile selection page
                sessionStorage.setItem('plex_main_token', '${authToken}');
                // Redirect to profile selection
                window.location.href = '${selectProfileUrl}';
              </script>
            </body>
          </html>
        `;

        return new NextResponse(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
          },
        });
      } else {
        // For AJAX requests (desktop popup), return JSON with redirect instruction
        return NextResponse.json({
          success: true,
          authorized: true,
          requiresProfileSelection: true,
          redirectUrl: `/auth/select-profile?pinId=${pinId}`,
          mainAccountToken: authToken, // Client will store this temporarily
          homeUsers: homeUsers.length,
        });
      }
    }

    console.log('[Plex OAuth] Single profile or no additional profiles, continuing with main account authentication');

    // No home users - continue with normal authentication flow using main account
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
      // Construct the redirect URL from headers (not request.url which may be 0.0.0.0)
      const host = request.headers.get('host') || 'localhost:3030';
      const protocol = request.headers.get('x-forwarded-proto') ||
                      (process.env.NODE_ENV === 'production' ? 'https' : 'http');
      const redirectUrl = `${protocol}://${host}/login?auth=success`;

      console.log('[Plex OAuth] Setting cookies for mobile auth...');
      console.log('[Plex OAuth] Redirect URL:', redirectUrl);

      // Prepare user data
      const userDataJson = JSON.stringify({
        id: user.id,
        plexId: user.plexId,
        username: user.plexUsername,
        email: user.plexEmail,
        role: user.role,
        avatarUrl: user.avatarUrl,
      });
      console.log('[Plex OAuth] Setting userData cookie:', userDataJson);

      // Prepare auth data to pass via URL hash (fallback for mobile browsers that block cookies)
      const authData = {
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
      };
      const authDataEncoded = encodeURIComponent(JSON.stringify(authData));

      // Return HTML page with cookies set and JavaScript redirect with hash
      // This ensures cookies are properly set before redirecting
      // The hash also provides a fallback for mobile browsers that block cookies on redirects
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Login Successful</title>
          </head>
          <body>
            <p>Login successful. Redirecting...</p>
            <script>
              // Use JavaScript redirect with hash parameter for mobile compatibility
              // Hash params aren't sent to server, so tokens stay client-side
              setTimeout(() => {
                window.location.href = '${redirectUrl}#authData=${authDataEncoded}';
              }, 100);
            </script>
          </body>
        </html>
      `;

      const response = new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
        },
      });

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

      response.cookies.set('userData', encodeURIComponent(userDataJson), {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60, // 1 hour
        path: '/',
      });

      console.log('[Plex OAuth] Cookies set successfully, returning HTML redirect to:', redirectUrl);
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
