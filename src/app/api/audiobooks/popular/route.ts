/**
 * Component: Popular Audiobooks API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';

/**
 * GET /api/audiobooks/popular?limit=20
 * Get popular audiobooks from Audible
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const audibleService = getAudibleService();
    const audiobooks = await audibleService.getPopularAudiobooks(limit);

    return NextResponse.json({
      success: true,
      audiobooks,
      count: audiobooks.length,
    });
  } catch (error) {
    console.error('Failed to get popular audiobooks:', error);
    return NextResponse.json(
      {
        error: 'FetchError',
        message: 'Failed to fetch popular audiobooks',
      },
      { status: 500 }
    );
  }
}
