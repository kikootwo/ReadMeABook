/**
 * Component: Bulk Import Scan API (SSE)
 * Documentation: documentation/features/bulk-import.md
 *
 * Streams audiobook discovery and Audible matching results via Server-Sent Events.
 * Admin-only. Validates path is within allowed roots.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { discoverAudiobooks } from '@/lib/utils/bulk-import-scanner';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';

const logger = RMABLogger.create('API.Admin.BulkImport.Scan');

const BOOKDROP_PATH = '/bookdrop';
const AUDIBLE_SEARCH_DELAY_MS = 1500;

/** Load allowed root directories from configuration. */
async function getAllowedRoots(): Promise<string[]> {
  const pathModule = await import('path');
  const fs = await import('fs/promises');

  const [downloadDirConfig, mediaDirConfig] = await Promise.all([
    prisma.configuration.findUnique({ where: { key: 'download_dir' } }),
    prisma.configuration.findUnique({ where: { key: 'media_dir' } }),
  ]);

  const roots: string[] = [];
  if (downloadDirConfig?.value) {
    roots.push(pathModule.resolve(downloadDirConfig.value).replace(/\\/g, '/'));
  }
  if (mediaDirConfig?.value) {
    roots.push(pathModule.resolve(mediaDirConfig.value).replace(/\\/g, '/'));
  }
  try {
    const stat = await fs.stat(BOOKDROP_PATH);
    if (stat.isDirectory()) {
      roots.push(pathModule.resolve(BOOKDROP_PATH).replace(/\\/g, '/'));
    }
  } catch {
    /* not mounted */
  }

  return roots;
}

/** Check if a path is within allowed roots. */
function isPathAllowed(normalizedPath: string, roots: string[]): boolean {
  return roots.some(
    (root) => normalizedPath === root || normalizedPath.startsWith(root + '/')
  );
}

/** Delay helper for rate limiting. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      const pathModule = await import('path');
      const fs = await import('fs/promises');

      let body: any;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      const { rootPath } = body;
      if (!rootPath) {
        return NextResponse.json({ error: 'rootPath is required' }, { status: 400 });
      }

      // Validate path
      const allowedRoots = await getAllowedRoots();
      const normalizedPath = pathModule.resolve(rootPath).replace(/\\/g, '/');

      if (!isPathAllowed(normalizedPath, allowedRoots)) {
        return NextResponse.json(
          { error: 'Access denied: path outside allowed directories' },
          { status: 403 }
        );
      }

      // Verify directory exists
      try {
        const stat = await fs.stat(normalizedPath);
        if (!stat.isDirectory()) {
          return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
      }

      logger.info(`Bulk import scan started: ${normalizedPath}`);

      // Create SSE stream
      const encoder = new TextEncoder();
      const abortController = new AbortController();

      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: any) => {
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
              );
            } catch {
              /* stream closed */
            }
          };

          try {
            // Phase 1: Discover audiobook folders
            const audiobooks = await discoverAudiobooks(
              normalizedPath,
              (progress) => {
                send('progress', progress);
              },
              abortController.signal
            );

            if (audiobooks.length === 0) {
              send('complete', { audiobooks: [], message: 'No audiobooks found' });
              controller.close();
              return;
            }

            send('discovery_complete', {
              totalFound: audiobooks.length,
              message: `Found ${audiobooks.length} audiobook folders`,
            });

            // Phase 2: Match each audiobook against Audible
            const audibleService = getAudibleService();
            const results: any[] = [];

            for (let i = 0; i < audiobooks.length; i++) {
              if (abortController.signal.aborted) break;

              const book = audiobooks[i];

              send('matching', {
                current: i + 1,
                total: audiobooks.length,
                folderName: book.folderName,
                searchTerm: book.searchTerm,
              });

              let match: any = null;
              let inLibrary = false;
              let hasActiveRequest = false;

              try {
                // If the scanner extracted an ASIN directly from the folder name,
                // use a direct ASIN lookup (Audnexus API) — more reliable than a
                // keyword text search. Fall back to text search if the lookup fails.
                if (book.extractedAsin) {
                  try {
                    const asinResult = await audibleService.lookupAsinFast(book.extractedAsin);
                    if (asinResult) {
                      match = asinResult;
                    }
                  } catch {
                    /* ASIN lookup failed — fall through to text search */
                  }
                }

                if (!match) {
                  const searchResult = await audibleService.search(book.searchTerm);
                  if (searchResult.results.length > 0) {
                    match = searchResult.results[0];
                  }
                }

                if (match) {

                  // Check library availability
                  const plexMatch = await findPlexMatch({
                    asin: match.asin,
                    title: match.title,
                    author: match.author,
                    narrator: match.narrator,
                  });
                  inLibrary = plexMatch !== null;

                  // Check for active requests
                  if (!inLibrary) {
                    const activeRequest = await prisma.request.findFirst({
                      where: {
                        audiobook: { audibleAsin: match.asin },
                        type: 'audiobook',
                        status: {
                          in: [
                            'pending', 'searching', 'downloading', 'processing',
                            'awaiting_search', 'awaiting_import', 'awaiting_approval',
                            'downloaded', 'available',
                          ],
                        },
                        deletedAt: null,
                      },
                    });
                    hasActiveRequest = activeRequest !== null;
                  }
                }
              } catch (searchError) {
                logger.warn(
                  `Audible search failed for "${book.searchTerm}": ${
                    searchError instanceof Error ? searchError.message : String(searchError)
                  }`
                );
              }

              const result = {
                index: i,
                folderPath: book.folderPath,
                folderName: book.folderName,
                relativePath: book.relativePath,
                audioFileCount: book.audioFileCount,
                totalSizeBytes: book.totalSizeBytes,
                metadataSource: book.metadataSource,
                extractedAsin: book.extractedAsin,
                searchTerm: book.searchTerm,
                audioFiles: book.audioFiles,
                match: match
                  ? {
                      asin: match.asin,
                      title: match.title,
                      author: match.author,
                      narrator: match.narrator,
                      coverArtUrl: match.coverArtUrl,
                      durationMinutes: match.durationMinutes,
                    }
                  : null,
                inLibrary,
                hasActiveRequest,
              };

              results.push(result);
              send('book_matched', result);

              // Rate limit: wait between Audible searches (except after last)
              if (i < audiobooks.length - 1) {
                await delay(AUDIBLE_SEARCH_DELAY_MS);
              }
            }

            send('complete', {
              totalFound: results.length,
              matched: results.filter((r) => r.match !== null).length,
              inLibrary: results.filter((r) => r.inLibrary).length,
            });
          } catch (error) {
            logger.error('Bulk import scan failed', {
              error: error instanceof Error ? error.message : String(error),
            });
            send('error', {
              message: error instanceof Error ? error.message : 'Scan failed',
            });
          } finally {
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        },
        cancel() {
          abortController.abort();
        },
      });

      // Cast to NextResponse: SSE streams require raw Response constructor,
      // but requireAdmin types expect NextResponse. The Response is valid at runtime.
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      }) as unknown as NextResponse;
    });
  });
}
