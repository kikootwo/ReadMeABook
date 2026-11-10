/**
 * Component: Bulk Import Execute API
 * Documentation: documentation/features/bulk-import.md
 *
 * Queues manual imports for multiple audiobooks at once.
 * Reuses the same logic as the single manual import endpoint.
 * Admin-only. Every row is checked the same way before anything is written: an ASIN-shaped
 * ASIN, not repeated in the call, a folder under a root, a book that resolves, not in the
 * library, and no request by any user in IMPORT_BLOCKING_STATUSES.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';
import { AUDIO_EXTENSIONS } from '@/lib/constants/audio-formats';
import { approvalBypassMark, IMPORT_BLOCKING_STATUSES } from '@/lib/constants/request-statuses';
import { BULK_IMPORT_REFUSAL } from '@/lib/constants/bulk-import';
import { asinShaped } from '@/lib/utils/asin';
import { getImportBlock, resolveBookByAsin, type ResolvedBook } from '@/lib/utils/bulk-import-checks';
import { readJsonBody, BULK_IMPORT_JSON_BODY_LIMIT_BYTES } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.BulkImport.Execute');

const BOOKDROP_PATH = '/bookdrop';

/** Statuses a bulk import recycles (a status in IMPORT_BLOCKING_STATUSES refuses the row). */
const RECYCLABLE_STATUSES = ['failed', 'warn', 'cancelled', 'denied'];

const isBlockingStatus = (status: string) => (IMPORT_BLOCKING_STATUSES as readonly string[]).includes(status);

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

        const bodyResult = await readJsonBody(request, { maxBytes: BULK_IMPORT_JSON_BODY_LIMIT_BYTES });
        if (!bodyResult.ok) return bodyResult.response;
        const body = bodyResult.data;
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
        const jobQueue = getJobQueueService();
        const results: ImportResult[] = [];

        // Upper-cased ASIN per row (null when not ASIN-shaped), and how many rows name each one
        const rawAsins = imports.map((entry) => (entry as Partial<ImportItem> | null)?.asin);
        const rowAsins = rawAsins.map((raw) => (typeof raw === 'string' ? asinShaped(raw)?.toUpperCase() ?? null : null));
        const asinCounts = new Map<string, number>();
        for (const a of rowAsins) if (a) asinCounts.set(a, (asinCounts.get(a) ?? 0) + 1);

        for (const [rowIndex, entry] of imports.entries()) {
          const { folderPath, audioFiles: itemAudioFiles } = (entry ?? {}) as ImportItem;
          const asin = rowAsins[rowIndex];

          // A missing or malformed ASIN is refused before any lookup (#588)
          if (!asin) {
            const raw = rawAsins[rowIndex];
            results.push({ folderPath, asin: typeof raw === 'string' ? raw : '', success: false, error: BULK_IMPORT_REFUSAL.invalidAsin });
            continue;
          }
          // Every row naming a repeated ASIN is refused: none of them is the whole book
          if (asinCounts.get(asin)! > 1) {
            results.push({ folderPath, asin, success: false, error: BULK_IMPORT_REFUSAL.duplicate });
            continue;
          }

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

            // Resolve the book: audiobooks row, then Audible cache, then a live lookup
            let book: ResolvedBook | null;
            try {
              book = await resolveBookByAsin(asin);
            } catch {
              results.push({ folderPath, asin, success: false, error: BULK_IMPORT_REFUSAL.lookupFailed });
              continue;
            }
            if (!book) {
              results.push({ folderPath, asin, success: false, error: BULK_IMPORT_REFUSAL.notFound });
              continue;
            }

            // The review screen's own checks, on the server: not in the library, no active request
            const block = await getImportBlock(asin);
            if (block.inLibrary) {
              results.push({ folderPath, asin, success: false, error: BULK_IMPORT_REFUSAL.inLibrary });
              continue;
            }
            if (block.hasActiveRequest) {
              results.push({ folderPath, asin, success: false, error: BULK_IMPORT_REFUSAL.requested });
              continue;
            }

            const audiobookId = book.audiobookId
              ?? (await prisma.audiobook.create({ data: { ...book.newRecord!, status: 'pending' } })).id;

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
              // Requested since the check above
              if (isBlockingStatus(existingRequest.status)) {
                results.push({ folderPath, asin, success: false, error: BULK_IMPORT_REFUSAL.requested });
                continue;
              }

              if (RECYCLABLE_STATUSES.includes(existingRequest.status)) {
                // Another user's unapproved request is recorded as completed without approval
                // (the importing admin's own request never is)
                const bypass = existingRequest.userId !== userId
                  ? approvalBypassMark('bulk_import', existingRequest.status)
                  : null;
                const { count } = await prisma.request.updateMany({
                  where: { id: existingRequest.id, status: existingRequest.status }, // unchanged since it was read
                  data: {
                    status: 'processing',
                    progress: 100,
                    errorMessage: null,
                    importAttempts: 0,
                    autoRerequestCount: 0, // a bulk import restarts the automatic re-request backoff
                    updatedAt: new Date(),
                    ...(bypass ? { approvalBypassedBy: bypass } : {}),
                  },
                });
                if (count !== 1) {
                  results.push({ folderPath, asin, success: false, error: 'Request changed while importing; try again' });
                  continue;
                }
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
