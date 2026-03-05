/**
 * Component: User API Token Routes (self-service)
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { checkApiTokenCreateRateLimit } from '@/lib/utils/apiTokenRateLimit';
import { MAX_TOKENS_PER_USER } from '@/lib/constants/api-tokens';
import { generateApiToken } from '@/lib/utils/api-token';
import { z } from 'zod';

const logger = RMABLogger.create('API.User.ApiTokens');

const CreateTokenSchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().nullable().optional(),
});

/**
 * GET /api/user/api-tokens
 * List the current user's own API tokens
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      const tokens = await prisma.apiToken.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
      });

      const sanitized = tokens.map((t) => ({
        id: t.id,
        name: t.name,
        tokenPrefix: t.tokenPrefix,
        role: t.role,
        lastUsedAt: t.lastUsedAt,
        expiresAt: t.expiresAt,
        createdAt: t.createdAt,
      }));

      return NextResponse.json({ tokens: sanitized });
    } catch (error) {
      logger.error('Failed to list user API tokens', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Failed to list API tokens' }, { status: 500 });
    }
  });
}

/**
 * POST /api/user/api-tokens
 * Create a token for the current user with their own role. Returns full token ONCE.
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
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
      const { name, expiresAt } = CreateTokenSchema.parse(body);

      // Look up the user's actual role from the database
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { role: true },
      });

      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Enforce per-user token cap (count only active, non-expired tokens)
      const activeTokenCount = await prisma.apiToken.count({
        where: {
          userId: req.user!.id,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      });

      if (activeTokenCount >= MAX_TOKENS_PER_USER) {
        return NextResponse.json(
          { error: `Token limit reached. Users may have at most ${MAX_TOKENS_PER_USER} active API tokens.` },
          { status: 403 }
        );
      }

      // Generate the token
      const { fullToken, tokenHash, tokenPrefix } = generateApiToken();

      const apiToken = await prisma.apiToken.create({
        data: {
          name,
          tokenHash,
          tokenPrefix,
          role: user.role, // Always the user's own role
          createdById: req.user!.id,
          userId: req.user!.id, // Token acts as the current user
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });

      logger.info('User API token created', { tokenId: apiToken.id, name, userId: req.user!.id });

      return NextResponse.json({
        token: {
          id: apiToken.id,
          name: apiToken.name,
          tokenPrefix: apiToken.tokenPrefix,
          role: apiToken.role,
          expiresAt: apiToken.expiresAt,
          createdAt: apiToken.createdAt,
        },
        fullToken,
      }, { status: 201 });
    } catch (error) {
      logger.error('Failed to create user API token', { error: error instanceof Error ? error.message : String(error) });

      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 });
      }

      return NextResponse.json({ error: 'Failed to create API token' }, { status: 500 });
    }
  });
}
