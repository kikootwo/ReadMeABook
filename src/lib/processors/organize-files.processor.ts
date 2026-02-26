/**
 * Component: Organize Files Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { OrganizeFilesPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getFileOrganizer } from '../utils/file-organizer';
import { RMABLogger } from '../utils/logger';
import { getLibraryService } from '../services/library';
import { getConfigService } from '../services/config.service';
import { getDownloadClientManager } from '../services/download-client-manager.service';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '../interfaces/download-client.interface';
import { PathMapper, PathMappingConfig } from '../utils/path-mapper';
import { generateFilesHash } from '../utils/files-hash';
import { fixEpubForKindle, cleanupFixedEpub } from '../utils/epub-fixer';
import { removeEmptyParentDirectories } from '../utils/cleanup-helpers';

/**
 * Process organize files job
 * Moves completed downloads to media library in proper directory structure
 * Handles both audiobook and ebook request types with appropriate branching
 */
export async function processOrganizeFiles(payload: OrganizeFilesPayload): Promise<any> {
  const { requestId, audiobookId, downloadPath, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'OrganizeFiles');

  logger.info(`Processing request ${requestId}`);
  logger.info(`Download path: ${downloadPath}`);

  try {
    // Fetch request to determine type
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: {
        user: { select: { plexUsername: true } },
      },
    });

    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    const requestType = request.type || 'audiobook'; // Default to audiobook for backward compatibility
    logger.info(`Request type: ${requestType}`);

    // Branch based on request type
    if (requestType === 'ebook') {
      return await processEbookOrganization(payload, request, logger);
    }

    // Continue with audiobook organization flow
    // Update request status to processing
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'processing',
        progress: 100, // Download is complete, now organizing
        updatedAt: new Date(),
      },
    });

    // Get audiobook details
    const audiobook = await prisma.audiobook.findUnique({
      where: { id: audiobookId },
    });

    if (!audiobook) {
      throw new Error(`Audiobook ${audiobookId} not found`);
    }

    logger.info(`Organizing: ${audiobook.title} by ${audiobook.author}`);

    // Fetch missing metadata from AudibleCache if needed
    // Year and narrator can both be part of path templates
    let year = audiobook.year || undefined;
    let narrator = audiobook.narrator || undefined;

    logger.info(`Initial metadata from audiobook record: year=${year || 'null'}, narrator=${narrator || 'null'}`);

    // Try to enrich missing metadata from AudibleCache
    if (audiobook.audibleAsin && (!year || !narrator)) {
      logger.info(`Missing metadata, attempting to fetch from AudibleCache for ASIN: ${audiobook.audibleAsin}`);

      const audibleCache = await prisma.audibleCache.findUnique({
        where: { asin: audiobook.audibleAsin },
        select: { releaseDate: true, narrator: true },
      });

      if (audibleCache) {
        const updates: { year?: number; narrator?: string } = {};

        // Extract year from releaseDate if missing
        if (!year && audibleCache.releaseDate) {
          year = new Date(audibleCache.releaseDate).getFullYear();
          updates.year = year;
          logger.info(`Extracted year ${year} from AudibleCache releaseDate`);
        }

        // Get narrator if missing
        if (!narrator && audibleCache.narrator) {
          narrator = audibleCache.narrator;
          updates.narrator = narrator;
          logger.info(`Got narrator "${narrator}" from AudibleCache`);
        }

        // Update audiobook record with enriched data for future use
        if (Object.keys(updates).length > 0) {
          await prisma.audiobook.update({
            where: { id: audiobookId },
            data: updates,
          });
          logger.info(`Updated audiobook record with enriched metadata`);
        }
      } else {
        logger.info(`No AudibleCache entry found for ASIN ${audiobook.audibleAsin}`);
      }
    }

    logger.info(`Final metadata for path organization: year=${year || 'null'}, narrator=${narrator || 'null'}`)

    // Get file organizer (reads media_dir from database config)
    const organizer = await getFileOrganizer();

    // Read path template from configuration
    const templateConfig = await prisma.configuration.findUnique({
      where: { key: 'audiobook_path_template' },
    });
    const template = templateConfig?.value || '{author}/{title} {asin}';

    // Read file rename configuration
    const fileRenameEnabledConfig = await prisma.configuration.findUnique({
      where: { key: 'file_rename_enabled' },
    });
    const fileRenameTemplateConfig = await prisma.configuration.findUnique({
      where: { key: 'file_rename_template' },
    });
    const renameConfig = {
      enabled: fileRenameEnabledConfig?.value === 'true',
      template: fileRenameTemplateConfig?.value || '{title}',
    };

    // Organize files (pass template, logger, and rename config to file organizer)
    const result = await organizer.organize(
      downloadPath,
      {
        title: audiobook.title,
        author: audiobook.author,
        narrator,
        coverArtUrl: audiobook.coverArtUrl || undefined,
        asin: audiobook.audibleAsin || undefined,
        year,
        series: audiobook.series || undefined,
        seriesPart: audiobook.seriesPart || undefined,
      },
      template,
      jobId ? { jobId, context: 'FileOrganizer' } : undefined,
      renameConfig
    );

    if (!result.success) {
      throw new Error(`File organization failed: ${result.errors.join(', ')}`);
    }

    logger.info(`Successfully moved ${result.filesMovedCount} files to ${result.targetPath}`);

    // Generate hash from organized audio files for library matching
    const filesHash = generateFilesHash(result.audioFiles);
    if (filesHash) {
      logger.info(`Generated files hash: ${filesHash.substring(0, 16)}... (${result.audioFiles.length} audio files)`);
    }

    // Update audiobook record with file path, hash, and status
    await prisma.audiobook.update({
      where: { id: audiobookId },
      data: {
        filePath: result.targetPath,
        filesHash: filesHash || null,
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Update request to downloaded (green status, waiting for Plex scan)
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'downloaded',
        progress: 100,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Apply post-import category to torrent client if configured
    await applyPostImportCategory(requestId, logger);

    logger.info(`Request ${requestId} completed successfully - status: downloaded`, {
      success: true,
      message: 'Files organized successfully',
      requestId,
      audiobookId,
      targetPath: result.targetPath,
      filesCount: result.filesMovedCount,
      audioFiles: result.audioFiles,
      coverArt: result.coverArtFile,
      errors: result.errors,
    });

    // Create ebook request if ebook downloads enabled (for audiobook requests only)
    // This replaces the old inline ebook sidecar download
    await createEbookRequestIfEnabled(requestId, audiobook, request.userId, result.targetPath, logger);

    // Trigger filesystem scan if enabled (Plex or Audiobookshelf)
    const configService = getConfigService();
    const backendMode = await configService.getBackendMode();

    const configKey = backendMode === 'audiobookshelf'
      ? 'audiobookshelf.trigger_scan_after_import'
      : 'plex.trigger_scan_after_import';

    const scanEnabled = await configService.get(configKey);

    if (scanEnabled === 'true') {
      try {
        // Get library service (returns PlexLibraryService or AudiobookshelfLibraryService)
        const libraryService = await getLibraryService();

        // Get configured library ID (backend-specific config)
        const libraryId = backendMode === 'audiobookshelf'
          ? await configService.get('audiobookshelf.library_id')
          : await configService.get('plex_audiobook_library_id');

        if (!libraryId) {
          throw new Error('Library ID not configured');
        }

        // Trigger scan (implementation is backend-specific)
        await libraryService.triggerLibraryScan(libraryId);

        logger.info(
          `Triggered ${backendMode} filesystem scan for library ${libraryId}`
        );

      } catch (error) {
        // Log error but don't fail the job
        logger.error(
          `Failed to trigger filesystem scan: ${error instanceof Error ? error.message : 'Unknown error'}`,
          {
            error: error instanceof Error ? error.stack : undefined,
            backend: backendMode
          }
        );
        // Continue - scheduled scans will eventually detect the book
      }
    } else {
      logger.info(
        `${backendMode} filesystem scan trigger disabled (relying on filesystem watcher)`
      );
    }

    // Cleanup downloads if configured (uses IDownloadClient.postProcess for client-specific cleanup)
    await cleanupDownloadAfterOrganize(requestId, downloadPath, configService, jobId, logger);

    return {
      success: true,
      message: 'Files organized successfully',
      requestId,
      audiobookId,
      targetPath: result.targetPath,
      filesCount: result.filesMovedCount,
      audioFiles: result.audioFiles,
      coverArt: result.coverArtFile,
      errors: result.errors,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    const errorMessage = error instanceof Error ? error.message : 'File organization failed';

    // Check if this is a retryable error (transient filesystem issues or no files found)
    // These errors may resolve on retry (e.g., files still being extracted, permissions being set)
    const isRetryableError =
      errorMessage.includes('No audiobook files found') ||
      errorMessage.includes('No ebook files found') ||  // Ebook equivalent of above
      errorMessage.includes('ENOENT') || // File/directory not found
      errorMessage.includes('no such file or directory') ||
      errorMessage.includes('EACCES') || // Permission denied (might be temporary)
      errorMessage.includes('EPERM');    // Operation not permitted (might be temporary)

    if (isRetryableError) {
      // Get current request to check retry count
      const currentRequest = await prisma.request.findFirst({
        where: {
          id: requestId,
          deletedAt: null,
        },
        select: { importAttempts: true, maxImportRetries: true },
      });

      if (!currentRequest) {
        throw new Error('Request not found or deleted');
      }

      const newAttempts = currentRequest.importAttempts + 1;

      if (newAttempts < currentRequest.maxImportRetries) {
        // Still have retries left - queue for re-import
        logger.warn(`Retryable error for request ${requestId}, queueing for retry (attempt ${newAttempts}/${currentRequest.maxImportRetries})`);

        // Re-query download client for fresh path (content_path may have been updated since handoff)
        try {
          const downloadHistory = await prisma.downloadHistory.findFirst({
            where: { requestId },
            orderBy: { createdAt: 'desc' },
          });

          if (downloadHistory?.downloadClientId && downloadHistory?.downloadClient && downloadHistory.downloadClient !== 'direct') {
            const configService = getConfigService();
            const dlManager = getDownloadClientManager(configService);
            const dlProtocol = CLIENT_PROTOCOL_MAP[downloadHistory.downloadClient as DownloadClientType];

            if (dlProtocol) {
              const dlClient = await dlManager.getClientServiceForProtocol(dlProtocol);
              if (dlClient) {
                const freshInfo = await dlClient.getDownload(downloadHistory.downloadClientId);
                if (freshInfo?.downloadPath && freshInfo.downloadPath !== downloadPath) {
                  // Apply path mapping and update stored path
                  const clientConfig = await dlManager.getClientForProtocol(dlProtocol);
                  const pathMappingConfig: PathMappingConfig = clientConfig?.remotePathMappingEnabled
                    ? { enabled: true, remotePath: clientConfig.remotePath || '', localPath: clientConfig.localPath || '' }
                    : { enabled: false, remotePath: '', localPath: '' };
                  const freshPath = PathMapper.transform(freshInfo.downloadPath, pathMappingConfig);

                  logger.info(`Download client returned updated path: ${freshPath} (was: ${downloadPath})`);
                  await prisma.downloadHistory.update({
                    where: { id: downloadHistory.id },
                    data: { downloadPath: freshPath },
                  });
                }
              }
            }
          }
        } catch (refreshError) {
          logger.warn(`Failed to refresh download path: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
        }

        await prisma.request.update({
          where: { id: requestId },
          data: {
            status: 'awaiting_import',
            importAttempts: newAttempts,
            lastImportAt: new Date(),
            errorMessage: `${errorMessage}. Retry ${newAttempts}/${currentRequest.maxImportRetries}`,
            updatedAt: new Date(),
          },
        });

        return {
          success: false,
          message: 'Retryable error detected, queued for re-import',
          requestId,
          attempts: newAttempts,
          maxRetries: currentRequest.maxImportRetries,
        };
      } else {
        // Max retries exceeded - move to warn status
        logger.warn(`Max retries (${currentRequest.maxImportRetries}) exceeded for request ${requestId}, moving to warn status`);

        const warnMessage = `${errorMessage}. Max retries (${currentRequest.maxImportRetries}) exceeded. Manual retry available.`;

        await prisma.request.update({
          where: { id: requestId },
          data: {
            status: 'warn',
            importAttempts: newAttempts,
            errorMessage: warnMessage,
            updatedAt: new Date(),
          },
        });

        // Send notification for request failure
        const request = await prisma.request.findUnique({
          where: { id: requestId },
          include: {
            audiobook: true,
            user: { select: { plexUsername: true } },
          },
        });

        if (request) {
          const jobQueue = getJobQueueService();
          await jobQueue.addNotificationJob(
            'request_error',
            request.id,
            request.audiobook.title,
            request.audiobook.author,
            request.user.plexUsername || 'Unknown User',
            warnMessage
          ).catch((error) => {
            logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
          });
        }

        return {
          success: false,
          message: 'Max import retries exceeded, manual intervention required',
          requestId,
          attempts: newAttempts,
          maxRetries: currentRequest.maxImportRetries,
        };
      }
    } else {
      // Other error - fail immediately
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage,
          updatedAt: new Date(),
        },
      });

      // Send notification for request failure
      const request = await prisma.request.findUnique({
        where: { id: requestId },
        include: {
          audiobook: true,
          user: { select: { plexUsername: true } },
        },
      });

      if (request) {
        const jobQueue = getJobQueueService();
        await jobQueue.addNotificationJob(
          'request_error',
          request.id,
          request.audiobook.title,
          request.audiobook.author,
          request.user.plexUsername || 'Unknown User',
          errorMessage
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });
      }

      throw error;
    }
  }
}

// =========================================================================
// EBOOK-SPECIFIC ORGANIZATION
// =========================================================================

/**
 * Process ebook organization (simplified flow compared to audiobooks)
 * - No metadata tagging
 * - No cover art download
 * - No files hash generation
 * - Sends "available" notification at downloaded state (terminal for ebooks)
 */
async function processEbookOrganization(
  payload: OrganizeFilesPayload,
  request: { id: string; userId: string; type: string; user: { plexUsername: string | null } },
  logger: RMABLogger
): Promise<any> {
  const { requestId, audiobookId, downloadPath, jobId } = payload;

  logger.info(`Processing ebook organization for request ${requestId}`);

  // Update request status to processing
  await prisma.request.update({
    where: { id: requestId },
    data: {
      status: 'processing',
      progress: 100,
      updatedAt: new Date(),
    },
  });

  // Get book details (works for both audiobooks and ebooks)
  const book = await prisma.audiobook.findUnique({
    where: { id: audiobookId },
  });

  if (!book) {
    throw new Error(`Book ${audiobookId} not found`);
  }

  logger.info(`Organizing ebook: ${book.title} by ${book.author}`);

  // Fetch missing metadata from AudibleCache (same pattern as audiobooks)
  // Year, narrator, series, seriesPart can all be part of path templates
  let year = book.year || undefined;
  let narrator = book.narrator || undefined;
  let series = book.series || undefined;
  let seriesPart = book.seriesPart || undefined;

  logger.info(`Initial metadata from book record: year=${year || 'null'}, narrator=${narrator || 'null'}, series=${series || 'null'}`);

  // Try to enrich missing metadata from AudibleCache
  if (book.audibleAsin && (!year || !narrator)) {
    logger.info(`Missing metadata, attempting to fetch from AudibleCache for ASIN: ${book.audibleAsin}`);

    const audibleCache = await prisma.audibleCache.findUnique({
      where: { asin: book.audibleAsin },
      select: { releaseDate: true, narrator: true, },
    });

    if (audibleCache) {
      const updates: { year?: number; narrator?: string } = {};

      // Extract year from releaseDate if missing
      if (!year && audibleCache.releaseDate) {
        year = new Date(audibleCache.releaseDate).getFullYear();
        updates.year = year;
        logger.info(`Extracted year ${year} from AudibleCache releaseDate`);
      }

      // Get narrator if missing
      if (!narrator && audibleCache.narrator) {
        narrator = audibleCache.narrator;
        updates.narrator = narrator;
        logger.info(`Got narrator "${narrator}" from AudibleCache`);
      }

      // Update book record with enriched data for future use
      if (Object.keys(updates).length > 0) {
        await prisma.audiobook.update({
          where: { id: audiobookId },
          data: updates,
        });
        logger.info(`Updated book record with enriched metadata`);
      }
    } else {
      logger.info(`No AudibleCache entry found for ASIN ${book.audibleAsin}`);
    }
  }

  logger.info(`Final metadata for path organization: year=${year || 'null'}, narrator=${narrator || 'null'}, series=${series || 'null'}, seriesPart=${seriesPart || 'null'}`);

  // Check if this is an indexer download (needs to keep source for seeding)
  const downloadHistory = await prisma.downloadHistory.findFirst({
    where: { requestId },
    orderBy: { createdAt: 'desc' },
  });
  const isIndexerDownload = downloadHistory?.downloadClient !== 'direct';
  logger.info(`Download source: ${downloadHistory?.downloadClient || 'unknown'} (indexer download: ${isIndexerDownload})`);

  // Get file organizer and ebook-specific template (falls back to audiobook template)
  const organizer = await getFileOrganizer();
  const ebookTemplateConfig = await prisma.configuration.findUnique({
    where: { key: 'ebook_path_template' },
  });
  let template: string;
  if (ebookTemplateConfig?.value) {
    template = ebookTemplateConfig.value;
  } else {
    const audiobookTemplateConfig = await prisma.configuration.findUnique({
      where: { key: 'audiobook_path_template' },
    });
    template = audiobookTemplateConfig?.value || '{author}/{title} {asin}';
  }

  // Check if Kindle EPUB fix is needed
  let effectiveDownloadPath = downloadPath;
  let fixedEpubPath: string | null = null;

  // Detect the actual EPUB file path (handles both single file and directory downloads)
  const epubFilePath = await detectEpubFilePath(downloadPath);

  // Only apply Kindle fix for EPUB files when enabled
  if (epubFilePath) {
    const configService = getConfigService();
    const kindleFixEnabled = await configService.get('ebook_kindle_fix_enabled');

    if (kindleFixEnabled === 'true') {
      logger.info('Kindle EPUB fix enabled - applying compatibility fixes');

      const tempDir = process.env.TEMP_DIR || '/tmp/readmeabook';
      const fixResult = await fixEpubForKindle(
        epubFilePath,
        tempDir,
        jobId ? { jobId, context: 'EpubFixer' } : undefined
      );

      if (fixResult.success && fixResult.outputPath) {
        fixedEpubPath = fixResult.outputPath;
        effectiveDownloadPath = fixResult.outputPath;
        logger.info(`Using fixed EPUB: ${fixResult.outputPath}`);

        // Log fixes applied
        const { encodingFixes, bodyIdLinkFixes, languageFix, strayImgFixes } = fixResult.fixesApplied;
        const totalFixes = encodingFixes + bodyIdLinkFixes + (languageFix ? 1 : 0) + strayImgFixes;
        if (totalFixes > 0) {
          logger.info(`Kindle fixes applied: encoding=${encodingFixes}, bodyIdLinks=${bodyIdLinkFixes}, language=${languageFix}, strayImages=${strayImgFixes}`);
        }
      } else {
        // Fix failed - continue with original file
        logger.warn(`Kindle EPUB fix failed: ${fixResult.error}. Continuing with original file.`);
      }
    } else {
      logger.info('Kindle EPUB fix disabled - organizing original file');
    }
  }

  // Read file rename configuration
  const fileRenameEnabledConfig = await prisma.configuration.findUnique({
    where: { key: 'file_rename_enabled' },
  });
  const fileRenameTemplateConfig = await prisma.configuration.findUnique({
    where: { key: 'file_rename_template' },
  });
  const ebookRenameConfig = {
    enabled: fileRenameEnabledConfig?.value === 'true',
    template: fileRenameTemplateConfig?.value || '{title}',
  };

  // Organize ebook files (organizer will detect ebook type and skip audio-specific processing)
  // Pass all metadata that could be used in path templates (same as audiobooks)
  const result = await organizer.organizeEbook(
    effectiveDownloadPath,
    {
      title: book.title,
      author: book.author,
      narrator,
      asin: book.audibleAsin || undefined,
      year,
      series,
      seriesPart,
    },
    template,
    jobId ? { jobId, context: 'FileOrganizer.Ebook' } : undefined,
    isIndexerDownload,
    ebookRenameConfig
  );

  // Clean up fixed EPUB temp file after organization (regardless of success)
  if (fixedEpubPath) {
    await cleanupFixedEpub(fixedEpubPath);
    logger.info('Cleaned up temporary fixed EPUB');
  }

  if (!result.success) {
    throw new Error(`Ebook organization failed: ${result.errors.join(', ')}`);
  }

  logger.info(`Successfully moved ebook to ${result.targetPath}`);

  // Update book record with file path
  await prisma.audiobook.update({
    where: { id: audiobookId },
    data: {
      filePath: result.targetPath,
      fileFormat: result.format || 'epub',
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Update request to downloaded (terminal state for ebooks)
  await prisma.request.update({
    where: { id: requestId },
    data: {
      status: 'downloaded',
      progress: 100,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Apply post-import category to torrent client if configured
  await applyPostImportCategory(requestId, logger);

  logger.info(`Ebook request ${requestId} completed - status: downloaded (terminal)`);

  // Send "available" notification for ebooks at downloaded state
  // (since ebooks don't transition to 'available' via Plex matching)
  const jobQueue = getJobQueueService();
  await jobQueue.addNotificationJob(
    'request_available',
    requestId,
    book.title,
    book.author,
    request.user.plexUsername || 'Unknown User',
    undefined,
    'ebook'
  ).catch((error) => {
    logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
  });

  // Trigger filesystem scan if enabled (same as audiobooks)
  const configService = getConfigService();
  const backendMode = await configService.getBackendMode();
  const configKey = backendMode === 'audiobookshelf'
    ? 'audiobookshelf.trigger_scan_after_import'
    : 'plex.trigger_scan_after_import';
  const scanEnabled = await configService.get(configKey);

  logger.debug(`Ebook library scan check: backendMode=${backendMode}, configKey=${configKey}, scanEnabled=${scanEnabled}`);

  if (scanEnabled === 'true') {
    try {
      const libraryService = await getLibraryService();
      const libraryId = backendMode === 'audiobookshelf'
        ? await configService.get('audiobookshelf.library_id')
        : await configService.get('plex_audiobook_library_id');

      if (libraryId) {
        await libraryService.triggerLibraryScan(libraryId);
        logger.info(`Triggered ${backendMode} filesystem scan for library ${libraryId}`);
      } else {
        logger.warn(`Library ID not configured for ${backendMode}, skipping scan`);
      }
    } catch (error) {
      logger.error(`Failed to trigger filesystem scan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else {
    logger.debug(`Ebook library scan disabled (scanEnabled=${scanEnabled})`);
  }

  // Cleanup downloads if configured (uses IDownloadClient.postProcess for client-specific cleanup)
  await cleanupDownloadAfterOrganize(requestId, downloadPath, configService, jobId, logger);

  return {
    success: true,
    message: 'Ebook organized successfully',
    requestId,
    audiobookId,
    targetPath: result.targetPath,
    format: result.format,
  };
}

/**
 * Create ebook request if ebook downloads are enabled
 * Called after audiobook organization completes
 *
 * Supports two ebook sources:
 * - Anna's Archive (ebook_annas_archive_enabled) - Currently implemented
 * - Indexer Search (ebook_indexer_search_enabled) - Future feature, gracefully skipped
 */
async function createEbookRequestIfEnabled(
  parentRequestId: string,
  audiobook: { id: string; title: string; author: string; audibleAsin: string | null },
  userId: string,
  targetPath: string,
  logger: RMABLogger
): Promise<void> {
  try {
    const configService = getConfigService();

    // Check if auto-grab is enabled (default: true for backward compatibility)
    const autoGrabEnabled = await configService.get('ebook_auto_grab_enabled');
    if (autoGrabEnabled === 'false') {
      logger.info('Ebook auto-grab disabled, skipping automatic ebook request creation');
      return;
    }

    // Check which ebook sources are enabled
    const annasArchiveEnabled = await configService.get('ebook_annas_archive_enabled');
    const indexerSearchEnabled = await configService.get('ebook_indexer_search_enabled');

    // Legacy migration: check old key if new keys don't exist
    const legacyEnabled = await configService.get('ebook_sidecar_enabled');
    const isAnnasArchiveEnabled = annasArchiveEnabled === 'true' ||
      (annasArchiveEnabled === null && legacyEnabled === 'true');
    const isIndexerSearchEnabled = indexerSearchEnabled === 'true';

    // If no sources are enabled, skip ebook creation
    if (!isAnnasArchiveEnabled && !isIndexerSearchEnabled) {
      logger.info('Ebook downloads disabled (no sources enabled), skipping ebook request creation');
      return;
    }

    // At least one source is enabled - proceed with ebook request creation

    // Check if an ebook request already exists for this parent
    const existingEbookRequest = await prisma.request.findFirst({
      where: {
        parentRequestId,
        type: 'ebook',
        deletedAt: null,
      },
    });

    if (existingEbookRequest) {
      logger.info(`Ebook request already exists for parent ${parentRequestId}: ${existingEbookRequest.id}`);
      return;
    }

    logger.info(`Creating ebook request for "${audiobook.title}" (parent: ${parentRequestId})`);

    // Create new ebook request (auto-approved since parent was approved)
    const ebookRequest = await prisma.request.create({
      data: {
        userId,
        audiobookId: audiobook.id,
        type: 'ebook',
        parentRequestId,
        status: 'pending', // Will trigger search_ebook job
        progress: 0,
      },
    });

    logger.info(`Created ebook request ${ebookRequest.id}`);

    // Trigger ebook search job (Anna's Archive)
    const jobQueue = getJobQueueService();
    await jobQueue.addSearchEbookJob(ebookRequest.id, {
      id: audiobook.id,
      title: audiobook.title,
      author: audiobook.author,
      asin: audiobook.audibleAsin || undefined,
    });

    logger.info(`Triggered search_ebook job for request ${ebookRequest.id}`);
  } catch (error) {
    // Don't fail the main audiobook organization if ebook request creation fails
    logger.error(`Failed to create ebook request: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// =========================================================================
// POST-IMPORT CATEGORY
// =========================================================================

/**
 * Apply post-import category to the download client after successful import.
 * Only applies to torrent clients (qBittorrent/Transmission) when configured.
 * Non-fatal: logs a warning on failure but does not fail the job.
 */
async function applyPostImportCategory(
  requestId: string,
  logger: RMABLogger
): Promise<void> {
  try {
    // Get download history to find client type and download ID
    const downloadHistory = await prisma.downloadHistory.findFirst({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
    });

    if (!downloadHistory?.downloadClientId || !downloadHistory?.downloadClient) {
      return;
    }

    const clientType = downloadHistory.downloadClient as DownloadClientType;

    // Only applies to torrent clients
    const protocol = CLIENT_PROTOCOL_MAP[clientType];
    if (protocol !== 'torrent') {
      return;
    }

    // Get client config and check if postImportCategory is set
    const configService = getConfigService();
    const manager = getDownloadClientManager(configService);
    const clients = await manager.getAllClients();
    const clientConfig = clients.find(c => c.enabled && c.type === clientType);

    if (!clientConfig?.postImportCategory) {
      return;
    }

    logger.info(`Applying post-import category "${clientConfig.postImportCategory}" to download ${downloadHistory.downloadClientId}`);

    const service = await manager.createClientFromConfig(clientConfig);
    await service.setCategory(downloadHistory.downloadClientId, clientConfig.postImportCategory);

    logger.info(`Post-import category applied successfully`);
  } catch (error) {
    logger.warn(`Failed to apply post-import category: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// =========================================================================
// DOWNLOAD CLEANUP
// =========================================================================

/**
 * Cleanup download files and archive from download client after successful organization.
 * Uses the IDownloadClient.postProcess() method for client-specific cleanup (e.g., SABnzbd archive).
 * Shared between audiobook and ebook organization flows.
 */
async function cleanupDownloadAfterOrganize(
  requestId: string,
  downloadPath: string,
  configService: any,
  jobId: string | undefined,
  logger: RMABLogger
): Promise<void> {
  try {
    logger.info('Checking if cleanup is needed for this download');

    // Get download history to find client ID and indexer
    const downloadHistory = await prisma.downloadHistory.findFirst({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
    });

    logger.info(`Download history found: ${downloadHistory ? 'yes' : 'no'}`, {
      hasDownloadClientId: !!downloadHistory?.downloadClientId,
      hasIndexerId: !!downloadHistory?.indexerId,
      downloadClient: downloadHistory?.downloadClient || 'none',
    });

    if (!downloadHistory?.indexerId || !downloadHistory?.downloadClientId) {
      return;
    }

    // Get indexer configuration
    const indexersConfig = await configService.get('prowlarr_indexers');
    if (!indexersConfig) {
      return;
    }

    const indexers: Array<{ id: number; protocol: string; removeAfterProcessing?: boolean }> = JSON.parse(indexersConfig);
    const indexer = indexers.find(idx => idx.id === downloadHistory.indexerId);

    logger.info(`Indexer found in config: ${indexer ? 'yes' : 'no'}`, {
      indexerId: downloadHistory.indexerId,
      protocol: indexer?.protocol || 'none',
      removeAfterProcessing: indexer?.removeAfterProcessing ?? 'undefined',
    });

    // Check if this is a non-torrent indexer with cleanup enabled.
    const isTorrentProtocol = indexer?.protocol?.toLowerCase() === 'torrent';

    if (!indexer || isTorrentProtocol || !indexer.removeAfterProcessing) {
      return;
    }

    logger.info(`Cleaning up download ${downloadHistory.downloadClientId} (cleanup enabled for indexer ${indexer.id})`);

    // First, manually delete files from filesystem
    if (downloadPath) {
      logger.info(`Removing download files from filesystem: ${downloadPath}`);

      const fs = await import('fs/promises');

      try {
        const stats = await fs.stat(downloadPath);

        if (stats.isDirectory()) {
          await fs.rm(downloadPath, { recursive: true, force: true });
          logger.info(`Removed directory: ${downloadPath}`);
        } else {
          await fs.unlink(downloadPath);
          logger.info(`Removed file: ${downloadPath}`);
        }

        // Clean up empty parent directories
        const downloadDir = await configService.get('download_dir') || '/downloads';
        const cleanupResult = await removeEmptyParentDirectories(downloadPath, {
          boundaryPath: downloadDir,
          logContext: jobId ? { jobId, context: 'CleanupParents' } : undefined,
        });

        if (cleanupResult.removedDirectories.length > 0) {
          logger.info(`Cleaned up ${cleanupResult.removedDirectories.length} empty parent directories`);
        }
      } catch (fsError) {
        if ((fsError as NodeJS.ErrnoException).code === 'ENOENT') {
          logger.info(`Download path already deleted: ${downloadPath}`);
        } else {
          throw fsError;
        }
      }
    } else {
      logger.warn(`No download path available, skipping filesystem deletion`);
    }

    // Then use the download client interface for client-specific post-processing
    // (e.g., usenet clients archive from history, torrent clients are a no-op)
    const clientType = downloadHistory.downloadClient;
    if (clientType && clientType !== 'direct') {
      const manager = getDownloadClientManager(configService);
      const protocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType];
      if (!protocol) {
        logger.warn(`Unknown download client type: ${clientType}, skipping post-processing`);
        return;
      }
      const client = await manager.getClientServiceForProtocol(protocol as 'torrent' | 'usenet');

      if (client) {
        await client.postProcess(downloadHistory.downloadClientId);
        logger.info(`Successfully post-processed download ${downloadHistory.downloadClientId} via ${client.clientType}`);
      }
    }
  } catch (error) {
    // Log error but don't fail the job - cleanup is optional
    logger.warn(
      `Failed to cleanup download: ${error instanceof Error ? error.message : 'Unknown error'}`,
      {
        error: error instanceof Error ? error.stack : undefined,
      }
    );
  }
}

// =========================================================================
// HELPER FUNCTIONS
// =========================================================================

/**
 * Detect the path to an EPUB file from download path
 * Handles both single file downloads (direct path) and directory downloads (indexer)
 *
 * @param downloadPath - Path to the download (file or directory)
 * @returns Full path to EPUB file, or null if no EPUB found
 */
async function detectEpubFilePath(downloadPath: string): Promise<string | null> {
  const fs = await import('fs/promises');
  const path = await import('path');

  try {
    const stats = await fs.stat(downloadPath);

    if (stats.isFile()) {
      // Single file - check if it's an EPUB
      if (path.extname(downloadPath).toLowerCase() === '.epub') {
        return downloadPath;
      }
      return null;
    }

    // Directory - search for EPUB file
    const files = await walkDirectory(downloadPath);
    const epubFile = files.find(file =>
      path.extname(file).toLowerCase() === '.epub'
    );

    if (epubFile) {
      return path.join(downloadPath, epubFile);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Recursively walk directory to find all files
 * Returns relative paths from the base directory
 */
async function walkDirectory(dir: string, baseDir: string = ''): Promise<string[]> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = baseDir ? path.join(baseDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        const subFiles = await walkDirectory(fullPath, relativePath);
        files.push(...subFiles);
      } else {
        files.push(relativePath);
      }
    }
  } catch {
    // Directory not accessible
  }

  return files;
}
