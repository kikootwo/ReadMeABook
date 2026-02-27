/**
 * Component: Admin Manual Import API
 * Documentation: documentation/features/manual-import.md
 *
 * Triggers the organize_files pipeline for a manually-selected folder.
 * Creates or recycles a request, then queues the organize job.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';
import { AUDIO_EXTENSIONS } from '@/lib/constants/audio-formats';

const logger = RMABLogger.create('API.Admin.ManualImport');

/** Statuses that indicate the request is actively being worked on. */
const ACTIVE_STATUSES = ['searching', 'downloading', 'processing', 'awaiting_import'];

/** Statuses that can be recycled for a new manual import. */
const RECYCLABLE_STATUSES = ['failed', 'warn', 'cancelled', 'denied', 'pending', 'awaiting_search', 'awaiting_approval'];

/**
 * Check if a directory contains at least one audio file (immediate children only).
 */
async function hasAudioFiles(dirPath: string): Promise<{ found: boolean; count: number }> {
  const fs = await import('fs/promises');
  const pathModule = await import('path');

  let count = 0;
  try {
    const children = await fs.readdir(dirPath, { withFileTypes: true });
    for (const child of children) {
      if (child.isFile()) {
        const ext = pathModule.extname(child.name).toLowerCase();
        if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
          count++;
        }
      }
    }
  } catch {
    /* directory not readable */
  }

  return { found: count > 0, count };
}

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const pathModule = await import('path');
        const fs = await import('fs/promises');

        const body = await request.json();
        const { folderPath, asin } = body;
        let { audiobookId } = body;

        // Validate required fields
        if ((!audiobookId && !asin) || !folderPath) {
          return NextResponse.json(
            { error: 'folderPath and either audiobookId or asin are required' },
            { status: 400 }
          );
        }

        // Load allowed roots
        const BOOKDROP_PATH = '/bookdrop';
        const downloadDirConfig = await prisma.configuration.findUnique({
          where: { key: 'download_dir' },
        });
        const mediaDirConfig = await prisma.configuration.findUnique({
          where: { key: 'media_dir' },
        });

        const allowedRoots: string[] = [];
        if (downloadDirConfig?.value) {
          allowedRoots.push(pathModule.resolve(downloadDirConfig.value).replace(/\\/g, '/'));
        }
        if (mediaDirConfig?.value) {
          allowedRoots.push(pathModule.resolve(mediaDirConfig.value).replace(/\\/g, '/'));
        }
        try {
          const bookdropStat = await fs.stat(BOOKDROP_PATH);
          if (bookdropStat.isDirectory()) {
            allowedRoots.push(pathModule.resolve(BOOKDROP_PATH).replace(/\\/g, '/'));
          }
        } catch {
          /* not mounted */
        }

        // Normalize and validate path
        const normalizedPath = pathModule.resolve(folderPath).replace(/\\/g, '/');
        const isAllowed = allowedRoots.some(
          (root) => normalizedPath === root || normalizedPath.startsWith(root + '/')
        );

        if (!isAllowed) {
          return NextResponse.json(
            { error: 'Access denied: path outside allowed directories' },
            { status: 403 }
          );
        }

        // Verify folder exists and is a directory
        try {
          const stat = await fs.stat(normalizedPath);
          if (!stat.isDirectory()) {
            return NextResponse.json(
              { error: 'Path is not a directory' },
              { status: 400 }
            );
          }
        } catch {
          return NextResponse.json(
            { error: 'Directory not found' },
            { status: 404 }
          );
        }

        // Verify folder contains audio files
        const audioCheck = await hasAudioFiles(normalizedPath);
        if (!audioCheck.found) {
          return NextResponse.json(
            { error: 'No audio files found in the selected directory' },
            { status: 400 }
          );
        }

        // Resolve audiobook by ASIN if audiobookId not provided
        if (!audiobookId && asin) {
          const byAsin = await prisma.audiobook.findFirst({
            where: { audibleAsin: asin },
          });
          if (byAsin) {
            audiobookId = byAsin.id;
          } else {
            // Create audiobook record from Audible cache if available
            const cached = await prisma.audibleCache.findUnique({
              where: { asin },
            });
            if (cached) {
              const newBook = await prisma.audiobook.create({
                data: {
                  audibleAsin: asin,
                  title: cached.title,
                  author: cached.author,
                  coverArtUrl: cached.coverArtUrl,
                  narrator: cached.narrator,
                  status: 'pending',
                },
              });
              audiobookId = newBook.id;
              logger.info(`Created audiobook record from cache for ASIN ${asin}: ${newBook.id}`);
            } else {
              return NextResponse.json(
                { error: 'Audiobook not found for the given ASIN' },
                { status: 404 }
              );
            }
          }
        }

        // Verify audiobook exists
        const audiobook = await prisma.audiobook.findUnique({
          where: { id: audiobookId },
        });

        if (!audiobook) {
          return NextResponse.json(
            { error: 'Audiobook not found' },
            { status: 404 }
          );
        }

        // Check for existing requests
        const existingRequest = await prisma.request.findFirst({
          where: {
            audiobookId,
            type: 'audiobook',
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
        });

        let requestId: string;

        if (existingRequest) {
          // Check if already in an active state
          if (ACTIVE_STATUSES.includes(existingRequest.status)) {
            return NextResponse.json(
              { error: 'This audiobook is already being processed' },
              { status: 409 }
            );
          }

          // Recycle the existing request
          if (RECYCLABLE_STATUSES.includes(existingRequest.status) ||
              existingRequest.status === 'downloaded' ||
              existingRequest.status === 'available') {
            await prisma.request.update({
              where: { id: existingRequest.id },
              data: {
                status: 'processing',
                progress: 100,
                errorMessage: null,
                importAttempts: 0,
                updatedAt: new Date(),
              },
            });
            requestId = existingRequest.id;
            logger.info(`Recycled existing request ${requestId} for manual import`);
          } else {
            // Unknown status - create new
            const newRequest = await prisma.request.create({
              data: {
                userId: req.user!.id,
                audiobookId,
                type: 'audiobook',
                status: 'processing',
                progress: 100,
              },
            });
            requestId = newRequest.id;
            logger.info(`Created new request ${requestId} (existing had status: ${existingRequest.status})`);
          }
        } else {
          // No existing request - create one
          const newRequest = await prisma.request.create({
            data: {
              userId: req.user!.id,
              audiobookId,
              type: 'audiobook',
              status: 'processing',
              progress: 100,
            },
          });
          requestId = newRequest.id;
          logger.info(`Created new request ${requestId} for manual import`);
        }

        // Queue organize_files job
        const jobQueue = getJobQueueService();
        await jobQueue.addOrganizeJob(requestId, audiobookId, normalizedPath);

        logger.info(`Manual import queued: request=${requestId}, path=${normalizedPath}, audioFiles=${audioCheck.count}`);

        return NextResponse.json({
          success: true,
          requestId,
          message: `Import started for ${audiobook.title}`,
        });
      } catch (error) {
        logger.error('Manual import failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Manual import failed' },
          { status: 500 }
        );
      }
    });
  });
}
