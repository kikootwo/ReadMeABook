/**
 * Component: Unfollow Author API Route
 * Documentation: documentation/features/followed-authors.md
 */

import { NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { unfollowAuthor } from '@/lib/services/followed-author.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Authors.Unfollow');

/**
 * DELETE /api/authors/followed/{asin}
 * Unfollow an author
 */
export async function DELETE(
  request: AuthenticatedRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  return requireAuth(request, async (req) => {
    try {
      const userId = req.user!.id;
      const { asin } = await params;

      if (!asin || typeof asin !== 'string') {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Author ASIN is required' },
          { status: 400 }
        );
      }

      const deleted = await unfollowAuthor(userId, asin);

      if (!deleted) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Author not followed' },
          { status: 404 }
        );
      }

      logger.info(`User ${userId} unfollowed author ASIN: ${asin}`);

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Failed to unfollow author', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'UnfollowError', message: 'Failed to unfollow author' },
        { status: 500 }
      );
    }
  });
}
