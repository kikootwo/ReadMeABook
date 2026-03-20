/**
 * Component: Bulk Import Execute API
 * Documentation: documentation/features/bulk-import.md
 *
 * Queues manual imports for multiple audiobooks at once.
 * Reuses the same logic as the single manual import endpoint.
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';
import { AUDIO_EXTENSIONS } from '@/lib/constants/audio-formats';
import { getAudibleService } from '@/lib/integrations/audible.service';

const logger = RMABLogger.create('API.Admin.BulkImport.Execute');

const BOOKDROP_PATH = '/bookdrop';

/** Statuses that indicate the request is actively being worked on. */
const ACTIVE_STATUSES = ['searching', 'downloading', 'processing', 'awaiting_import'];

/** Statuses that can be recycled for a new manual import. */
const RECYCLABLE_STATUSES = [
  'failed', 'warn', 'cancelled', 'denied', 'pending',
  'awaiting_search', 'awaiting_approval',
];

interface ImportItem {
  folderPath: string;
  asin: string;
  audioFiles?: string[]; // Specific files to import (from scanner grouping)
}

interface ImportResult {
  folderPath: string;
  asin: string;
  success: boolean;
  requestId?: string;
  error?: string;
}

/** Check if a directory contains audio files. */
async function hasAudioFiles(dirPath: string): Promise<boolean> {
  const fs = await import('fs/promises');
  const pathModule = await import('path');

  try {
    const children = await fs.readdir(dirPath, { withFileTypes: true });
    return children.some(
      (child) =>
        child.isFile() &&
        (AUDIO_EXTENSIONS as readonly string[]).includes(
          pathModule.extname(child.name).toLowerCase()
        )
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const pathModule = await import('path');
        const fs = await import('fs/promises');

        const body = await request.json();
        const { imports } = body as { imports: ImportItem[] };

        if (!imports || !Array.isArray(imports) || imports.length === 0) {
          return NextResponse.json(
            { error: 'imports array is required and must not be empty' },
            { status: 400 }
          );
        }

        // Load allowed roots
        const [downloadDirConfig, mediaDirConfig] = await Promise.all([
          prisma.configuration.findUnique({ where: { key: 'download_dir' } }),
          prisma.configuration.findUnique({ where: { key: 'media_dir' } }),
        ]);

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

        const userId = req.user!.id;
        const audibleService = getAudibleService();
        const jobQueue = getJobQueueService();
        const results: ImportResult[] = [];

        for (const item of imports) {
          const { folderPath, asin, audioFiles: itemAudioFiles } = item;

          try {
            // Validate path
            const normalizedPath = pathModule.resolve(folderPath).replace(/\\/g, '/');
            const isAllowed = allowedRoots.some(
              (root) => normalizedPath === root || normalizedPath.startsWith(root + '/')
            );

            if (!isAllowed) {
              results.push({ folderPath, asin, success: false, error: 'Path outside allowed directories' });
              continue;
            }

            // Verify directory exists
            try {
              const stat = await fs.stat(normalizedPath);
              if (!stat.isDirectory()) {
                results.push({ folderPath, asin, success: false, error: 'Not a directory' });
                continue;
              }
            } catch {
              results.push({ folderPath, asin, success: false, error: 'Directory not found' });
              continue;
            }

            // Verify audio files: if specific files provided, trust the scanner;
            // otherwise fall back to folder-level check
            if (!itemAudioFiles || itemAudioFiles.length === 0) {
              const hasAudio = await hasAudioFiles(normalizedPath);
              if (!hasAudio) {
                results.push({ folderPath, asin, success: false, error: 'No audio files' });
                continue;
              }
            }

            // Resolve or create audiobook record
            let audiobookId: string;
            let existingBook = await prisma.audiobook.findFirst({
              where: { audibleAsin: asin },
            });

            if (existingBook) {
              audiobookId = existingBook.id;
            } else {
              // Try Audible cache, then Audnexus
              const cached = await prisma.audibleCache.findUnique({ where: { asin } });
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
              } else {
                try {
                  const liveData = await audibleService.getAudiobookDetails(asin);
                  if (!liveData) {
                    results.push({ folderPath, asin, success: false, error: 'Audiobook not found' });
                    continue;
                  }
                  const newBook = await prisma.audiobook.create({
                    data: {
                      audibleAsin: asin,
                      title: liveData.title,
                      author: liveData.author,
                      coverArtUrl: liveData.coverArtUrl,
                      narrator: liveData.narrator,
                      series: liveData.series,
                      seriesPart: liveData.seriesPart,
                      seriesAsin: liveData.seriesAsin,
                      year: liveData.releaseDate
                        ? new Date(liveData.releaseDate).getFullYear() || undefined
                        : undefined,
                      status: 'pending',
                    },
                  });
                  audiobookId = newBook.id;
                } catch {
                  results.push({ folderPath, asin, success: false, error: 'Failed to fetch audiobook details' });
                  continue;
                }
              }
            }

            // Check for existing request and recycle or create
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
              if (ACTIVE_STATUSES.includes(existingRequest.status)) {
                results.push({ folderPath, asin, success: false, error: 'Already being processed' });
                continue;
              }

              if (
                RECYCLABLE_STATUSES.includes(existingRequest.status) ||
                existingRequest.status === 'downloaded' ||
                existingRequest.status === 'available'
              ) {
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
              } else {
                const newReq = await prisma.request.create({
                  data: {
                    userId,
                    audiobookId,
                    type: 'audiobook',
                    status: 'processing',
                    progress: 100,
                  },
                });
                requestId = newReq.id;
              }
            } else {
              const newReq = await prisma.request.create({
                data: {
                  userId,
                  audiobookId,
                  type: 'audiobook',
                  status: 'processing',
                  progress: 100,
                },
              });
              requestId = newReq.id;
            }

            // Queue organize_files job (pass specific files if scanner provided them)
            await jobQueue.addOrganizeJob(
              requestId,
              audiobookId,
              normalizedPath,
              undefined,
              false,
              itemAudioFiles && itemAudioFiles.length > 0 ? itemAudioFiles : undefined
            );

            results.push({ folderPath, asin, success: true, requestId });
            logger.info(`Bulk import queued: asin=${asin}, path=${normalizedPath}, request=${requestId}`);
          } catch (itemError) {
            logger.error(`Bulk import item failed: asin=${asin}, path=${folderPath}`, {
              error: itemError instanceof Error ? itemError.message : String(itemError),
            });
            results.push({
              folderPath,
              asin,
              success: false,
              error: itemError instanceof Error ? itemError.message : 'Import failed',
            });
          }
        }

        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        logger.info(`Bulk import execute complete: ${succeeded} queued, ${failed} failed`);

        return NextResponse.json({
          success: true,
          results,
          summary: { total: results.length, succeeded, failed },
        });
      } catch (error) {
        logger.error('Bulk import execute failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Bulk import failed' },
          { status: 500 }
        );
      }
    });
  });
}
