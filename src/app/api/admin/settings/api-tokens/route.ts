/**
 * Component: Admin API Token Settings API (allow API tokens to approve requests)
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * Not on the API token allowlist: only a signed-in admin can change it, never a token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { isTokenApprovalEnabled, TOKEN_APPROVAL_SETTING_KEY } from '@/lib/services/api-token-approval';
import { z } from 'zod';

const logger = RMABLogger.create('API.Admin.Settings.ApiTokens');

const UpdateSchema = z.object({ allowRequestApproval: z.boolean() });

/**
 * GET /api/admin/settings/api-tokens
 * Whether admins' approval tokens may approve requests (false unless set)
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, (req: AuthenticatedRequest) =>
    requireAdmin(req, async () => {
      try {
        return NextResponse.json({ allowRequestApproval: await isTokenApprovalEnabled() });
      } catch (error) {
        logger.error('Failed to read the API token settings', { error: errorForLog(error) });
        return NextResponse.json({ error: 'Failed to read the API token settings' }, { status: 500 });
      }
    })
  );
}

/**
 * PATCH /api/admin/settings/api-tokens
 * Body: { allowRequestApproval: boolean }. Off stops every approval token at once.
 */
export async function PATCH(request: NextRequest) {
  return requireAuth(request, (req: AuthenticatedRequest) =>
    requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const parsed = UpdateSchema.safeParse(bodyResult.data);
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'allowRequestApproval must be true or false', details: zodIssueDetails(parsed.error) },
            { status: 400 }
          );
        }

        const value = parsed.data.allowRequestApproval ? 'true' : 'false';
        await prisma.configuration.upsert({
          where: { key: TOKEN_APPROVAL_SETTING_KEY },
          create: { key: TOKEN_APPROVAL_SETTING_KEY, value },
          update: { value },
        });

        logger.warn('API token request approval setting changed', {
          allowRequestApproval: parsed.data.allowRequestApproval,
          adminId: req.user?.sub,
        });
        return NextResponse.json({ allowRequestApproval: parsed.data.allowRequestApproval });
      } catch (error) {
        logger.error('Failed to update the API token settings', { error: errorForLog(error) });
        return NextResponse.json({ error: 'Failed to update the API token settings' }, { status: 500 });
      }
    })
  );
}
