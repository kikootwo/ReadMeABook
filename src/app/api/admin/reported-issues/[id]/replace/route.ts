/**
 * Component: Admin Replace Audiobook API
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { guardTorrentSelection, rejectedSelectionResponse } from '@/lib/services/download-selection-guard';
import { replaceAudiobook, ReportedIssueError } from '@/lib/services/reported-issue.service';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.ReportedIssues.Replace');

const ReplaceSchema = z.object({
  torrent: z.object({
    guid: z.string(),
    title: z.string(),
    size: z.number(),
    seeders: z.number().optional(),
    leechers: z.number().optional(),
    indexer: z.string(),
    indexerId: z.number().optional(),
    downloadUrl: z.string(),
    infoUrl: z.string().optional(),
    publishDate: z.string().transform((str) => new Date(str)),
    infoHash: z.string().optional(),
    format: z.enum(['M4B', 'M4A', 'MP3', 'OTHER']).optional(),
    bitrate: z.string().optional(),
    hasChapters: z.boolean().optional(),
    protocol: z.enum(['torrent', 'usenet']).optional(),
  }),
});

/**
 * POST /api/admin/reported-issues/[id]/replace
 * Atomically replace audiobook content: delete old → create new request → start download → resolve issue
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        if (!req.user) {
          return NextResponse.json(
            { error: 'Unauthorized', message: 'User not authenticated' },
            { status: 401 }
          );
        }

        const { id } = await params;
        const body = await req.json();
        const { torrent } = ReplaceSchema.parse(body);

        const torrentCheck = await guardTorrentSelection(torrent);
        if (!torrentCheck.ok) return rejectedSelectionResponse(torrentCheck.error);

        const result = await replaceAudiobook(id, req.user.id, torrentCheck.value);

        return NextResponse.json({
          success: true,
          request: result.request,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'ValidationError', details: error.errors },
            { status: 400 }
          );
        }

        if (error instanceof ReportedIssueError) {
          return NextResponse.json(
            { error: 'ReplaceError', message: error.message },
            { status: error.statusCode }
          );
        }

        logger.error('Failed to replace audiobook', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'ServerError', message: 'Failed to replace audiobook' },
          { status: 500 }
        );
      }
    });
  });
}
