/**
 * Component: Admin User Discord Link API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody, AUTH_JSON_BODY_LIMIT_BYTES } from '@/lib/utils/request-body';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { DISCORD_USER_ID_PATTERN } from '@/lib/services/discord/discord-actor';
import { isUniqueConstraintError } from '@/lib/services/goodreads-shelf-match';

const logger = RMABLogger.create('API.Admin.Users.Discord');

const INVALID_ID_MESSAGE = 'Discord user ID must be 15 to 20 digits, not starting with 0, or empty to unlink';

/** `discordUserId`: a Discord user ID (trimmed), or null / empty to unlink. Other fields are ignored. */
const DiscordLinkSchema = z.object({
  discordUserId: z
    .string()
    .trim()
    .refine((value) => value === '' || DISCORD_USER_ID_PATTERN.test(value), { message: INVALID_ID_MESSAGE })
    .nullable(),
});

/**
 * PUT /api/admin/users/[id]/discord
 * Links a Discord user ID to a user, or unlinks it. Admins may link their own account
 * (only this field is written). Admin sessions only: not on the API-token allowlist.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;
        const bodyResult = await readJsonBody(req, { maxBytes: AUTH_JSON_BODY_LIMIT_BYTES });
        if (!bodyResult.ok) return bodyResult.response;
        const { discordUserId: parsed } = DiscordLinkSchema.parse(bodyResult.data);
        const discordUserId = parsed || null;

        // One conditional write: a missing or deleted user matches no row
        const updated = await prisma.user.updateMany({
          where: { id, deletedAt: null },
          data: { discordUserId },
        });
        if (updated.count === 0) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        logger.info(discordUserId ? 'Discord account linked' : 'Discord account unlinked', {
          userId: id,
          adminId: req.user?.sub,
          discordUserId,
        });
        return NextResponse.json({ user: { id, discordUserId } });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'ValidationError', message: INVALID_ID_MESSAGE, details: zodIssueDetails(error) },
            { status: 400 }
          );
        }
        if (error instanceof SyntaxError) {
          return NextResponse.json({ error: 'ValidationError', message: INVALID_ID_MESSAGE }, { status: 400 });
        }
        // P2002 on the unique index: the Discord ID is linked to another user
        if (isUniqueConstraintError(error)) {
          return NextResponse.json(
            { error: 'Conflict', message: 'This Discord account is already linked to another user' },
            { status: 409 }
          );
        }
        logger.error('Failed to update Discord link', { error: errorForLog(error) });
        return NextResponse.json({ error: 'Failed to update Discord link' }, { status: 500 });
      }
    });
  });
}
