/**
 * Component: Audiobook Search API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';

/**
 * GET /api/audiobooks/search?q=query&page=1
 * Search for audiobooks on Audible
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || searchParams.get('query');
    const page = parseInt(searchParams.get('page') || '1', 10);

    if (!query) {
      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Search query is required',
        },
        { status: 400 }
      );
    }

    const audibleService = getAudibleService();
    const results = await audibleService.search(query, page);

    return NextResponse.json({
      success: true,
      ...results,
    });
  } catch (error) {
    console.error('Failed to search audiobooks:', error);
    return NextResponse.json(
      {
        error: 'SearchError',
        message: 'Failed to search audiobooks',
      },
      { status: 500 }
    );
  }
}
