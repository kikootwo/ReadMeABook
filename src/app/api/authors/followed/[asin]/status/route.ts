/**
 * Component: Check Follow Status API Route
 * Documentation: documentation/features/followed-authors.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/middleware/auth';
import { isFollowingAuthor } from '@/lib/services/followed-author.service';

/**
 * GET /api/authors/followed/{asin}/status
 * Quick check if the current user follows this author
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  try {
    const currentUser = getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { asin } = await params;
    const following = await isFollowingAuthor(currentUser.sub, asin);

    return NextResponse.json({ success: true, following });
  } catch {
    return NextResponse.json(
      { error: 'FetchError', message: 'Failed to check follow status' },
      { status: 500 }
    );
  }
}
