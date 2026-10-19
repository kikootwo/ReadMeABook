/**
 * Cleanup Helpers Utility
 * Documentation: documentation/phase3/sabnzbd.md
 *
 * Provides utilities for cleaning up after file organization,
 * including removal of empty parent directories.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { RMABLogger } from './logger';

const logger = RMABLogger.create('CleanupHelpers');

/**
 * Options for removeEmptyParentDirectories
 */
export interface RemoveEmptyParentOptions {
  /** The boundary path - will never delete this directory or its parents */
  boundaryPath: string;
  /** Optional logger context for job-aware logging */
  logContext?: { jobId: string; context: string };
  /** Directories that are never removed even when empty (e.g. configured roots); the sweep stops there */
  protectedPaths?: string[];
}

/**
 * Removes empty parent directories after a file/directory has been deleted.
 *
 * This function walks up the directory tree from the deleted path, removing
 * any empty directories until it encounters a non-empty directory or reaches
 * the configured boundary path.
 *
 * Use case: SABnzbd downloads to /downloads/readmeabook/My.Audiobook.Name/
 * After deleting the download folder, the category folder (readmeabook) may
 * be left empty. This function cleans up those empty parent folders.
 *
 * Safety features:
 * - Will NEVER delete the boundary path itself (e.g., download_dir)
 * - Will NEVER delete above the boundary path
 * - Gracefully handles ENOENT (already deleted)
 * - Gracefully handles permission errors (logs warning, continues)
 * - Stops immediately when a non-empty directory is encountered
 *
 * @param deletedPath - The path that was just deleted (file or directory)
 * @param options - Configuration options including boundary path
 * @returns Object with details about what was cleaned up
 *
 * @example
 * // After deleting /downloads/readmeabook/My.Audiobook.Name
 * await removeEmptyParentDirectories(
 *   '/downloads/readmeabook/My.Audiobook.Name',
 *   { boundaryPath: '/downloads' }
 * );
 * // This will remove /downloads/readmeabook if it's empty
 * // but will never touch /downloads
 */
