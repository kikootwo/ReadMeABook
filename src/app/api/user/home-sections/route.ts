/**
 * Component: User Home Sections API Route
 * Documentation: documentation/features/home-sections.md
 *
 * Per-user configurable home page sections.
 * GET returns sections + next refresh time.
 * PUT saves full section config (delete-and-recreate in transaction).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { boundedArray, errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.User.HomeSections');

const MAX_SECTIONS = 10;

const VALID_SECTION_TYPES = ['popular', 'new_releases', 'category'] as const;

const SectionSchema = z.object({
  sectionType: z.enum(VALID_SECTION_TYPES),
  categoryId: z.string().optional().nullable(),
  categoryName: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0),
});

const PutBodySchema = z.object({
  sections: boundedArray(SectionSchema, MAX_SECTIONS),
});

/**
 * Create default home sections for a new user (Popular + New Releases).
 */
async function ensureDefaultSections(userId: string) {
  const existing = await prisma.userHomeSection.findMany({
    where: { userId },
    select: { id: true },
    take: 1,
  });

  if (existing.length > 0) return;

  await prisma.userHomeSection.createMany({
    data: [
      { userId, sectionType: 'popular', sortOrder: 0 },
      { userId, sectionType: 'new_releases', sortOrder: 1 },
    ],
  });
}

/**
 * GET /api/user/home-sections
 * Returns the user's configured home sections + next scheduled refresh time.
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      await ensureDefaultSections(req.user.id);

      const sections = await prisma.userHomeSection.findMany({
        where: { userId: req.user.id },
        orderBy: { sortOrder: 'asc' },
      });

      // Get next refresh time from scheduled jobs
      let nextRefresh: string | null = null;
      try {
        const scheduledJob = await prisma.scheduledJob.findFirst({
          where: { type: 'audible_refresh', enabled: true },
          select: { nextRun: true },
        });
        nextRefresh = scheduledJob?.nextRun?.toISOString() || null;
      } catch {
        // Non-critical — just omit nextRefresh
      }

      return NextResponse.json({
        success: true,
        sections: sections.map((s) => ({
          id: s.id,
          sectionType: s.sectionType,
          categoryId: s.categoryId,
          categoryName: s.categoryName,
          sortOrder: s.sortOrder,
        })),
        nextRefresh,
      });
    } catch (error) {
      logger.error('Failed to get home sections', {
        error: errorForLog(error),
      });
      return NextResponse.json(
        { error: 'FetchError', message: 'Failed to fetch home sections' },
        { status: 500 }
      );
    }
  });
}

/**
 * PUT /api/user/home-sections
 * Replaces all home sections for the user (delete-and-recreate in transaction).
 * Validates: max 10 sections, no duplicate sections, category sections need categoryId.
 */
export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const body = await req.json();
      const { sections } = PutBodySchema.parse(body);

      // Validate category sections have categoryId
      for (const section of sections) {
        if (section.sectionType === 'category' && !section.categoryId) {
          return NextResponse.json(
            { error: 'ValidationError', message: 'Category sections require a categoryId' },
            { status: 400 }
          );
        }
      }

      // Check for duplicate section types (only one popular, one new_releases, unique categories)
      const seen = new Set<string>();
      for (const section of sections) {
        const key =
          section.sectionType === 'category'
            ? `category:${section.categoryId}`
            : section.sectionType;
        if (seen.has(key)) {
          return NextResponse.json(
            { error: 'ValidationError', message: `Duplicate section: ${key}` },
            { status: 400 }
          );
        }
        seen.add(key);
      }

      const userId = req.user.id;

      // Delete-and-recreate in a transaction
      await prisma.$transaction(async (tx) => {
        await tx.userHomeSection.deleteMany({ where: { userId } });

        if (sections.length > 0) {
          await tx.userHomeSection.createMany({
            data: sections.map((s, idx) => ({
              userId,
              sectionType: s.sectionType,
              categoryId: s.sectionType === 'category' ? s.categoryId : null,
              categoryName: s.sectionType === 'category' ? s.categoryName : null,
              sortOrder: idx,
            })),
          });
        }
      });

      // Return the saved sections
      const saved = await prisma.userHomeSection.findMany({
        where: { userId },
        orderBy: { sortOrder: 'asc' },
      });

      logger.info(`User ${userId} updated home sections (${saved.length} sections)`);

      return NextResponse.json({
        success: true,
        sections: saved.map((s) => ({
          id: s.id,
          sectionType: s.sectionType,
          categoryId: s.categoryId,
          categoryName: s.categoryName,
          sortOrder: s.sortOrder,
        })),
      });
    } catch (error) {
      logger.error('Failed to save home sections', {
        error: errorForLog(error),
      });

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'ValidationError', details: zodIssueDetails(error) },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: 'SaveError', message: 'Failed to save home sections' },
        { status: 500 }
      );
    }
  });
}
