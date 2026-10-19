/**
 * Component: Post-Organize Cleanup Guard Helpers (protected roots, guarded delete, parent sweep)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as path from 'path';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getEncryptionService } from '../services/encryption.service';
import { isPathBelowBoundary, normalizePath, removeEmptyParentDirectories } from '../utils/cleanup-helpers';
import { assertSafeToDelete, canonicalPath, DeleteGuardContext, UnsafeDeleteError } from '../utils/delete-guard';
import { getMediaDir } from '../utils/media-dir';

const BOOKDROP_PATH = '/bookdrop';

export type GuardRoots = Omit<DeleteGuardContext, 'targetPath' | 'allowMediaSources'>;

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

    const clientsJson = await readConfigStrict('download_clients');
    if (clientsJson) {
      const clients = JSON.parse(clientsJson) as unknown;
      if (!Array.isArray(clients)) {
        throw new Error('download_clients is not a list');
      }
      for (const client of clients as Array<{ customPath?: string; remotePathMappingEnabled?: boolean; localPath?: string }>) {
        if (client.customPath) {
          downloadRoots.add(path.join(downloadDir, client.customPath));
        }
        if (client.remotePathMappingEnabled && client.localPath) {
          downloadRoots.add(client.localPath);
        }
      }
    } else if ((await readConfigStrict('download_client_remote_path_mapping_enabled')) === 'true') {
      const legacyLocalPath = await readConfigStrict('download_client_local_path');
      if (legacyLocalPath) {
        downloadRoots.add(legacyLocalPath);
      }
    }

    return { mediaDir, downloadRoots: [...downloadRoots], otherRoots: [BOOKDROP_PATH] };
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
 * Remove empty parent directories above a deleted path, bounded by the nearest
 * configured root that contains it. The sweep never removes a configured root
 * (download_dir, a client customPath or mapped localPath, media_dir, bookdrop)
 * and never climbs from a download root into a media dir above it.
 */
export async function sweepEmptyParents(
  deletedPath: string,
  roots: GuardRoots,
  jobId: string | undefined,
  logger: RMABLogger,
  context: string
): Promise<void> {
  const canonicalRoots = await Promise.all(
    [roots.mediaDir, ...roots.downloadRoots, ...(roots.otherRoots || [])].filter(Boolean).map(canonicalPath)
  );
  const deleted = normalizePath(await canonicalPath(deletedPath));
  const boundary = canonicalRoots
    .filter((root) => isPathBelowBoundary(deleted, normalizePath(root)))
    .sort((a, b) => b.length - a.length)[0];

  if (!boundary) {
    logger.info(`No configured root contains ${deletedPath}, leaving parent directories alone`);
    return;
  }

  const cleanupResult = await removeEmptyParentDirectories(deleted, {
    boundaryPath: boundary,
    protectedPaths: canonicalRoots,
    logContext: jobId ? { jobId, context } : undefined,
  });

  if (cleanupResult.removedDirectories.length > 0) {
    logger.info(`Cleaned up ${cleanupResult.removedDirectories.length} empty parent directories`);
  }
}
