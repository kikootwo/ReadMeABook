/**
 * Component: Audiobook Details API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';

/**
 * GET /api/audiobooks/[asin]
 * Get detailed information for a specific audiobook
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  try {
    const { asin } = await params;

    if (!asin || asin.length !== 10) {
      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Valid ASIN is required',
        },
        { status: 400 }
      );
    }

    const audibleService = getAudibleService();
    const audiobook = await audibleService.getAudiobookDetails(asin);

    if (!audiobook) {
      return NextResponse.json(
        {
          error: 'NotFound',
          message: 'Audiobook not found',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      audiobook,
    });
  } catch (error) {
    console.error('Failed to get audiobook details:', error);
    return NextResponse.json(
      {
        error: 'FetchError',
        message: 'Failed to fetch audiobook details',
      },
      { status: 500 }
    );
  }
}
