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
 *
 * Also manages the automatic-search minimum ranking thresholds:
 *   - `indexer.min_quality_score`        (audiobook auto-search, default 50)
 *   - `indexer.min_quality_score_ebook`  (e-book auto-search, default 50)
 *   Values are integers 0-100. Missing/invalid resolves to 50. Consumed by the
 *   search-indexers / search-ebook processors. The title/author match gate
 *   applies independently, so a value of 0 still rejects wrong books.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { parseMinQualityScore } from '@/lib/utils/min-quality-score';

const logger = RMABLogger.create('API.Admin.Settings.IndexerOptions');

const CONFIG_KEY = 'indexer.skip_unreleased';
const MIN_SCORE_KEY = 'indexer.min_quality_score';
const MIN_SCORE_EBOOK_KEY = 'indexer.min_quality_score_ebook';

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

        const minQualityScore = parseMinQualityScore(await configService.get(MIN_SCORE_KEY));
        const minQualityScoreEbook = parseMinQualityScore(await configService.get(MIN_SCORE_EBOOK_KEY));

        return NextResponse.json({ skipUnreleased, minQualityScore, minQualityScoreEbook });
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
 * Validate an optional minimum-score field: when present it must be an integer 0-100.
 * Returns an error message string if invalid, otherwise null.
 */
function validateScore(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
    return `${field} must be an integer between 0 and 100`;
  }
  return null;
}

/**
 * PUT /api/admin/settings/indexer-options
 * Persists indexer-wide options.
 * Body: { skipUnreleased: boolean, minQualityScore?: number, minQualityScoreEbook?: number }
 */
export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const { skipUnreleased, minQualityScore, minQualityScoreEbook } = body ?? {};

        if (typeof skipUnreleased !== 'boolean') {
          return NextResponse.json(
            { error: 'skipUnreleased must be a boolean' },
            { status: 400 }
          );
        }

        const scoreError =
          validateScore(minQualityScore, 'minQualityScore') ??
          validateScore(minQualityScoreEbook, 'minQualityScoreEbook');
        if (scoreError) {
          return NextResponse.json({ error: scoreError }, { status: 400 });
        }

        const configService = getConfigService();
        const updates = [
          {
            key: CONFIG_KEY,
            value: String(skipUnreleased),
            category: 'indexer',
            description:
              'Skip auto-searches for books with future release dates',
          },
        ];

        if (minQualityScore !== undefined) {
          updates.push({
            key: MIN_SCORE_KEY,
            value: String(minQualityScore),
            category: 'indexer',
            description:
              'Minimum ranking score (0-100) for automatic audiobook searches',
          });
        }
        if (minQualityScoreEbook !== undefined) {
          updates.push({
            key: MIN_SCORE_EBOOK_KEY,
            value: String(minQualityScoreEbook),
            category: 'indexer',
            description:
              'Minimum ranking score (0-100) for automatic e-book searches',
          });
        }

        await configService.setMany(updates);

        // Explicitly clear cache for the keys after write. `setMany` already
        // does this, but we make it visible here to guarantee fresh reads
        // by any sibling service that has cached the values.
        configService.clearCache(CONFIG_KEY);
        configService.clearCache(MIN_SCORE_KEY);
        configService.clearCache(MIN_SCORE_EBOOK_KEY);

        logger.info('Indexer options updated', {
          skipUnreleased,
          minQualityScore,
          minQualityScoreEbook,
        });

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