export async function removeEmptyParentDirectories(
  deletedPath: string,
  options: RemoveEmptyParentOptions
): Promise<{
  success: boolean;
  removedDirectories: string[];
  stoppedAt?: string;
  stoppedReason?: 'non_empty' | 'boundary_reached' | 'root_reached' | 'error';
  error?: string;
}> {
  const log = options.logContext
    ? RMABLogger.forJob(options.logContext.jobId, options.logContext.context)
    : logger;

  const removedDirectories: string[] = [];

  try {
    // Normalize paths for consistent comparison
    const normalizedBoundary = normalizePath(options.boundaryPath);
    const protectedPaths = new Set((options.protectedPaths || []).map(normalizePath));
    let currentPath = normalizePath(path.dirname(deletedPath));

    log.debug('Starting empty parent directory cleanup', {
      deletedPath,
      boundaryPath: options.boundaryPath,
      normalizedBoundary,
      startingFrom: currentPath,
    });

    // Walk up the directory tree
    while (true) {
      // Safety check: Have we reached the filesystem root?
      const parentPath = normalizePath(path.dirname(currentPath));
      if (parentPath === currentPath) {
        log.debug('Reached filesystem root, stopping cleanup');
        return {
          success: true,
          removedDirectories,
          stoppedAt: currentPath,
          stoppedReason: 'root_reached',
        };
      }

      // Safety check: Have we reached or passed the boundary?
      if (!isPathBelowBoundary(currentPath, normalizedBoundary)) {
        log.debug('Reached boundary path, stopping cleanup', {
          currentPath,
          boundaryPath: normalizedBoundary,
        });
        return {
          success: true,
          removedDirectories,
          stoppedAt: currentPath,
          stoppedReason: 'boundary_reached',
        };
      }

      // Safety check: never remove a protected directory
      if (protectedPaths.has(currentPath)) {
        log.debug('Reached protected directory, stopping cleanup', { currentPath });
        return {
          success: true,
          removedDirectories,
          stoppedAt: currentPath,
          stoppedReason: 'boundary_reached',
        };
      }

      // Check if the directory is empty
      const isEmpty = await isDirectoryEmpty(currentPath);

      if (isEmpty === null) {
        // Directory doesn't exist (ENOENT) - move to parent
        log.debug(`Directory does not exist, moving to parent: ${currentPath}`);
        currentPath = parentPath;
        continue;
      }

      if (!isEmpty) {
        // Directory is not empty - stop here
        log.debug(`Directory not empty, stopping cleanup: ${currentPath}`);
        return {
          success: true,
          removedDirectories,
          stoppedAt: currentPath,
          stoppedReason: 'non_empty',
        };
      }

      // Directory is empty - try to remove it
      try {
        await fs.rmdir(currentPath);
        removedDirectories.push(currentPath);
        log.info(`Removed empty directory: ${currentPath}`);
      } catch (removeError) {
        const errorCode = (removeError as NodeJS.ErrnoException).code;

        if (errorCode === 'ENOENT') {
          // Already deleted (race condition) - continue to parent
          log.debug(`Directory already deleted: ${currentPath}`);
        } else if (errorCode === 'ENOTEMPTY') {
          // Directory became non-empty (race condition) - stop
          log.debug(`Directory became non-empty: ${currentPath}`);
          return {
            success: true,
            removedDirectories,
            stoppedAt: currentPath,
            stoppedReason: 'non_empty',
          };
        } else if (errorCode === 'EACCES' || errorCode === 'EPERM') {
          // Permission error - log warning and stop
          log.warn(`Permission denied removing directory: ${currentPath}`, {
            error: removeError instanceof Error ? removeError.message : String(removeError),
          });
          return {
            success: true, // Partial success - we cleaned what we could
            removedDirectories,
            stoppedAt: currentPath,
            stoppedReason: 'error',
            error: `Permission denied: ${currentPath}`,
          };
        } else {
          // Unexpected error - log and stop
          log.error(`Failed to remove directory: ${currentPath}`, {
            error: removeError instanceof Error ? removeError.message : String(removeError),
            errorCode,
          });
          return {
            success: false,
            removedDirectories,
            stoppedAt: currentPath,
            stoppedReason: 'error',
            error: removeError instanceof Error ? removeError.message : String(removeError),
          };
        }
      }

      // Move to parent directory
      currentPath = parentPath;
    }
  } catch (error) {
    log.error('Unexpected error during empty parent cleanup', {
      error: error instanceof Error ? error.message : String(error),
      deletedPath,
      boundaryPath: options.boundaryPath,
    });
    return {
      success: false,
      removedDirectories,
      stoppedReason: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Checks if a directory is empty
 *
 * @param dirPath - Path to the directory
 * @returns true if empty, false if not empty, null if directory doesn't exist
 */
async function isDirectoryEmpty(dirPath: string): Promise<boolean | null> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.length === 0;
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;

    if (errorCode === 'ENOENT') {
      // Directory doesn't exist
      return null;
    }

    if (errorCode === 'ENOTDIR') {
      // Path is a file, not a directory
      return null;
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Checks if a path is strictly below (inside) the boundary path
 *
 * A path is below the boundary if:
 * - It's longer than the boundary path
 * - It starts with the boundary path followed by a path separator
 *
 * @param testPath - The path to test (must be normalized)
 * @param boundaryPath - The boundary path (must be normalized)
 * @returns true if testPath is strictly below boundaryPath
 */
export function isPathBelowBoundary(testPath: string, boundaryPath: string): boolean {
  // Ensure both paths don't have trailing slashes for comparison
  const normalizedTest = testPath.replace(/\/+$/, '');
  const normalizedBoundary = boundaryPath.replace(/\/+$/, '');

  // Path must be strictly below boundary, not equal to it
  if (normalizedTest === normalizedBoundary) {
    return false;
  }

  // Check if test path is under boundary path
  // Must start with boundary + separator to avoid matching /downloads2 when boundary is /downloads
  return normalizedTest.startsWith(normalizedBoundary + '/');
}

/**
 * Normalizes a file path for consistent comparison
 *
 * @param filePath - Path to normalize
 * @returns Normalized path with forward slashes and no trailing slash
 */
export function normalizePath(filePath: string): string {
  // Convert backslashes to forward slashes
  let normalized = filePath.replace(/\\/g, '/');

  // Use path.normalize to handle redundant separators and ..
  normalized = path.normalize(normalized);

  // Convert backslashes again (path.normalize might add them on Windows)
  normalized = normalized.replace(/\\/g, '/');

  // Remove trailing slash (except for root '/')
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}
