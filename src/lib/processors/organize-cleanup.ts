/**
 * Component: Post-Organize Cleanup (download + manual-import source)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as path from 'path';
import { RMABLogger } from '../utils/logger';
import type { ConfigurationService } from '../services/config.service';
import { getDownloadClientManager } from '../services/download-client-manager.service';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '../interfaces/download-client.interface';
import { assertSafeToDelete, DeleteGuardContext, UnsafeDeleteError } from '../utils/delete-guard';
import { collectGuardRoots, guardAllows, planDownloadCleanup, sweepEmptyParents } from './organize-cleanup-guard';
import {
  folderRemovalBlocker,
  type ImportEvidence,
  rewalkBlocker,
  sourceKey,
  verifiedSourceKeys,
} from '../utils/import-inventory';

// =========================================================================
// DOWNLOAD CLEANUP
// =========================================================================

export interface DownloadCleanupParams {
  requestId: string;
  /** Path the organize job read from. */
  downloadPath: string;
  /** DownloadHistory row that produced this job. Absent for manual and bulk imports. */
  downloadHistoryId?: string;
  /** Folder the files were organized into. */
  targetPath: string;
  /** What the organize step found and what verifiably reached the library. */
  evidence: ImportEvidence;
  configService: ConfigurationService;
  jobId: string | undefined;
  logger: RMABLogger;
}

/**
 * Reason a whole source (folder or single file) must stay, or null when every
 * imported file is verified and a fresh walk finds nothing new.
 */
async function sourceRemovalBlocker(sourcePath: string, evidence: ImportEvidence): Promise<string | null> {
  return folderRemovalBlocker(evidence) ?? (await rewalkBlocker(sourcePath, evidence));
}

/**
 * Remove a direct HTTP download file (e.g. an ebook fetched over HTTP) after it
 * was copied into the library. Same provenance gate and guard as the indexer
 * cleanup; only single files from the 'direct' client are removed.
 */
