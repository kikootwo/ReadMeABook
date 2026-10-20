/**
 * Component: Post-Organize Cleanup Guard Helpers (protected roots, guarded delete, parent sweep)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as path from 'path';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getEncryptionService } from '../services/encryption.service';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '../interfaces/download-client.interface';
import { normalizePath, removeEmptyParentDirectories } from '../utils/cleanup-helpers';
import {
  assertSafeToDelete,
  canonicalize,
  type CanonicalPath,
  DeleteGuardContext,
  isSameEntry,
  UnsafeDeleteError,
} from '../utils/delete-guard';
import { getMediaDir } from '../utils/media-dir';

const BOOKDROP_PATH = '/bookdrop';

export type GuardRoots = Omit<DeleteGuardContext, 'targetPath' | 'allowMediaSources'> & {
  /** Roots that may bound the parent sweep: media_dir, download_dir, client custom paths, bookdrop. */
  sweepRoots: string[];
  /** Client mapped local paths (also in downloadRoots); never used to bound the parent sweep. */
  mappedRoots: string[];
};

function isFilesystemRoot(p: string): boolean {
  const resolved = path.resolve(p);
  return path.dirname(resolved) === resolved;
}

/**
 * Read a configuration value straight from the database. Unlike the cached
 * config service, every error (database, decryption) propagates.
 */
async function readConfigStrict(key: string): Promise<string | null> {
  const row = await prisma.configuration.findUnique({ where: { key } });
  if (!row?.value) {
    return null;
  }
  return row.encrypted ? getEncryptionService().decrypt(row.value) : row.value;
}

/**
 * Collect the roots the delete guard protects: media dir, global download_dir,
 * each client's download_dir/customPath, each client's mapped localPath, the
 * legacy single-client mapped path, and the bookdrop mount.
 *
 * Fails closed: any database, decryption or JSON error throws, so the caller
 * deletes nothing rather than guarding with fewer roots.
 */
