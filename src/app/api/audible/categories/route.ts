/**
 * Component: Audible Categories API Route
 * Documentation: documentation/features/home-sections.md
 *
 * Live Audible catalog categories (top level + sub-categories) for the home section config modal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Audible.Categories');

/**
 * GET /api/audible/categories
 * Returns Audible's top-level categories, each with its sub-categories:
 * { categories: [{ id, name, subcategories: [{ id, name, parentId }] }] }
 * One catalog request per call (/1.0/catalog/categories?categories_num_levels=2).
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (_req: AuthenticatedRequest) => {
    try {
      const { getAudibleService } = await import('@/lib/integrations/audible.service');
      const audibleService = getAudibleService();
      const categories = await audibleService.getCategories();

      return NextResponse.json({
        success: true,
        categories,
      });
    } catch (error) {
      logger.error('Failed to fetch categories', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'FetchError', message: 'Failed to fetch Audible categories' },
        { status: 500 }
      );
    }
  });
}
