/**
 * Component: Download Cleanup in a Category ReadMeABook Did Not Create
 * Documentation: documentation/phase3/file-organization.md
 *
 * A usenet category that already existed in the client (another app's) brings its own folder,
 * sorter and script, so a job's folder can also hold that app's files. Cleanup there removes
 * only the verified imported files, then folders that became empty; never a recursive delete.
 */

import * as path from 'path';
import type { RMABLogger } from '../utils/logger';
import type { ConfigurationService } from '../services/config.service';
import { getDownloadClientManager } from '../services/download-client-manager.service';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '../interfaces/download-client.interface';
import { isSharedCategory } from '../utils/download-category';
import type { ImportEvidence } from '../utils/import-inventory';

/** True when the job's usenet client is configured with a category ReadMeABook did not create */
export async function usenetCategoryIsShared(
  clientType: string | null | undefined,
  configService: ConfigurationService
): Promise<boolean> {
  if (!clientType || CLIENT_PROTOCOL_MAP[clientType as DownloadClientType] !== 'usenet') return false;
  const config = await getDownloadClientManager(configService).getClientForProtocol('usenet');
  if (!config || config.type !== clientType) return false;
  return isSharedCategory(config.type, config.category, config.ownedCategory);
}

function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Unlink each verified imported file under `sourceFolder` (acting on `deleteFolder`, the guard's
 * canonical path for it), then remove each emptied folder up to and including `deleteFolder`
 * with a plain rmdir, which fails on anything still inside. Returns true when the folder is gone.
 */
export async function removeImportedFilesOnly(
  sourceFolder: string,
  deleteFolder: string,
  evidence: ImportEvidence,
  logger: RMABLogger
): Promise<boolean> {
  const fs = await import('fs/promises');
  let removed = 0;
  const emptied = new Set<string>();

  for (const record of evidence.records) {
    if (!record.verified) continue;
    const rel = path.relative(sourceFolder, path.resolve(record.source));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const target = path.join(deleteFolder, rel);
    try {
      const stats = await fs.lstat(target);
      if (stats.isDirectory()) continue;
      await fs.unlink(target);
      removed++;
      emptied.add(path.dirname(target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  // Deepest first, so a removed child can leave its parent empty
  const candidates = new Set<string>();
  for (let dir of emptied) {
    while (isWithin(dir, deleteFolder)) {
      candidates.add(dir);
      if (path.resolve(dir) === path.resolve(deleteFolder)) break;
      dir = path.dirname(dir);
    }
  }
  for (const dir of [...candidates].sort((a, b) => b.length - a.length)) {
    await fs.rmdir(dir).catch(() => undefined); // ENOTEMPTY: something else lives there; it stays
  }

  const folderGone = await fs.lstat(deleteFolder).then(() => false, () => true);
  logger.info(
    `Category already existed in the client: removed ${removed} imported file(s) from ${deleteFolder}` +
      (folderGone ? ' and the emptied folder' : '; other files there were left alone')
  );
  return folderGone;
}
