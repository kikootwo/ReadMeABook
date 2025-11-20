/**
 * BookDate: Record Swipe Action
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

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
        // Check if book already exists in audiobooks table
        let audiobook = await prisma.audiobook.findFirst({
          where: { audibleAsin: recommendation.audnexusAsin },
        });

        // If not, create it
        if (!audiobook) {
          audiobook = await prisma.audiobook.create({
            data: {
              audibleAsin: recommendation.audnexusAsin,
              title: recommendation.title,
              author: recommendation.author,
              narrator: recommendation.narrator,
              description: recommendation.description,
              coverArtUrl: recommendation.coverUrl,
              status: 'requested',
            },
          });
        }

        // Create request (if not already exists)
        const existingRequest = await prisma.request.findFirst({
          where: {
            userId,
            audiobookId: audiobook.id,
          },
        });

        if (!existingRequest) {
          const newRequest = await prisma.request.create({
            data: {
              userId,
              audiobookId: audiobook.id,
              status: 'pending',
              priority: 0,
            },
          });

          console.log(`[BookDate] Created request for "${recommendation.title}"`);

          // Trigger search job (same as regular request creation)
          const { getJobQueueService } = await import('@/lib/services/job-queue.service');
          const jobQueue = getJobQueueService();
          await jobQueue.addSearchJob(newRequest.id, {
            id: audiobook.id,
            title: audiobook.title,
            author: audiobook.author,
          });

          console.log(`[BookDate] Triggered search job for request ${newRequest.id}`);
        }

      } catch (error) {
        console.error('[BookDate] Error creating request:', error);
        // Don't fail the swipe if request creation fails
      }
    }

    return NextResponse.json({
      success: true,
      action,
      markedAsKnown,
    });

  } catch (error: any) {
    console.error('[BookDate] Swipe error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to record swipe' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return requireAuth(req, handler);
}
