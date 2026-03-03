/**
 * Component: User API Token Routes (self-service)
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { z } from 'zod';

const logger = RMABLogger.create('API.User.ApiTokens');

const API_TOKEN_PREFIX = 'rmab_';
const TOKEN_RANDOM_BYTES = 32;

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
