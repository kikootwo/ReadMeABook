/**
 * Component: Post-Import Library Scan
 * Documentation: documentation/phase3/file-organization.md
 *
 * After a successful import, asks Plex or Audiobookshelf to scan the library the
 * files landed in, when the backend's scan-after-import setting is on.
 */

import { RMABLogger } from '../utils/logger';
import { getLibraryService } from '../services/library';
import { getConfigService } from '../services/config.service';

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
    return configService.get('plex_audiobook_library_id');
  }
  if (kind === 'ebook') {
    const ebookLibraryId = await configService.get('audiobookshelf.ebook_library_id');
    if (ebookLibraryId) return ebookLibraryId;
  }
  return configService.get('audiobookshelf.library_id');
}

/**
 * Trigger a library scan after import if enabled for the active backend.
 * Non-fatal: logs on failure but does not fail the job (scheduled scans will
 * eventually detect the book).
 */
export async function triggerScanAfterImport(
  kind: ImportedMediaKind,
  logger: RMABLogger
): Promise<void> {
  const configService = getConfigService();
  const backendMode = await configService.getBackendMode();
  const configKey = backendMode === 'audiobookshelf'
    ? 'audiobookshelf.trigger_scan_after_import'
    : 'plex.trigger_scan_after_import';

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

    // Get library service (returns PlexLibraryService or AudiobookshelfLibraryService)
    const libraryService = await getLibraryService();
    await libraryService.triggerLibraryScan(libraryId);
    logger.info(`Triggered ${backendMode} filesystem scan for library ${libraryId}`);
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