export async function collectGuardRoots(): Promise<GuardRoots> {
  try {
    const downloadDir = (await readConfigStrict('download_dir')) || '/downloads';
    const mediaDir = await getMediaDir();
    const downloadRoots = new Set<string>([downloadDir]);
    const sweepRoots = new Set<string>([mediaDir, downloadDir, BOOKDROP_PATH]);
    const mappedRoots = new Set<string>();

    const clientsJson = await readConfigStrict('download_clients');
    if (clientsJson) {
      const clients = JSON.parse(clientsJson) as unknown;
      if (!Array.isArray(clients)) {
        throw new Error('download_clients is not a list');
      }
      for (const client of clients as Array<{ customPath?: string; remotePathMappingEnabled?: boolean; localPath?: string }>) {
        if (client.customPath) {
          downloadRoots.add(path.join(downloadDir, client.customPath));
          sweepRoots.add(path.join(downloadDir, client.customPath));
        }
        if (client.remotePathMappingEnabled && client.localPath) {
          downloadRoots.add(client.localPath);
          mappedRoots.add(client.localPath);
        }
      }
    } else if ((await readConfigStrict('download_client_remote_path_mapping_enabled')) === 'true') {
      const legacyLocalPath = await readConfigStrict('download_client_local_path');
      if (legacyLocalPath) {
        downloadRoots.add(legacyLocalPath);
        mappedRoots.add(legacyLocalPath);
      }
    }

    // A filesystem root as any configured root would make every path "inside" it
    for (const root of [mediaDir, ...downloadRoots]) {
      if (isFilesystemRoot(root)) {
        throw new Error(`configured root ${root} is a filesystem root`);
      }
    }

    return {
      mediaDir,
      downloadRoots: [...downloadRoots],
      otherRoots: [BOOKDROP_PATH],
      sweepRoots: [...sweepRoots],
      mappedRoots: [...mappedRoots],
    };
  } catch (error) {
    throw new Error(
      `Could not read the configured roots for the delete guard, nothing deleted: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Run the guard. Returns the path to act on (the canonical path it checked, or
 * the link itself when the candidate is a symlink), or null after logging a
 * refusal; other errors propagate.
 */
export async function guardAllows(
  candidate: string,
  ctx: DeleteGuardContext,
  logger: RMABLogger,
  label: string
): Promise<string | null> {
  try {
    return await assertSafeToDelete(candidate, ctx);
  } catch (guardError) {
    if (guardError instanceof UnsafeDeleteError) {
      logger.warn(`${label} skipped: ${guardError.message}`);
      return null;
    }
    throw guardError;
  }
}

/**
 * Remove empty parent directories above a deleted path. The sweep walks up to
 * the nearest ancestor that is a configured root (matched by canonical path
 * or by dev+inode) and stops there, never removing the root itself. It does
 * not run when no ancestor is a root, or when the nearest root is only a
 * client's mapped local path (those can be broad, e.g. a whole share).
 */
export async function sweepEmptyParents(
  deletedPath: string,
  roots: GuardRoots,
  jobId: string | undefined,
  logger: RMABLogger,
  context: string
): Promise<void> {
  const tagged = [
    ...roots.sweepRoots.map((p) => ({ source: p, mapped: false })),
    ...roots.mappedRoots.map((p) => ({ source: p, mapped: true })),
  ].filter((r) => Boolean(r.source));
  const canonicalRoots = await Promise.all(tagged.map(async (r) => ({ ...r, canonical: await canonicalize(r.source) })));

  const deleted = await canonicalize(deletedPath);
  let stop: { ancestor: string; mappedOnly: boolean } | null = null;
  let current = deleted.path;
  while (!stop) {
    const parent = normalizePath(path.dirname(current));
    if (parent === current) break;
    const ancestor: CanonicalPath = await canonicalize(parent);
    const matching = canonicalRoots.filter((r) => isSameEntry(ancestor, r.canonical));
    if (matching.length > 0) {
      stop = { ancestor: parent, mappedOnly: matching.every((r) => r.mapped) };
    }
    current = parent;
  }

  if (!stop) {
    logger.info(`No configured root contains ${deletedPath}, leaving parent directories alone`);
    return;
  }
  if (stop.mappedOnly) {
    logger.info(`Nearest root above ${deletedPath} is a mapped download path, leaving parent directories alone`);
    return;
  }

  const cleanupResult = await removeEmptyParentDirectories(deleted.path, {
    boundaryPath: stop.ancestor,
    logContext: jobId ? { jobId, context } : undefined,
  });

  if (cleanupResult.removedDirectories.length > 0) {
    logger.info(`Cleaned up ${cleanupResult.removedDirectories.length} empty parent directories`);
  }
}

// =========================================================================
// PROVENANCE
// =========================================================================

/**
 * Load the DownloadHistory row behind this job, but only when the job is a
 * download RMAB completed: the job carries the row id, the row belongs to the
 * request, it is completed, and its stored (mapped) path equals the job path.
 * Returns null otherwise (manual/bulk import, stale or mismatched rows).
 */
export async function findCompletedDownloadForJob(
  requestId: string,
  downloadPath: string,
  downloadHistoryId: string | undefined,
  logger?: RMABLogger
) {
  if (!downloadHistoryId) {
    logger?.info('Not a download RMAB completed (manual or bulk import), skipping download cleanup');
    return null;
  }

  const downloadHistory = await prisma.downloadHistory.findUnique({
    where: { id: downloadHistoryId },
  });

  logger?.info(`Download history found: ${downloadHistory ? 'yes' : 'no'}`, {
    hasDownloadClientId: !!downloadHistory?.downloadClientId,
    hasIndexerId: !!downloadHistory?.indexerId,
    downloadClient: downloadHistory?.downloadClient || 'none',
  });

  if (!downloadHistory || downloadHistory.requestId !== requestId) {
    return null;
  }

  if (
    downloadHistory.downloadStatus !== 'completed' ||
    !downloadHistory.downloadPath ||
    !downloadPath ||
    normalizePath(path.resolve(downloadHistory.downloadPath)) !== normalizePath(path.resolve(downloadPath))
  ) {
    logger?.info('Job path does not match the completed download path, skipping download cleanup', {
      status: downloadHistory.downloadStatus || 'none',
      storedPath: downloadHistory.downloadPath || 'none',
      jobPath: downloadPath,
    });
    return null;
  }

  return downloadHistory;
}

export type DownloadCleanupPlan =
  | { kind: 'direct'; downloadHistory: NonNullable<Awaited<ReturnType<typeof findCompletedDownloadForJob>>> }
  | {
      kind: 'indexer';
      downloadHistory: NonNullable<Awaited<ReturnType<typeof findCompletedDownloadForJob>>>;
      indexerId: number;
    };

/**
 * Whether post-organize cleanup would remove this job's download at all:
 * a direct download, or an indexer download with remove-after-processing on
 * and a non-torrent protocol. Returns null when nothing would be removed.
 */
export async function planDownloadCleanup(
  requestId: string,
  downloadPath: string,
  downloadHistoryId: string | undefined,
  readIndexers: () => Promise<string | null>,
  logger?: RMABLogger
): Promise<DownloadCleanupPlan | null> {
  const downloadHistory = await findCompletedDownloadForJob(requestId, downloadPath, downloadHistoryId, logger);
  if (!downloadHistory) {
    return null;
  }
  if (downloadHistory.downloadClient === 'direct') {
    return { kind: 'direct', downloadHistory };
  }
  if (!downloadHistory.indexerId || !downloadHistory.downloadClientId) {
    return null;
  }

  const indexersConfig = await readIndexers();
  if (!indexersConfig) {
    return null;
  }
  const indexers: Array<{ id: number; protocol?: string; removeAfterProcessing?: boolean }> = JSON.parse(indexersConfig);
  const indexer = indexers.find((idx) => idx.id === downloadHistory.indexerId);

  // Indexer protocol, falling back to the protocol of the client that downloaded it
  const protocol = (
    indexer?.protocol ||
    CLIENT_PROTOCOL_MAP[downloadHistory.downloadClient as DownloadClientType] ||
    ''
  ).toLowerCase();

  logger?.info(`Indexer found in config: ${indexer ? 'yes' : 'no'}`, {
    indexerId: downloadHistory.indexerId,
    protocol: protocol || 'none',
    removeAfterProcessing: indexer?.removeAfterProcessing ?? 'undefined',
  });

  // Only non-torrent downloads with cleanup enabled (torrents keep seeding)
  if (!indexer || !indexer.removeAfterProcessing || !protocol || protocol === 'torrent') {
    return null;
  }
  return { kind: 'indexer', downloadHistory, indexerId: indexer.id };
}
