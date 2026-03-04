/**
 * Component: Admin API Token Management Routes
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { checkApiTokenCreateRateLimit } from '@/lib/utils/apiTokenRateLimit';
import { z } from 'zod';

const logger = RMABLogger.create('API.Admin.ApiTokens');

const API_TOKEN_PREFIX = 'rmab_';
const TOKEN_RANDOM_BYTES = 32;

const CreateTokenSchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().nullable().optional(),
  userId: z.string().uuid().optional(), // Admin can specify which user the token acts as
  role: z.enum(['admin', 'user']).optional(), // Admin can override the token role
});

/**
 * GET /api/admin/api-tokens
 * List ALL API tokens across all users
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, (req: AuthenticatedRequest) =>
    requireAdmin(req, async () => {
      try {
        const tokens = await prisma.apiToken.findMany({
          include: {
            createdBy: {
              select: { id: true, plexUsername: true },
            },
            tokenUser: {
              select: { id: true, plexUsername: true, role: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        const sanitized = tokens.map((t) => ({
          id: t.id,
          name: t.name,
          tokenPrefix: t.tokenPrefix,
          role: t.role,
          createdBy: t.createdBy.plexUsername,
          createdById: t.createdBy.id,
          tokenUser: t.tokenUser.plexUsername,
          tokenUserId: t.tokenUser.id,
          lastUsedAt: t.lastUsedAt,
          expiresAt: t.expiresAt,
          createdAt: t.createdAt,
        }));

        return NextResponse.json({ tokens: sanitized });
      } catch (error) {
        logger.error('Failed to list API tokens', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Failed to list API tokens' }, { status: 500 });
      }
    })
  );
}

/**
 * POST /api/admin/api-tokens
 * Create a new API token. Admin can optionally specify userId and role.
 * Returns the full token ONCE.
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, (req: AuthenticatedRequest) =>
    requireAdmin(req, async () => {
      try {
        const rateLimit = checkApiTokenCreateRateLimit(req.user!.id);
        if (!rateLimit.allowed) {
          return NextResponse.json(
            { error: 'Too many API token create attempts. Please try again later.' },
            {
              status: 429,
              headers: {
                'Retry-After': String(rateLimit.retryAfterSeconds),
              },
            }
          );
        }

        const body = await req.json();
        const { name, expiresAt, userId, role } = CreateTokenSchema.parse(body);

        // Determine target user (defaults to the admin themselves)
        const targetUserId = userId || req.user!.id;

        // Verify the target user exists
        const targetUser = await prisma.user.findUnique({
          where: { id: targetUserId },
          select: { id: true, role: true, plexUsername: true },
        });

        if (!targetUser) {
          return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
        }

        // Determine token role (defaults to target user's role)
        const tokenRole = role || targetUser.role;

        // Generate the token
        const randomPart = crypto.randomBytes(TOKEN_RANDOM_BYTES).toString('hex');
        const fullToken = `${API_TOKEN_PREFIX}${randomPart}`;
        const tokenHash = crypto.createHash('sha256').update(fullToken).digest('hex');
        const tokenPrefix = fullToken.substring(0, 12); // "rmab_" + 7 chars

        const apiToken = await prisma.apiToken.create({
          data: {
            name,
            tokenHash,
            tokenPrefix,
            role: tokenRole,
            createdById: req.user!.id,
            userId: targetUserId,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
          },
        });

        logger.info('Admin API token created', {
          tokenId: apiToken.id,
          name,
          createdBy: req.user!.username,
          targetUser: targetUser.plexUsername,
          role: tokenRole,
        });

        return NextResponse.json({
          token: {
            id: apiToken.id,
            name: apiToken.name,
            tokenPrefix: apiToken.tokenPrefix,
            role: apiToken.role,
            expiresAt: apiToken.expiresAt,
            createdAt: apiToken.createdAt,
          },
          // Full token is returned ONLY on creation
          fullToken,
        }, { status: 201 });
      } catch (error) {
        logger.error('Failed to create API token', { error: error instanceof Error ? error.message : String(error) });

        if (error instanceof z.ZodError) {
          return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
        }

        return NextResponse.json({ error: 'Failed to create API token' }, { status: 500 });
      }
    })
  );
}
