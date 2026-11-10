/**
 * Component: Download Cleanup in a Category ReadMeABook Did Not Create
 * Documentation: documentation/phase3/file-organization.md
 *
 * A usenet category that already existed in the client (another app's) brings its own folder,
 * sorter and script, so a job's folder can also hold that app's files. The mode is decided from
 * the job as its client reports it now and fails closed: only a job in ReadMeABook's own category
 * gets the whole-folder removal. Every other job gets the careful mode (verified imported files,
 * then folders that became empty, never a recursive delete, never above the job folder), and no
 * removal at all when the job has no folder of its own or the client can't be read.
 */

import * as path from 'path';
import type { RMABLogger } from '../utils/logger';
import type { ConfigurationService } from '../services/config.service';
import { getDownloadClientManager, type DownloadClientConfig } from '../services/download-client-manager.service';
import { CLIENT_PROTOCOL_MAP, DownloadClientType, type DownloadInfo, type IDownloadClient } from '../interfaces/download-client.interface';
import { ownsCategory } from '../utils/download-category';
import { isAbsoluteClientPath, normalizeClientPath } from '../utils/client-path';
import { normalizePath } from '../utils/cleanup-helpers';
import { PathMapper } from '../utils/path-mapper';
import type { ImportEvidence } from '../utils/import-inventory';

export type CleanupMode = { mode: 'full' } | { mode: 'careful' } | { mode: 'skip'; reason: string };

/** An error's message for the log, minus URL query strings and user:pass@ (an API key can ride there) */
function errorCause(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const safe = message.replace(/\?\S*/g, '').replace(/\/\/[^/\s@]*@/g, '//').replace(/(api_?key|password|token)=\S*/gi, '$1=[hidden]');
  return `: ${safe.trim().slice(0, 300) || 'unknown error'}`;
}

/** The client's folder for the job, mapped as at completion, is the download stored for the request */
function sameDownload(clientJobPath: string, storedPath: string, config: DownloadClientConfig): boolean {
  const mapped = PathMapper.transform(clientJobPath, {
    enabled: !!config.remotePathMappingEnabled, remotePath: config.remotePath || '', localPath: config.localPath || '',
  });
  return !!storedPath && normalizePath(path.resolve(mapped)) === normalizePath(path.resolve(storedPath));
}

/**
 * How to remove a finished job's download. Torrent jobs: full, as before. Usenet jobs: nothing
 * unless the client's job is this download (ids get reused); then full only when the category the
 * client reports for the job is ReadMeABook's own; otherwise careful, and skip when the job's folder
 * is (or holds) the category's folder, either isn't an absolute path, or either can't be read.
 */
export async function chooseCleanupMode(
  clientType: string | null | undefined,
  clientJobId: string | null | undefined,
  storedDownloadPath: string,
  configService: ConfigurationService
): Promise<CleanupMode> {
  if (!clientType || CLIENT_PROTOCOL_MAP[clientType as DownloadClientType] !== 'usenet') return { mode: 'full' };

  const manager = getDownloadClientManager(configService);
  let config: DownloadClientConfig | null = null;
  let service: IDownloadClient | null = null;
  let job: DownloadInfo | null = null;
  let cause = '';
  try {
    config = await manager.getClientForProtocol('usenet');
    if (config?.type === clientType && clientJobId) {
      service = await manager.createFreshService(config);
      job = await service.getDownload(clientJobId);
    }
  } catch (error) {
    service = null; // unreadable: no removal below
    cause = errorCause(error);
  }

  const category = job?.category?.trim();
  if (!config || !service || !category || !job?.downloadPath) {
    return { mode: 'skip', reason: `the job's category and folder could not be read from the usenet client${cause}` };
  }
  if (!sameDownload(job.downloadPath, storedDownloadPath, config)) {
    return { mode: 'skip', reason: `the client's job ${clientJobId} is another download now (at ${job.downloadPath})` };
  }
  if (ownsCategory(category, config.ownedCategory)) return { mode: 'full' };

  let categoryFolder: string | null = null;
  try {
    categoryFolder = (await service.getCategoryFolder?.(category)) ?? null;
  } catch (error) {
    cause = errorCause(error);
  }
  if (!categoryFolder) {
    return { mode: 'skip', reason: `the folder of category "${category}" could not be worked out from the client${cause}` };
  }

  const jobFolder = normalizeClientPath(job.downloadPath);
  const ownFolder = normalizeClientPath(categoryFolder);
  if (!isAbsoluteClientPath(jobFolder) || !isAbsoluteClientPath(ownFolder)) {
    return { mode: 'skip', reason: `the folders of the job and category "${category}" are not both absolute paths` };
  }
  if (jobFolder === ownFolder || ownFolder.startsWith(`${jobFolder}/`)) {
    return { mode: 'skip', reason: `the job has no folder of its own (it is category "${category}"'s folder ${categoryFolder})` };
  }
  return { mode: 'careful' };
}

function isOutside(rel: string): boolean {
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

/**
 * Unlink each verified imported file (audio and cover) under `sourceFolder` (acting on
 * `deleteFolder`, the guard's canonical path for it), then remove each emptied folder up to and
 * including `deleteFolder` with a plain rmdir, which fails on anything still inside. Nothing
 * above `deleteFolder` is touched. Returns true when the folder is gone.
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
  const records = evidence.coverRecord ? [...evidence.records, evidence.coverRecord] : evidence.records;

  for (const record of records) {
    if (!record.verified) continue;
    const rel = path.relative(sourceFolder, path.resolve(record.source));
    if (!rel || isOutside(rel)) continue;
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
    while (!isOutside(path.relative(deleteFolder, dir))) {
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
    `Category is not ReadMeABook's own: removed ${removed} imported file(s) from ${deleteFolder}` +
      (folderGone ? ' and the emptied folder' : '; other files there were left alone')
  );
  return folderGone;
}
