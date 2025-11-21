/**
 * Component: Plex Home Users API
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPlexService } from '@/lib/integrations/plex.service';

/**
 * GET /api/auth/plex/home-users
 * Get list of Plex Home profiles for authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const authToken = request.headers.get('X-Plex-Token');

    if (!authToken) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Missing authentication token',
        },
        { status: 401 }
      );
    }

    const plexService = getPlexService();
    const users = await plexService.getHomeUsers(authToken);

    return NextResponse.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error('Failed to get home users:', error);
    return NextResponse.json(
      {
        error: 'ServerError',
        message: 'Failed to fetch home users',
      },
      { status: 500 }
    );
  }
}
