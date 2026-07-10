/**
 * Component: Filesystem Path Reachability Check
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Shared helper: is an absolute path reachable AND writable by the RMAB
 * container's filesystem? Used by the ebook custom-destination check-path API
 * (immediate admin feedback) and by the organizer's destination resolver
 * (safe fallback to the default media dir when a custom path is unusable), so
 * both agree on what "reachable" means.
 */

import { promises as fs, constants as fsConstants } from 'fs';

export interface PathReachability {
  reachable: boolean;
  message: string;
}

/**
 * Check whether `path` is an absolute path that exists, is a directory, and is
 * writable inside the container. Never throws — unexpected errors are returned
 * as `reachable: false` with the error message.
 */
export async function checkPathReachable(path: string): Promise<PathReachability> {
  const target = (path || '').trim();

  if (!target) {
    return { reachable: false, message: 'No path provided.' };
  }
  if (!target.startsWith('/')) {
    return {
      reachable: false,
      message: 'Path must be an absolute path inside the container (start with "/").',
    };
  }

  try {
    const stats = await fs.stat(target);
    if (!stats.isDirectory()) {
      return { reachable: false, message: 'Path exists but is not a directory.' };
    }
    await fs.access(target, fsConstants.W_OK);
    return { reachable: true, message: 'Path is reachable and writable by the container.' };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return {
        reachable: false,
        message: 'Path does not exist inside the container. Make sure it is mounted into the RMAB container as a volume.',
      };
    }
    if (code === 'EACCES') {
      return {
        reachable: false,
        message: 'Directory is reachable but not writable by the container. Check the volume/folder permissions.',
      };
    }
    return { reachable: false, message: error instanceof Error ? error.message : 'Unknown error' };
  }
}
