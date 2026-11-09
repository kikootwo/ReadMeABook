/**
 * Component: Admin Users API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody, AUTH_JSON_BODY_LIMIT_BYTES } from '@/lib/utils/request-body';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import {
  createLocalAccount,
  isLocalLoginEnabled,
  USERNAME_TAKEN_ERROR,
} from '@/lib/services/auth/local-account';

const logger = RMABLogger.create('API.Admin.Users');

const AddUserSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const LOCAL_LOGIN_OFF_MESSAGE = 'Local login is not enabled, so local users cannot be added';

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const users = await prisma.user.findMany({
          where: {
            deletedAt: null, // Exclude soft-deleted users
          },
          select: {
            id: true,
            plexId: true,
            plexUsername: true,
            plexEmail: true,
            role: true,
            isSetupAdmin: true,
            authProvider: true,
            avatarUrl: true,
            createdAt: true,
            updatedAt: true,
            lastLoginAt: true,
            autoApproveRequests: true,
            interactiveSearchAccess: true,
            downloadAccess: true,
            loginTokenHash: true,
            _count: {
              select: {
                requests: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        return NextResponse.json({
          users: users.map(({ loginTokenHash, ...u }) => ({
            ...u,
            hasLoginToken: loginTokenHash !== null,
          })),
          localLoginEnabled: await isLocalLoginEnabled(),
        });
      } catch (error) {
        logger.error('Failed to fetch users', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to fetch users' },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * POST /api/admin/users
 * Adds a local user (role user, already approved) with a starting password, whatever
 * the self-registration and approval settings are. Admin sessions only: the route is
 * not on the API-token allowlist. The password is never logged or returned.
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        if (!(await isLocalLoginEnabled())) {
          return NextResponse.json({ error: 'Forbidden', message: LOCAL_LOGIN_OFF_MESSAGE }, { status: 403 });
        }

        const bodyResult = await readJsonBody(req, { maxBytes: AUTH_JSON_BODY_LIMIT_BYTES });
        if (!bodyResult.ok) return bodyResult.response;
        const { username, password } = AddUserSchema.parse(bodyResult.data);

        const created = await createLocalAccount(
          { username, password },
          { role: 'user', isSetupAdmin: false, registrationStatus: 'approved' }
        );
        if (!created.ok) {
          const taken = created.error === USERNAME_TAKEN_ERROR;
          return NextResponse.json(
            { error: taken ? 'Conflict' : 'ValidationError', message: created.error },
            { status: taken ? 409 : 400 }
          );
        }

        const { user } = created;
        logger.info('Local user added', { adminId: req.user?.id, userId: user.id, username: user.plexUsername });
        return NextResponse.json(
          { user: { id: user.id, plexUsername: user.plexUsername, role: user.role, authProvider: user.authProvider } },
          { status: 201 }
        );
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'ValidationError', message: 'Username and password are required', details: zodIssueDetails(error) },
            { status: 400 }
          );
        }
        if (error instanceof SyntaxError) {
          return NextResponse.json(
            { error: 'ValidationError', message: 'Username and password are required' },
            { status: 400 }
          );
        }
        logger.error('Failed to add local user', { error: errorForLog(error) });
        return NextResponse.json({ error: 'Failed to add user', message: 'Failed to add user' }, { status: 500 });
      }
    });
  });
}
