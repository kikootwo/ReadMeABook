/**
 * Component: Audible Settings API
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { AUDIBLE_REGIONS } from '@/lib/types/audible';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.Settings.Audible');

const VALID_REGIONS = Object.keys(AUDIBLE_REGIONS);

export async function PUT(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const { region } = bodyResult.data;

        // Validate region
        if (!region || !VALID_REGIONS.includes(region)) {
          logger.warn('Invalid region provided', { region });
          return NextResponse.json(
            { success: false, error: `Invalid Audible region. Must be one of: ${VALID_REGIONS.join(', ')}` },
            { status: 400 }
          );
        }

        // Save region to configuration
        const configService = getConfigService();
        await configService.setMany([
          {
            key: 'audible.region',
            value: region,
            category: 'system',
            description: 'Audible region for metadata and search',
          },
        ]);

        // Clear config cache to ensure new region is loaded immediately
        configService.clearCache('audible.region');

        // Force AudibleService to re-initialize with new region
        const audibleService = getAudibleService();
        audibleService.forceReinitialize();

        logger.info('Audible region updated, triggering data refresh', { region });

        // Trigger audible_refresh job to fetch data for new region
        try {
          const jobQueueService = getJobQueueService();
          await jobQueueService.addAudibleRefreshJob();
          logger.info('Audible refresh job triggered');
        } catch (jobError) {
          logger.warn('Failed to trigger audible refresh job', {
            error: jobError instanceof Error ? jobError.message : String(jobError),
          });
          // Don't fail the request if job trigger fails
        }

        return NextResponse.json({
          success: true,
          message: `Audible region set to ${region.toUpperCase()}. Data refresh job triggered.`,
        });
      } catch (error) {
        logger.error('Failed to update Audible region', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { success: false, error: 'Failed to update Audible region settings' },
          { status: 500 }
        );
      }
    });
  });
}
