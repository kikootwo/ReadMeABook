/**
 * Component: Admin Manual Import API
 * Documentation: documentation/features/manual-import.md
 *
 * Triggers the organize_files pipeline for a manually-selected folder.
 * Creates or recycles a request of the import's type (audiobook or ebook),
 * then queues the organize job.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { readJsonBody } from '@/lib/utils/request-body';
import { resolveManualSelection } from '@/lib/utils/disc-layout-fs';
import { claimImportRequest, resolveEbookSelection, resolveImportTarget } from '@/lib/services/manual-import.service';

const logger = RMABLogger.create('API.Admin.ManualImport');

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const pathModule = await import('path');
        const fs = await import('fs/promises');

        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const body = bodyResult.data;
        const { folderPath, asin, cleanupSource, selectedFiles, requestId: targetRequestId, requestType } = body;
        let { audiobookId } = body;

        // Validate selectedFiles if provided
        if (selectedFiles !== undefined) {
          if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) {
            return NextResponse.json(
              { error: 'selectedFiles must be a non-empty array of file names' },
              { status: 400 }
            );
          }
          if (!selectedFiles.every((f: unknown) => typeof f === 'string')) {
            return NextResponse.json(
              { error: 'selectedFiles must contain only strings' },
              { status: 400 }
            );
          }
        }

        // Validate required fields
        if ((!audiobookId && !asin && !targetRequestId) || !folderPath) {
          return NextResponse.json(
            { error: 'folderPath and one of audiobookId, asin or requestId are required' },
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

        // The import's type: the named request's own type (a disagreeing requestType is a 400)
        const target = await resolveImportTarget(targetRequestId, requestType);
        if (!target.ok) {
          return NextResponse.json({ error: target.error }, { status: target.status });
        }
        const { kind, stored } = target;
        if (stored) {
          if (audiobookId && audiobookId !== stored.audiobookId) {
            return NextResponse.json({ error: 'The request belongs to another book' }, { status: 400 });
          }
          audiobookId = stored.audiobookId;
        }

        // Verify the selected files against the type: an ebook import takes ebook files in the
        // folder only; an audiobook import single files or disc-folder files of a multi-disc
        // book, else the folder's own audio, else its disc folders' audio
        const selection = kind === 'ebook'
          ? await resolveEbookSelection(normalizedPath, selectedFiles)
          : await resolveManualSelection(normalizedPath, selectedFiles, allowedRoots);
        if (!selection.ok) {
          return NextResponse.json({ error: selection.error }, { status: selection.status });
        }
        const validatedFiles = selection.files;

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
              // Not in DB — fetch live from Audnexus and create a record
              try {
                const audibleService = getAudibleService();
                const liveData = await audibleService.getAudiobookDetails(asin);
                if (liveData) {
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
                  logger.info(`Created audiobook record from Audnexus for ASIN ${asin}: ${newBook.id}`);
                } else {
                  return NextResponse.json(
                    { error: 'Audiobook not found for the given ASIN' },
                    { status: 404 }
                  );
                }
              } catch (audnexusError) {
                logger.error(`Failed to fetch ASIN ${asin} from Audnexus: ${audnexusError instanceof Error ? audnexusError.message : String(audnexusError)}`);
                return NextResponse.json(
                  { error: 'Audiobook not found for the given ASIN' },
                  { status: 404 }
                );
              }
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
        if (stored && asin && audiobook.audibleAsin && audiobook.audibleAsin !== asin) {
          return NextResponse.json({ error: 'The request belongs to another book' }, { status: 400 });
        }

        // Enrich missing series/year data from Audnexus (mirrors request-creator.service.ts)
        if (audiobook.audibleAsin && (!audiobook.series || !audiobook.year)) {
          try {
            const audibleService = getAudibleService();
            const audnexusData = await audibleService.getAudiobookDetails(audiobook.audibleAsin);

            if (audnexusData) {
              const updates: Record<string, any> = {};

              if (!audiobook.series && audnexusData.series) {
                updates.series = audnexusData.series;
              }
              if (!audiobook.seriesPart && audnexusData.seriesPart) {
                updates.seriesPart = audnexusData.seriesPart;
              }
              if (!audiobook.seriesAsin && audnexusData.seriesAsin) {
                updates.seriesAsin = audnexusData.seriesAsin;
              }
              if (!audiobook.year && audnexusData.releaseDate) {
                const releaseYear = new Date(audnexusData.releaseDate).getFullYear();
                if (!isNaN(releaseYear)) {
                  updates.year = releaseYear;
                }
              }
              if (!audiobook.narrator && audnexusData.narrator) {
                updates.narrator = audnexusData.narrator;
              }

              if (Object.keys(updates).length > 0) {
                await prisma.audiobook.update({
                  where: { id: audiobook.id },
                  data: updates,
                });
                logger.info(`Enriched audiobook metadata from Audnexus for ASIN ${audiobook.audibleAsin}`, updates);
              }
            }
          } catch (error) {
            // Non-fatal: series enrichment failure should never block the import
            logger.warn(`Failed to enrich metadata from Audnexus for ASIN ${audiobook.audibleAsin}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // Recycle or create the request of this type; an ebook import never touches the audiobook request
        const claim = await claimImportRequest({ kind, audiobookId, userId: req.user!.id, stored });
        if (!claim.ok) {
          return NextResponse.json({ error: claim.error }, { status: claim.status });
        }
        const { requestId } = claim;
        logger.info(`${claim.recycled ? 'Recycled existing' : 'Created new'} ${kind} request ${requestId} for manual import`);

        // Queue organize_files job (the processor branches on the request's type)
        const jobQueue = getJobQueueService();
        await jobQueue.addOrganizeJob(
          requestId,
          audiobookId,
          normalizedPath,
          undefined,
          cleanupSource === true,
          validatedFiles.length > 0 ? validatedFiles : undefined
        );

        logger.info(`Manual import queued: request=${requestId}, type=${kind}, path=${normalizedPath}, files=${validatedFiles.length || 'whole folder'}`);

        return NextResponse.json({
          success: true,
          requestId,
          message: `Import started for ${audiobook.title}${kind === 'ebook' ? ' (ebook)' : ''}`,
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
