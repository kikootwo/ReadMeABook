/**
 * Component: Admin Indexer Options Settings API
 * Documentation: documentation/settings-pages.md
 *
 * Manages indexer-wide behavioral options that are not tied to a specific
 * indexer connection (e.g., auto-search behavior toggles).
 *
 * Read contract (consumed by background auto-search workers):
 *   - Config key: `indexer.skip_unreleased`
 *   - Category:   `indexer`
 *   - Value:      string `'true'` | `'false'`
 *   - Default:    ON when the key is missing OR its value is anything other
 *                 than the exact string `'false'`. In other words, skipping
 *                 unreleased books is enabled unless the admin explicitly
 *                 opted out. Workers MUST match this contract:
 *
 *                   const skip = (await config.get('indexer.skip_unreleased')) !== 'false';
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.IndexerOptions');

const CONFIG_KEY = 'indexer.skip_unreleased';

/**
 * GET /api/admin/settings/indexer-options
 * Returns the current indexer-wide options.
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const configService = getConfigService();
        const value = await configService.get(CONFIG_KEY);

        // Default ON: missing or any value other than 'false' is treated as enabled.
        const skipUnreleased = value !== 'false';
        const preferredLanguage = await configService.getPreferredLanguage();
        const languagePenaltyScore = await configService.getLanguagePenaltyScore();

        return NextResponse.json({
          skipUnreleased,
          preferredLanguage,
          languagePenaltyScore,
        });
      } catch (error) {
        logger.error('Failed to fetch indexer options', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'Failed to fetch indexer options' },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * PUT /api/admin/settings/indexer-options
 * Persists indexer-wide options. Body: { skipUnreleased?: boolean, preferredLanguage?: string, languagePenaltyScore?: number }
 */
export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const { skipUnreleased, preferredLanguage, languagePenaltyScore } = body ?? {};
        const configService = getConfigService();
        const updates: any[] = [];

        if (typeof skipUnreleased === 'boolean') {
          updates.push({
            key: CONFIG_KEY,
            value: String(skipUnreleased),
            category: 'indexer',
            description:
              'Skip auto-searches for books with future release dates',
          });
        }

        if (preferredLanguage && ['en', 'de', 'es', 'fr', 'all'].includes(String(preferredLanguage).toLowerCase())) {
          updates.push({
            key: 'search.preferred_language',
            value: String(preferredLanguage).toLowerCase(),
            category: 'search',
            description: 'Preferred search language (en, de, es, fr, all)',
          });
        }

        if (languagePenaltyScore !== undefined) {
          const score = parseInt(String(languagePenaltyScore), 10);
          if (!isNaN(score) && score >= 0) {
            updates.push({
              key: 'search.language_penalty_score',
              value: String(score),
              category: 'search',
              description: 'Language penalty score for non-matching search results',
            });
          }
        }

        if (updates.length > 0) {
          await configService.setMany(updates);
          configService.clearCache();
        }

        logger.info('Indexer options updated', { skipUnreleased, preferredLanguage, languagePenaltyScore });

        return NextResponse.json({
          success: true,
          message: 'Indexer options updated successfully',
        });
      } catch (error) {
        logger.error('Failed to update indexer options', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : 'Failed to update indexer options',
          },
          { status: 500 }
        );
      }
    });
  });
}