export async function cleanupDirectDownloadSource(params: DownloadCleanupParams): Promise<void> {
  const { requestId, downloadPath, downloadHistoryId, targetPath, evidence, configService, logger } = params;
  try {
    const plan = await planDownloadCleanup(
      requestId, downloadPath, downloadHistoryId, () => configService.get('prowlarr_indexers'), logger
    );
    if (plan?.kind !== 'direct') {
      return;
    }
    if (!verifiedSourceKeys(evidence).has(sourceKey(downloadPath))) {
      logger.warn('Direct download cleanup skipped: the file was not verified in the library; download kept');
      return;
    }

    const fs = await import('fs/promises');
    const stats = await fs.lstat(downloadPath);
    if (!stats.isFile()) {
      return;
    }

    const roots = await collectGuardRoots();
    const deletePath = await guardAllows(downloadPath, { ...roots, targetPath }, logger, 'Direct download cleanup');
    if (!deletePath) {
      return;
    }

    await fs.unlink(deletePath);
    logger.info(`Cleaned up direct download file: ${path.basename(downloadPath)}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    logger.warn(`Failed to remove direct download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Cleanup download files and archive from download client after successful organization.
 * Uses the IDownloadClient.postProcess() method for client-specific cleanup (e.g., SABnzbd archive).
 * Shared between audiobook and ebook organization flows.
 *
 * Runs only for downloads RMAB itself completed: the job must carry the
 * DownloadHistory id, that row must be completed, and its stored (mapped)
 * download path must equal the job's path. Every delete then passes the guard.
 */
export async function cleanupDownloadAfterOrganize(params: DownloadCleanupParams): Promise<void> {
  const { requestId, downloadPath, downloadHistoryId, targetPath, evidence, configService, jobId, logger } = params;
  try {
    logger.info('Checking if cleanup is needed for this download');

    const plan = await planDownloadCleanup(
      requestId, downloadPath, downloadHistoryId, () => configService.get('prowlarr_indexers'), logger
    );
    if (plan?.kind !== 'indexer') {
      return;
    }
    const { downloadHistory } = plan;

    // Only remove what verifiably reached the library; otherwise keep the
    // download and leave it in the client's history
    const blocker = await sourceRemovalBlocker(downloadPath, evidence);
    if (blocker) {
      logger.warn(`Download cleanup skipped: ${blocker}; download kept`);
      return;
    }

    const roots = await collectGuardRoots();
    const deletePath = await guardAllows(downloadPath, { ...roots, targetPath }, logger, 'Download cleanup');
    if (!deletePath) {
      return;
    }

    logger.info(`Cleaning up download ${downloadHistory.downloadClientId} (cleanup enabled for indexer ${plan.indexerId})`);
    logger.info(`Removing download files from filesystem: ${deletePath}`);

    const fs = await import('fs/promises');

    try {
      // Act on the path the guard returned; lstat so a symlink is removed as a link
      const stats = await fs.lstat(deletePath);

      if (stats.isDirectory()) {
        await fs.rm(deletePath, { recursive: true, force: true });
        logger.info(`Removed directory: ${deletePath}`);
      } else {
        await fs.unlink(deletePath);
        logger.info(`Removed file: ${deletePath}`);
      }

      await sweepEmptyParents(deletePath, roots, jobId, logger, 'CleanupParents');
    } catch (fsError) {
      if ((fsError as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info(`Download path already deleted: ${deletePath}`);
      } else {
        throw fsError;
      }
    }

    // Then use the download client interface for client-specific post-processing
    // (e.g., usenet clients archive from history, torrent clients are a no-op)
    const clientType = downloadHistory.downloadClient;
    if (clientType && clientType !== 'direct' && downloadHistory.downloadClientId) {
      const manager = getDownloadClientManager(configService);
      const clientProtocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType];
      if (!clientProtocol) {
        logger.warn(`Unknown download client type: ${clientType}, skipping post-processing`);
        return;
      }
      const client = await manager.getClientServiceForProtocol(clientProtocol as 'torrent' | 'usenet');

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
// SOURCE FILE CLEANUP (MANUAL IMPORT)
// =========================================================================

/**
 * Delete source files after successful manual import.
 * Non-fatal: logs a warning on failure but does not fail the job.
 * Every path passes the delete guard first: sources inside another media
 * folder may be removed, but never the organize target or anything in it.
 */
export async function cleanupSourceAfterOrganize(
  downloadPath: string,
  targetPath: string,
  configService: ConfigurationService,
  jobId: string | undefined,
  logger: RMABLogger,
  evidence: ImportEvidence,
  selectedFiles?: string[]
): Promise<void> {
  try {
    const fs = await import('fs/promises');
    const verified = verifiedSourceKeys(evidence);
    const statusBySource = new Map(evidence.records.map((r) => [sourceKey(r.source), r.status]));

    logger.info(`Cleaning up source files: ${downloadPath}`);

    const roots = await collectGuardRoots();
    const guardContext: DeleteGuardContext = { ...roots, targetPath, allowMediaSources: true };

    if (selectedFiles && selectedFiles.length > 0) {
      // Only delete the specific files that were imported, not the entire directory
      const kept: string[] = [];
      const unverified: string[] = [];
      let removed = 0;
      for (const fileName of selectedFiles) {
        const filePath = path.join(downloadPath, fileName);
        if (!verified.has(sourceKey(filePath))) {
          unverified.push(`${fileName} (${statusBySource.get(sourceKey(filePath)) ?? 'not imported'})`);
          continue;
        }
        let deletePath: string;
        try {
          deletePath = await assertSafeToDelete(filePath, guardContext);
        } catch (guardError) {
          if (guardError instanceof UnsafeDeleteError) {
            kept.push(fileName);
            continue;
          }
          throw guardError;
        }
        try {
          await fs.unlink(deletePath);
          removed++;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.warn(`Failed to delete source file: ${filePath}`);
          }
        }
      }
      if (kept.length > 0) {
        logger.warn(
          `Kept ${kept.length} source file(s) that are part of the import target ${targetPath}: ${kept.join(', ')}`
        );
      }
      if (unverified.length > 0) {
        logger.warn(`Kept ${unverified.length} source file(s) not verified in the library: ${unverified.join(', ')}`);
      }
      logger.info(`Removed ${removed} selected source files from ${downloadPath}`);
      if (removed > 0) {
        await sweepEmptyParents(downloadPath, roots, jobId, logger, 'CleanupSourceParents');
      }
      return;
    }

    // No file filter: remove the source path itself. A whole folder inside the
    // media library is never removed (it can hold other books); single files may be.
    const stats = await fs.lstat(downloadPath);
    const isDirectory = stats.isDirectory();
    const blocker = await sourceRemovalBlocker(downloadPath, evidence);
    if (blocker) {
      logger.warn(`Source cleanup skipped: ${blocker}; source kept`);
      return;
    }
    const deletePath = await guardAllows(
      downloadPath,
      { ...guardContext, allowMediaSources: !isDirectory },
      logger,
      'Source cleanup'
    );
    if (!deletePath) {
      return;
    }
    if (isDirectory) {
      await fs.rm(deletePath, { recursive: true, force: true });
      logger.info(`Removed source directory: ${deletePath}`);
    } else {
      await fs.unlink(deletePath);
      logger.info(`Removed source file: ${deletePath}`);
    }
    await sweepEmptyParents(deletePath, roots, jobId, logger, 'CleanupSourceParents');
  } catch (error) {
    // Non-fatal - files are already safely in the media library
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.info(`Source path already deleted: ${downloadPath}`);
    } else {
      logger.warn(
        `Failed to cleanup source files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { error: error instanceof Error ? error.stack : undefined }
      );
    }
  }
}

/**
 * Manual-import source cleanup for an ebook: only the imported ebook file is
 * removed, never the folder around it (an import folder can also hold an
 * audiobook or other library content).
 */
export async function cleanupEbookSource(
  downloadPath: string,
  importedFile: string | undefined,
  targetPath: string,
  configService: ConfigurationService,
  jobId: string | undefined,
  logger: RMABLogger,
  evidence: ImportEvidence
): Promise<void> {
  if (!importedFile) {
    logger.warn('Imported ebook file unknown, skipping source cleanup');
  } else if (path.resolve(importedFile) === path.resolve(downloadPath)) {
    await cleanupSourceAfterOrganize(downloadPath, targetPath, configService, jobId, logger, evidence);
  } else {
    await cleanupSourceAfterOrganize(downloadPath, targetPath, configService, jobId, logger, evidence, [
      path.relative(downloadPath, importedFile),
    ]);
  }
}
