/**
 * Component: Followed Authors API Route (List + Follow)
 * Documentation: documentation/features/followed-authors.md
 */

import { NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { followAuthor, getFollowedAuthors } from '@/lib/services/followed-author.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Authors.Followed');

/**
 * GET /api/authors/followed
 * List all followed authors for the current user
 */
export async function GET(request: AuthenticatedRequest) {
  return requireAuth(request, async (req) => {
    try {
      const userId = req.user!.id;
      const authors = await getFollowedAuthors(userId);

      return NextResponse.json({
        success: true,
        authors,
        count: authors.length,
      });
    } catch (error) {
      logger.error('Failed to list followed authors', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'FetchError', message: 'Failed to list followed authors' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/authors/followed
 * Follow a new author
 * Body: { asin: string, name: string, image?: string }
 */
export async function POST(request: AuthenticatedRequest) {
  return requireAuth(request, async (req) => {
    try {
      const userId = req.user!.id;
      const body = await req.json();

      const { asin, name, image } = body;

      if (!asin || typeof asin !== 'string') {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Author ASIN is required' },
          { status: 400 }
        );
      }

      if (!name || typeof name !== 'string') {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Author name is required' },
          { status: 400 }
        );
      }

      const followed = await followAuthor(userId, { asin, name, image });

      logger.info(`User ${userId} followed author "${name}" (${asin})`);

      return NextResponse.json(
        { success: true, author: followed },
        { status: 201 }
      );
    } catch (error) {
      logger.error('Failed to follow author', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'FollowError', message: 'Failed to follow author' },
        { status: 500 }
      );
    }
  });
}
