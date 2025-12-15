/**
 * OIDC Callback Handler Endpoint
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthProvider } from '@/lib/services/auth';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const baseUrl = process.env.NEXTAUTH_URL || process.env.BASE_URL || 'http://localhost:3030';

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

    // Authentication successful - set cookies and redirect
    const response = NextResponse.redirect(`${baseUrl}/`);

    if (result.tokens) {
      // Set access token cookie
      response.cookies.set('accessToken', result.tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60, // 1 hour
        path: '/',
      });

      // Set refresh token cookie
      response.cookies.set('refreshToken', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: '/',
      });
    }

    return response;
  } catch (error) {
    console.error('[OIDC Callback] Authentication failed:', error);

    const errorMsg = error instanceof Error ? error.message : 'Authentication failed';
    return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(errorMsg)}`);
  }
}
