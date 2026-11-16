/**
 * Component: Admin API Token Settings API
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';
import { isTokenApprovalEnabled, TOKEN_APPROVAL_SETTING_KEY } from '@/lib/services/api-token-approval';

const logger = RMABLogger.create('API.Admin.Settings.ApiTokens');

/**
 * GET /api/admin/settings/api-tokens
 * Whether API tokens created for it may approve or deny requests (off by default)
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        return NextResponse.json({ allowRequestApproval: await isTokenApprovalEnabled() });
      } catch (error) {
        logger.error('Failed to fetch API token settings', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Failed to fetch API token settings' }, { status: 500 });
      }
    });
  });
}

/**
 * PATCH /api/admin/settings/api-tokens
 * Body: { allowRequestApproval: boolean }. Off cuts every approval token off at once.
 */
export async function PATCH(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const { allowRequestApproval } = bodyResult.data as { allowRequestApproval?: unknown };

        if (typeof allowRequestApproval !== 'boolean') {
          return NextResponse.json(
            { error: 'Invalid input. allowRequestApproval must be a boolean' },
            { status: 400 }
          );
        }

        await prisma.configuration.upsert({
          where: { key: TOKEN_APPROVAL_SETTING_KEY },
          create: { key: TOKEN_APPROVAL_SETTING_KEY, value: String(allowRequestApproval) },
          update: { value: String(allowRequestApproval) },
        });

        logger.info(`API tokens ${allowRequestApproval ? 'may now' : 'can no longer'} approve requests`, {
          userId: req.user?.sub,
        });

        return NextResponse.json({ allowRequestApproval });
      } catch (error) {
        logger.error('Failed to update API token settings', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Failed to update API token settings' }, { status: 500 });
      }
    });
  });
}
