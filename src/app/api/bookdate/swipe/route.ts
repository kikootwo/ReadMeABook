/**
 * BookDate: Record Swipe Action
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.BookDateSwipe');

async function handler(req: AuthenticatedRequest) {
  try {
    const userId = req.user!.id;
    const body = await req.json();
    const { recommendationId, action, markedAsKnown } = body;

    // Validation
    if (!recommendationId || !action) {
      return NextResponse.json(
        { error: 'recommendationId and action are required' },
        { status: 400 }
      );
    }

    if (!['left', 'right', 'up'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "left", "right", or "up"' },
        { status: 400 }
      );
    }

    // Get recommendation
    const recommendation = await prisma.bookDateRecommendation.findUnique({
      where: { id: recommendationId },
    });

    if (!recommendation || recommendation.userId !== userId) {
      return NextResponse.json(
        { error: 'Recommendation not found or does not belong to user' },
        { status: 404 }
      );
    }

    // Record swipe (keep recommendation in database for undo functionality)
    await prisma.bookDateSwipe.create({
      data: {
        userId,
        recommendationId,
        bookTitle: recommendation.title,
        bookAuthor: recommendation.author,
        action,
        markedAsKnown: markedAsKnown || false,
      },
    });

    // NOTE: We no longer delete the recommendation here.
    // This allows undo to work properly by keeping all the original data.
    // The recommendations endpoint filters out swiped cards.

    // If swiped right and not marked as known, create request
    if (action === 'right' && !markedAsKnown && recommendation.audnexusAsin) {
      try {
        // Fetch full details from Audnexus to get releaseDate, year, and series
        let year: number | undefined;
        let series: string | undefined;
        let seriesPart: string | undefined;
        try {
          const audibleService = getAudibleService();
          const audnexusData = await audibleService.getAudiobookDetails(recommendation.audnexusAsin);

          if (audnexusData?.releaseDate) {
            try {
              const releaseYear = new Date(audnexusData.releaseDate).getFullYear();
              if (!isNaN(releaseYear)) {
                year = releaseYear;
                logger.debug(`Extracted year ${year} from Audnexus releaseDate: ${audnexusData.releaseDate}`);
              }
            } catch (error) {
              logger.warn(`Failed to parse Audnexus releaseDate "${audnexusData.releaseDate}": ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }

          // Extract series data
          if (audnexusData?.series) {
            series = audnexusData.series;
            logger.debug(`Extracted series: ${series}`);
          }
          if (audnexusData?.seriesPart) {
            seriesPart = audnexusData.seriesPart;
            logger.debug(`Extracted seriesPart: ${seriesPart}`);
          }
        } catch (error) {
          logger.warn(`Failed to fetch Audnexus data for ASIN ${recommendation.audnexusAsin}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Check if book already exists in audiobooks table
        let audiobook = await prisma.audiobook.findFirst({
          where: { audibleAsin: recommendation.audnexusAsin },
        });

        // If not, create it with year and series
        if (!audiobook) {
          audiobook = await prisma.audiobook.create({
            data: {
              audibleAsin: recommendation.audnexusAsin,
              title: recommendation.title,
              author: recommendation.author,
              narrator: recommendation.narrator,
              description: recommendation.description,
              coverArtUrl: recommendation.coverUrl,
              year,
              series,
              seriesPart,
              status: 'requested',
            },
          });
          logger.debug(`Created audiobook ${audiobook.id} with year: ${year || 'none'}, series: ${series || 'none'}`);
        } else if (year || series || seriesPart) {
          // Always update year/series if we have them from Audnexus (even if audiobook already has them)
          audiobook = await prisma.audiobook.update({
            where: { id: audiobook.id },
            data: {
              ...(year && { year }),
              ...(series && { series }),
              ...(seriesPart && { seriesPart }),
            },
          });
          logger.debug(`Updated audiobook ${audiobook.id} with year: ${year || 'unchanged'}, series: ${series || 'unchanged'}`);
        }

        // Create request (if not already exists)
        const existingRequest = await prisma.request.findFirst({
          where: {
            userId,
            audiobookId: audiobook.id,
          },
        });

        if (!existingRequest) {
          // Check if request needs approval (same logic as POST /api/requests)
          let needsApproval = false;

          // Fetch user with autoApproveRequests setting
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
              role: true,
              autoApproveRequests: true,
              plexUsername: true,
            },
          });

          if (!user) {
            logger.error('User not found during request creation');
            throw new Error('User not found');
          }

          // Determine if approval is needed
          if (user.role === 'admin') {
            // Admins always auto-approve
            needsApproval = false;
          } else {
            // Check user's personal setting first
            if (user.autoApproveRequests === true) {
              needsApproval = false;
            } else if (user.autoApproveRequests === false) {
              needsApproval = true;
            } else {
              // User setting is null, check global setting
              const globalConfig = await prisma.configuration.findUnique({
                where: { key: 'auto_approve_requests' },
              });
              // Default to true if not configured (backward compatibility)
              const globalAutoApprove = globalConfig === null ? true : globalConfig.value === 'true';
              needsApproval = !globalAutoApprove;
            }
          }

          // Determine initial status
          const initialStatus = needsApproval ? 'awaiting_approval' : 'pending';

          const newRequest = await prisma.request.create({
            data: {
              userId,
              audiobookId: audiobook.id,
              status: initialStatus,
              priority: 0,
            },
          });

          logger.info(`Created request for "${recommendation.title}" with status: ${initialStatus}`);

          // Import job queue service
          const { getJobQueueService } = await import('@/lib/services/job-queue.service');
          const jobQueue = getJobQueueService();

          // Send notification based on approval status
          if (needsApproval) {
            // Request needs approval - send pending notification
            await jobQueue.addNotificationJob(
              'request_pending_approval',
              newRequest.id,
              audiobook.title,
              audiobook.author,
              user.plexUsername || 'Unknown User'
            ).catch((error) => {
              logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
            });
          } else {
            // Request was auto-approved - send approved notification
            await jobQueue.addNotificationJob(
              'request_approved',
              newRequest.id,
              audiobook.title,
              audiobook.author,
              user.plexUsername || 'Unknown User'
            ).catch((error) => {
              logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
            });

            // Trigger search job only if auto-approved
            await jobQueue.addSearchJob(newRequest.id, {
              id: audiobook.id,
              title: audiobook.title,
              author: audiobook.author,
              asin: audiobook.audibleAsin || undefined,
            });

            logger.info(`Triggered search job for request ${newRequest.id}`);
          }
        }

      } catch (error) {
        logger.error('Error creating request', { error: error instanceof Error ? error.message : String(error) });
        // Don't fail the swipe if request creation fails
      }
    }

    return NextResponse.json({
      success: true,
      action,
      markedAsKnown,
    });

  } catch (error: any) {
    logger.error('Swipe error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error.message || 'Failed to record swipe' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return requireAuth(req, handler);
}
