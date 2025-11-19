/**
 * Component: Plex OAuth Login Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPlexService } from '@/lib/integrations/plex.service';

/**
 * POST /api/auth/plex/login
 * Initiates Plex OAuth flow by requesting a PIN
 */
export async function POST(request: NextRequest) {
  try {
    const plexService = getPlexService();

    // Request PIN from Plex
    const pin = await plexService.requestPin();

    // Construct callback URL from the request's origin
    // This allows the app to work when accessed via localhost, local IP, or domain
    const origin = request.headers.get('origin') || request.headers.get('referer') || 'http://localhost:3030';
    const baseUrl = origin.replace(/\/$/, ''); // Remove trailing slash if present
    const callbackUrl = `${baseUrl}/api/auth/plex/callback`;

    // Generate OAuth URL with pinId
    const authUrl = plexService.getOAuthUrl(pin.code, pin.id, callbackUrl);

    return NextResponse.json({
      success: true,
      pinId: pin.id,
      code: pin.code,
      authUrl,
    });
  } catch (error) {
    console.error('Failed to initiate Plex OAuth:', error);
    return NextResponse.json(
      {
        error: 'OAuthError',
        message: 'Failed to initiate Plex authentication',
      },
      { status: 500 }
    );
  }
}
