/**
 * Component: Plex OAuth Login Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextResponse } from 'next/server';
import { getPlexService } from '@/lib/integrations/plex.service';

/**
 * POST /api/auth/plex/login
 * Initiates Plex OAuth flow by requesting a PIN
 */
export async function POST() {
  try {
    const plexService = getPlexService();

    // Request PIN from Plex
    const pin = await plexService.requestPin();

    // Generate OAuth URL with pinId
    const authUrl = plexService.getOAuthUrl(pin.code, pin.id);

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
