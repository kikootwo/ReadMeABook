/**
 * Component: Post-Import Library Scan
 * Documentation: documentation/phase3/file-organization.md
 *
 * After a successful import, asks the active backend (Plex, Audiobookshelf or
 * AudioSilo) to scan the library the files landed in, when the backend's
 * scan-after-import setting is on.
 */

import { RMABLogger } from '../utils/logger';
import { getLibraryService } from '../services/library';
import { getConfigService } from '../services/config.service';
import { getMediaDir } from '../utils/media-dir';
import { libraryRelativePath } from '../utils/library-relative-path';
import { triggerScanConfigKey, libraryIdConfigKey, type BackendMode } from '../constants/backend-mode';

export type ImportedMediaKind = 'audiobook' | 'ebook';

/**
 * The library to scan for an import of this kind. Audiobookshelf ebooks use the
 * ebook library when one is set, else the audiobook library; Plex has only the
 * audiobook library.
 */
async function resolveScanLibraryId(
  backendMode: string,
  kind: ImportedMediaKind
): Promise<string | null> {
  const configService = getConfigService();
  if (backendMode !== 'audiobookshelf') {
    // Plex and AudioSilo have a single library each
    return configService.get(libraryIdConfigKey(backendMode as BackendMode));
  }
  if (kind === 'ebook') {
    const ebookLibraryId = await configService.get('audiobookshelf.ebook_library_id');
    if (ebookLibraryId) return ebookLibraryId;
  }
  return configService.get('audiobookshelf.library_id');
}

/**
 * Trigger a library scan after import if enabled for the active backend.
 * `importedPath` is the absolute path of the imported book folder; AudioSilo
 * uses it to refresh just that book, the other backends scan the whole library.
 * Non-fatal: logs on failure but does not fail the job (scheduled scans will
 * eventually detect the book).
 */
export async function triggerScanAfterImport(
  kind: ImportedMediaKind,
  logger: RMABLogger,
  importedPath?: string
): Promise<void> {
  const configService = getConfigService();
  const backendMode = await configService.getBackendMode();
  const configKey = triggerScanConfigKey(backendMode);

  if (await configService.get(configKey) !== 'true') {
    logger.info(`${backendMode} filesystem scan trigger disabled (relying on filesystem watcher)`);
    return;
  }

  try {
    const libraryId = await resolveScanLibraryId(backendMode, kind);
    if (!libraryId) {
      logger.warn(`Library ID not configured for ${backendMode}, skipping ${kind} scan`);
      return;
    }

    // Get library service (Plex, Audiobookshelf or AudioSilo)
    const libraryService = await getLibraryService();
    const bookPath = backendMode === 'audiosilo' && importedPath
      ? libraryRelativePath(importedPath, await getMediaDir())
      : undefined;
    if (bookPath) {
      await libraryService.triggerLibraryScan(libraryId, bookPath);
    } else {
      await libraryService.triggerLibraryScan(libraryId);
    }
    logger.info(
      `Triggered ${backendMode} filesystem scan for library ${libraryId}${bookPath ? ` (book: ${bookPath})` : ''}`
    );
  } catch (error) {
    logger.error(
      `Failed to trigger filesystem scan: ${error instanceof Error ? error.message : 'Unknown error'}`,
      {
        error: error instanceof Error ? error.stack : undefined,
        backend: backendMode,
      }
    );
  }
}
