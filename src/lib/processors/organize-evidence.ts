/**
 * Component: Organize Import Evidence (what reached the library, and what the request should say)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as path from 'path';
import type { RMABLogger } from '../utils/logger';
import { getConfigService } from '../services/config.service';
import { planDownloadCleanup } from './organize-cleanup-guard';
import { ebookInventory, type ImportEvidence, type ImportInventory, type PlacementRecord } from '../utils/import-inventory';
import type { EbookOrganizationResult, OrganizationResult } from '../utils/file-organizer';
import { summarizePermissionWarnings } from '../utils/organize-copy';

/**
 * True when this job may delete source files after organizing (manual
 * cleanupSource, or a download that cleanup would remove). Only then are
 * same-size existing library files compared byte-for-byte.
 */
export async function deleteMayFollow(
  requestId: string,
  downloadPath: string,
  downloadHistoryId: string | undefined,
  cleanupSource: boolean | undefined
): Promise<boolean> {
  if (cleanupSource === true) {
    return true;
  }
  try {
    const plan = await planDownloadCleanup(requestId, downloadPath, downloadHistoryId, () =>
      getConfigService().get('prowlarr_indexers')
    );
    return plan !== null;
  } catch {
    // Unknown: compare, so a later delete is never based on an unchecked file
    return true;
  }
}

const MISSING_INVENTORY: ImportInventory = { kind: 'audio', files: [], complete: false };

export function audioEvidence(result: OrganizationResult): ImportEvidence {
  return {
    records: result.records ?? [],
    coverRecord: result.coverRecord,
    inventory: result.inventory ?? MISSING_INVENTORY,
    permissionWarnings: result.permissionWarnings,
  };
}

/** Ebook evidence, keyed on the original file (the organizer reads a temp copy when the Kindle fix ran). */
export async function ebookEvidence(
  result: EbookOrganizationResult,
  importedFile: string | undefined,
  downloadPath: string
): Promise<ImportEvidence> {
  return {
    records: result.record && importedFile ? [{ ...result.record, source: importedFile }] : [],
    inventory: await ebookInventory(downloadPath),
    permissionWarnings: result.permissionWarnings,
  };
}

/**
 * Short message for the request when the import was not complete, or null.
 * Examples: "1 of 3 files not imported; source files kept",
 * "already in the library with different content; source kept",
 * "merged file kept; sources kept". A note is appended when file permissions
 * could not be applied ("permissions could not be applied to 2 files").
 */
export function importStatusMessage(evidence: ImportEvidence): string | null {
  const message = placementStatusMessage(evidence);
  const refused = evidence.permissionWarnings?.length ?? 0;
  if (refused === 0) return message;
  const note = `permissions could not be applied to ${refused} file${refused === 1 ? '' : 's'}`;
  return message ? `${message}; ${note}` : note;
}

function placementStatusMessage(evidence: ImportEvidence): string | null {
  const total = evidence.records.length;
  const failed = evidence.records.filter((r) => r.status === 'failed');
  const differs = evidence.records.filter((r) => r.status === 'differs');
  const unverifiedCopies = evidence.records.filter((r) => r.status === 'copied' && !r.verified);
  const incomplete = !evidence.inventory.complete && evidence.inventory.files.length > 0;

  if (total > 0 && differs.length === total) {
    return 'already in the library with different content; source kept';
  }
  if (failed.length === 0 && differs.length === 0 && unverifiedCopies.length > 0 && !incomplete) {
    return 'merged file kept; sources kept';
  }

  const parts: string[] = [];
  if (failed.length > 0) parts.push(`${failed.length} of ${total} files not imported`);
  if (differs.length > 0) parts.push(`${differs.length} of ${total} files already in the library with different content`);
  if (unverifiedCopies.length > 0) parts.push('merged file kept');
  if (incomplete) parts.push('source folder could not be fully read');
  return parts.length > 0 ? `${parts.join('; ')}; source files kept` : null;
}

/** Log detail for the records behind importStatusMessage. */
export function describeUnverified(records: PlacementRecord[]): string {
  return records
    .filter((r) => !r.verified && r.status !== 'present')
    .map((r) => `${path.basename(r.source)} (${r.status}${r.reason ? `: ${r.reason}` : ''})`)
    .join(', ');
}

/** The request message for this import (or null), logged with the files behind it. */
export function reportImportStatus(evidence: ImportEvidence, logger: RMABLogger): string | null {
  const message = importStatusMessage(evidence);
  const placement = placementStatusMessage(evidence);
  if (placement) {
    logger.warn(`${placement}: ${describeUnverified(evidence.records)}`);
  }
  // One line per job, however many files were affected
  const permissions = summarizePermissionWarnings(evidence.permissionWarnings);
  if (permissions) logger.warn(permissions);
  return message;
}
