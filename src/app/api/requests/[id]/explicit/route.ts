/**
 * Component: Mark a request Explicit (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * PUT /api/requests/[id]/explicit {explicit: boolean}. The requester or an admin may set the mark;
 * only an admin may clear it. Setting it on a book already in the library (Audiobookshelf mode)
 * turns on the item's Explicit flag at once; an admin's repeat mark retries that write (a
 * requester's repeat is a plain 200: the scan repair retries). Clearing writes nothing to
 * Audiobookshelf. Not on the API token allowlist (UI only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';
import { zodIssueDetails } from '@/lib/utils/zod-validation';
import { getConfigService } from '@/lib/services/config.service';
import { markItemExplicitNow } from '@/lib/services/audiobookshelf/explicit-flag';

const logger = RMABLogger.create('API.RequestExplicit');

const BodySchema = z.object({ explicit: z.boolean() }).strict();

const json = (status: number, error: string, message: string) => NextResponse.json({ error, message }, { status });

/** Shown when Audiobookshelf wasn't updated: short, by viewer; the full reason goes to the log. */
const NOT_UPDATED = {
  requester: "Saved. Audiobookshelf wasn't updated; an admin needs to check it.",
  guard: "Saved. Audiobookshelf wasn't updated: its API user can't see explicit content.",
  write: "Saved. Audiobookshelf wasn't updated; the next library scan tries again.",
};

/** "N other requests for this book are still marked", counting only requests that can still flag it. */
async function otherMarksLine(requestId: string, audiobookId: string): Promise<string | null> {
  const others = await prisma.request.count({
    where: {
      audiobookId, id: { not: requestId }, type: 'audiobook', deletedAt: null, explicit: true,
      status: { notIn: ['cancelled', 'denied'] },
    },
  });
  if (others === 0) return null;
  const which = others === 1 ? '1 other request for this book is still marked' : `${others} other requests for this book are still marked`;
  return `${which}; remove ${others === 1 ? 'that mark' : 'those marks'} too, or ReadMeABook marks the book explicit again once delivered.`;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) return json(401, 'Unauthorized', 'User not authenticated');
      const { id } = await params;
      const bodyResult = await readJsonBody<unknown>(req, { fallback: null }); // missing or bad JSON → 400 below
      if (!bodyResult.ok) return bodyResult.response;
      const parsed = BodySchema.safeParse(bodyResult.data);
      if (!parsed.success) {
        return NextResponse.json({ error: 'ValidationError', details: zodIssueDetails(parsed.error) }, { status: 400 });
      }
      const { explicit } = parsed.data;

      const record = await prisma.request.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true, userId: true, type: true, status: true, explicit: true, audiobookId: true,
          audiobook: { select: { title: true, absItemId: true } },
        },
      });
      if (!record) return json(404, 'NotFound', 'Request not found');
      const isAdmin = req.user.role === 'admin';
      if (record.userId !== req.user.id && !isAdmin) return json(403, 'Forbidden', 'You do not have access to this request');
      if (record.type !== 'audiobook') return json(400, 'InvalidRequest', 'Only audiobook requests can be marked explicit');
      if (!explicit && !isAdmin) return json(403, 'Forbidden', 'Only an admin can remove the explicit mark');

      if (record.explicit !== explicit) {
        const { count } = await prisma.request.updateMany({ where: { id, deletedAt: null }, data: { explicit } });
        if (count === 0) return json(404, 'NotFound', 'Request not found'); // replaced or deleted since the read
        logger.info(`${explicit ? 'Marked' : 'Removed the explicit mark from'} request ${id} ("${record.audiobook.title}")${explicit ? ' explicit' : ''} by ${req.user.username} (${isAdmin ? 'admin' : 'requester'})`);
      }

      const isABS = (await getConfigService().getBackendMode()) === 'audiobookshelf';
      const available = record.status === 'available';
      let message: string | undefined;
      let absUpdated: boolean | undefined;

      // A requester's repeat mark writes nothing (the scan repair is the retry); an admin's retries
      // the write: ABS answers "not updated" when the flag is already on
      if (explicit && isABS && available && record.audiobook.absItemId && (isAdmin || !record.explicit)) {
        const outcome = await markItemExplicitNow(record.audiobook.absItemId);
        absUpdated = outcome.written;
        if (!outcome.written) {
          logger.warn(`Request ${id} is marked explicit; Audiobookshelf item ${record.audiobook.absItemId} wasn't updated: ${outcome.reason}`);
          message = isAdmin ? NOT_UPDATED[outcome.cause] : NOT_UPDATED.requester;
        }
      } else if (!explicit && isABS) {
        const lines = [
          ...(available ? ['Mark removed. If the book is marked explicit in Audiobookshelf, change it there.'] : []),
          ...[await otherMarksLine(id, record.audiobookId)].filter((l): l is string => l !== null),
        ];
        if (lines.length > 0) message = lines.join(' ');
      }

      return NextResponse.json({
        success: true,
        request: { id, explicit },
        ...(absUpdated !== undefined ? { absUpdated } : {}),
        ...(message ? { message } : {}),
      });
    } catch (error) {
      logger.error('Failed to update the explicit mark', { error: error instanceof Error ? error.message : String(error) });
      return json(500, 'UpdateError', 'Failed to update the explicit mark');
    }
  });
}
