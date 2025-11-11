/**
 * Component: New Releases API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';

/**
 * GET /api/audiobooks/new-releases?limit=20
 * Get new release audiobooks from Audible
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const audibleService = getAudibleService();
    const audiobooks = await audibleService.getNewReleases(limit);

    return NextResponse.json({
      success: true,
      audiobooks,
      count: audiobooks.length,
    });
  } catch (error) {
    console.error('Failed to get new releases:', error);
    return NextResponse.json(
      {
        error: 'FetchError',
        message: 'Failed to fetch new releases',
      },
      { status: 500 }
    );
  }
}
