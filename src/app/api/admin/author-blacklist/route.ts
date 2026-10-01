/**
 * Component: Admin Author Blacklist API (list + add)
 * Documentation: documentation/admin-features/author-blacklist.md
 *
 * GET  /api/admin/author-blacklist → { entries, count }
 * POST /api/admin/author-blacklist → body { authorName }; 201 or 409 duplicate
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import {
  addBlockedAuthor,
  listBlockedAuthors,
} from '@/lib/services/author-blacklist.service';
import { z } from 'zod';

const logger = RMABLogger.create('API.Admin.AuthorBlacklist');

const AddAuthorSchema = z.object({
  authorName: z.string().min(1).max(500),
});

/**
 * GET /api/admin/author-blacklist
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, (req: AuthenticatedRequest) =>
    requireAdmin(req, async () => {
      try {
        const entries = await listBlockedAuthors();
        return NextResponse.json({ entries, count: entries.length });
      } catch (error) {
        logger.error('Failed to list author blacklist', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'Failed to list author blacklist' },
          { status: 500 }
        );
      }
    })
  );
}

/**
 * POST /api/admin/author-blacklist
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, (req: AuthenticatedRequest) =>
    requireAdmin(req, async () => {
      try {
        const body = await req.json();
        const { authorName } = AddAuthorSchema.parse(body);

        const result = await addBlockedAuthor({
          authorName,
          createdById: req.user!.id,
        });

        if (!result.wasNew) {
          return NextResponse.json(
            {
              error: 'DuplicateAuthor',
              message: 'This author is already on the blacklist',
              entry: result.entry,
            },
            { status: 409 }
          );
        }

        return NextResponse.json({ entry: result.entry }, { status: 201 });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'ValidationError', details: error.errors },
            { status: 400 }
          );
        }
        logger.error('Failed to add author to blacklist', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'Failed to add author to blacklist' },
          { status: 500 }
        );
      }
    })
  );
}
