/**
 * Component: Hardcover Shelf Delete Route
 * Documentation: documentation/backend/services/hardcover-sync.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { fetchHardcoverList } from '@/lib/services/hardcover-api.service';
import { z } from 'zod';

const logger = RMABLogger.create('API.HardcoverShelves');

const UpdateHardcoverSchema = z.object({
  listId: z.string().min(1, 'List ID is required').optional(),
  apiToken: z.string().optional(),
  forceSync: z.boolean().optional(),
});

/**
 * DELETE /api/user/hardcover-shelves/[id]
 * Remove a Hardcover shelf subscription (ownership check)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { id } = await params;

      const shelf = await prisma.hardcoverShelf.findUnique({
        where: { id },
      });

      if (!shelf) {
        return NextResponse.json({ error: 'List not found' }, { status: 404 });
      }

      // Ownership check
      if (shelf.userId !== req.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      await prisma.hardcoverShelf.delete({ where: { id } });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Failed to delete list', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'Failed to delete list' },
        { status: 500 },
      );
    }
  });
}

/**
 * PATCH /api/user/hardcover-shelves/[id]
 * Update a Hardcover shelf subscription
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { id } = await params;
      const shelf = await prisma.hardcoverShelf.findUnique({ where: { id } });

      if (!shelf) {
        return NextResponse.json({ error: 'List not found' }, { status: 404 });
      }

      if (shelf.userId !== req.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const body = await request.json();
      const { listId, apiToken, forceSync } = UpdateHardcoverSchema.parse(body);

      const updateData: { listId?: string; apiToken?: string; lastSyncAt?: null; bookCount?: null; coverUrls?: null } = {};
      let needsResync = !!forceSync;

      let cleanedToken: string | undefined;
      if (apiToken && apiToken.trim() !== '') {
        cleanedToken = apiToken.trim().toLowerCase().startsWith('bearer ')
          ? apiToken.trim().slice(7).trim()
          : apiToken.trim();
      }

      const newListId = (listId && listId !== shelf.listId) ? listId : undefined;

      // Validate token/listId by fetching the list before saving
      if (cleanedToken || newListId) {
        const encryptionService = getEncryptionService();
        let tokenToTest = cleanedToken || shelf.apiToken;
        if (!cleanedToken) {
          try {
            if (encryptionService.isEncryptedFormat(shelf.apiToken)) {
              tokenToTest = encryptionService.decrypt(shelf.apiToken);
            }
          } catch {
            // Decryption failed, fall back to raw token
          }
        }
        const listIdToTest = newListId || shelf.listId;

        try {
          await fetchHardcoverList(tokenToTest, listIdToTest);
        } catch (error) {
          return NextResponse.json(
            {
              error: 'InvalidHardcoverList',
              message: `Could not fetch the Hardcover list. Check your Token and List ID: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
            { status: 400 },
          );
        }

        if (newListId) {
          updateData.listId = newListId;
          needsResync = true;
        }
        if (cleanedToken) {
          updateData.apiToken = encryptionService.encrypt(cleanedToken);
          needsResync = true;
        }
      }

      // If we are forcing a resync due to a change, clear metadata
      if (needsResync) {
        updateData.lastSyncAt = null;
        updateData.bookCount = null;
        updateData.coverUrls = null;
      }

      const updated = await prisma.hardcoverShelf.update({
        where: { id },
        data: updateData,
      });

      if (needsResync) {
        try {
          const jobQueue = getJobQueueService();
          await jobQueue.addSyncShelvesJob(undefined, updated.id, 'hardcover', 0);
        } catch (error) {
          logger.error('Failed to trigger immediate list sync', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return NextResponse.json({ success: true, shelf: updated });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'ValidationError', details: error.errors }, { status: 400 });
      }
      logger.error('Failed to update list', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ error: 'Failed to update list' }, { status: 500 });
    }
  });
}
