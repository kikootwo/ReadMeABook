/**
 * Component: Admin Filesystem Browse API
 * Documentation: documentation/features/manual-import.md
 *
 * Lets admins browse server directories for manual audiobook import.
 * Restricted to download_dir and media_dir roots only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { AUDIO_EXTENSIONS } from '@/lib/constants/audio-formats';

const logger = RMABLogger.create('API.Admin.Filesystem.Browse');

interface DirectoryEntry {
  name: string;
  type: 'directory';
}

/**
 * Load allowed root directories from Configuration table.
 */
const BOOKDROP_PATH = '/bookdrop';

async function getAllowedRoots(): Promise<{ downloadDir: string | null; mediaDir: string | null; bookdropExists: boolean }> {
  const downloadDirConfig = await prisma.configuration.findUnique({
    where: { key: 'download_dir' },
  });
  const mediaDirConfig = await prisma.configuration.findUnique({
    where: { key: 'media_dir' },
  });

  let bookdropExists = false;
  try {
    const fs = await import('fs/promises');
    const stat = await fs.stat(BOOKDROP_PATH);
    bookdropExists = stat.isDirectory();
  } catch {
    /* not mounted */
  }

  return {
    downloadDir: downloadDirConfig?.value || null,
    mediaDir: mediaDirConfig?.value || null,
    bookdropExists,
  };
}

/**
 * Check if a normalized path is within one of the allowed roots.
 */
function isPathAllowed(normalizedPath: string, roots: string[]): boolean {
  return roots.some(
    (root) => normalizedPath === root || normalizedPath.startsWith(root + '/')
  );
}

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const pathModule = await import('path');
        const fs = await import('fs/promises');

        const { downloadDir, mediaDir, bookdropExists } = await getAllowedRoots();
        const requestedPath = request.nextUrl.searchParams.get('path');

        // No path param: return root directories
        if (!requestedPath) {
          const roots: Array<{ name: string; path: string; icon: string }> = [];
          if (downloadDir) {
            roots.push({ name: 'Downloads', path: downloadDir, icon: 'download' });
          }
          if (mediaDir) {
            roots.push({ name: 'Media Library', path: mediaDir, icon: 'library' });
          }
          if (bookdropExists) {
            roots.push({ name: 'Book Drop', path: BOOKDROP_PATH, icon: 'bookdrop' });
          }

          if (roots.length === 0) {
            return NextResponse.json(
              { error: 'No browsable directories available' },
              { status: 400 }
            );
          }

          return NextResponse.json({ roots });
        }

        // Path param provided: browse that directory
        // Normalize to forward slashes and resolve
        const normalizedPath = pathModule.resolve(requestedPath).replace(/\\/g, '/');

        // Build list of allowed roots (normalized)
        const allowedRoots: string[] = [];
        if (downloadDir) allowedRoots.push(pathModule.resolve(downloadDir).replace(/\\/g, '/'));
        if (mediaDir) allowedRoots.push(pathModule.resolve(mediaDir).replace(/\\/g, '/'));
        if (bookdropExists) allowedRoots.push(pathModule.resolve(BOOKDROP_PATH).replace(/\\/g, '/'));

        if (!isPathAllowed(normalizedPath, allowedRoots)) {
          logger.warn(`Access denied: ${normalizedPath} is outside allowed directories`);
          return NextResponse.json(
            { error: 'Access denied: path outside allowed directories' },
            { status: 403 }
          );
        }

        // Read directory entries
        const dirEntries = await fs.readdir(normalizedPath, { withFileTypes: true });

        // List subdirectories (no nested stat calls — keeps browsing fast)
        const entries: DirectoryEntry[] = dirEntries
          .filter((e) => e.isDirectory())
          .map((entry) => ({ name: entry.name, type: 'directory' as const }))
          .sort((a, b) => a.name.localeCompare(b.name));

        // Gather audio files in the current directory
        const audioFiles: Array<{ name: string; size: number }> = [];
        for (const entry of dirEntries) {
          if (entry.isFile()) {
            const ext = pathModule.extname(entry.name).toLowerCase();
            if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
              try {
                const stat = await fs.stat(pathModule.join(normalizedPath, entry.name));
                audioFiles.push({ name: entry.name, size: stat.size });
              } catch {
                audioFiles.push({ name: entry.name, size: 0 });
              }
            }
          }
        }
        audioFiles.sort((a, b) => a.name.localeCompare(b.name));

        return NextResponse.json({ path: normalizedPath, entries, audioFiles });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;

        if (code === 'ENOENT') {
          return NextResponse.json({ error: 'Directory not found' }, { status: 404 });
        }
        if (code === 'EACCES' || code === 'EPERM') {
          return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
        }

        logger.error('Failed to browse directory', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'Failed to browse directory' },
          { status: 500 }
        );
      }
    });
  });
}
