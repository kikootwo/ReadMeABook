/**
 * OIDC Callback Handler Endpoint
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthProvider } from '@/lib/services/auth';
import { getBaseUrl } from '@/lib/utils/url';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const baseUrl = getBaseUrl();

  // Handle OAuth errors from provider
  if (error) {
    const errorMsg = errorDescription || error;
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(errorMsg)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent('Missing authorization code or state')}`);
  }

  try {
    // Get OIDC auth provider
    const authProvider = await getAuthProvider('oidc');

    // Handle callback
    const result = await authProvider.handleCallback({ code, state });

    if (!result.success) {
      // Check if approval is required
      if (result.requiresApproval) {
        return NextResponse.redirect(`${baseUrl}/login?pending=approval`);
      }

      // Authentication failed
      return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(result.error || 'Authentication failed')}`);
    }

    // Authentication successful - prepare user data
    if (!result.tokens || !result.user) {
      return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent('Authentication data missing')}`);
    }

    // Prepare auth data to pass via URL hash (works across all browsers)
    const authData = {
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      user: {
        id: result.user.id,
        plexId: result.user.id, // Use id as plexId for consistency
        username: result.user.username,
        email: result.user.email,
        role: result.user.isAdmin ? 'admin' : 'user',
        avatarUrl: result.user.avatarUrl,
      },
    };
    const authDataEncoded = encodeURIComponent(JSON.stringify(authData));

    // Prepare user data for cookie
    const userDataJson = JSON.stringify(authData.user);

    // Determine redirect URL based on first login status
    let redirectUrl: string;
    if (result.isFirstLogin) {
      // First login - redirect to initializing page to show job progress
      redirectUrl = `${baseUrl}/setup/initializing#authData=${authDataEncoded}`;
      console.log('[OIDC Callback] First login detected - redirecting to initializing page');
    } else {
      // Normal login - redirect to login page with auth success
      redirectUrl = `${baseUrl}/login?auth=success#authData=${authDataEncoded}`;
    }

    // Return HTML page with cookies set and JavaScript redirect with hash
    // This ensures tokens are accessible to frontend via both cookies and URL hash
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Login Successful</title>
        </head>
        <body>
          <p>Login successful. Redirecting...</p>
          <script>
            // Use JavaScript redirect with hash parameter for compatibility
            // Hash params aren't sent to server, so tokens stay client-side
            setTimeout(() => {
              window.location.href = '${redirectUrl}';
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

    // Set tokens in cookies (httpOnly: false so JavaScript can read them)
    response.cookies.set('accessToken', result.tokens.accessToken, {
      httpOnly: false, // Need to be accessible to JavaScript
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60, // 1 hour
      path: '/',
    });

    response.cookies.set('refreshToken', result.tokens.refreshToken, {
      httpOnly: true, // Keep refresh token secure
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

    return response;
  } catch (error) {
    console.error('[OIDC Callback] Authentication failed:', error);

    const errorMsg = error instanceof Error ? error.message : 'Authentication failed';
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(errorMsg)}`);
  }
}
