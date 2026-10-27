/**
 * Component: Manual Import request and ebook selection
 * Documentation: documentation/features/manual-import.md
 *
 * Which request a Manual Import works on (the stored request's type decides, never the
 * client's flag alone), recycling or creating it, and the ebook-file selection for an ebook
 * import. An ebook import only ever touches ebook requests.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '@/lib/db';
import { isEbookFile } from '@/lib/utils/import-inventory';

export type ImportKind = 'audiobook' | 'ebook';

/** Statuses that indicate the request is actively being worked on. */
const ACTIVE_STATUSES = ['searching', 'downloading', 'processing', 'awaiting_import'];

/** Statuses that can be recycled for a new manual import (plus delivered ones: a re-import). */
const RECYCLABLE_STATUSES = ['failed', 'warn', 'cancelled', 'denied', 'pending', 'awaiting_search', 'awaiting_approval', 'downloaded', 'available'];

type Refusal = { ok: false; status: 400 | 404 | 409; error: string };
const refuse = (status: Refusal['status'], error: string): Refusal => ({ ok: false, status, error });

export interface StoredRequest {
  id: string;
  type: string;
  audiobookId: string;
  status: string;
}

/**
 * The request a body names (`requestId`) and the import kind. The stored request's type
 * decides; a `requestType` that disagrees with it, or an unknown one, is a 400.
 */
export async function resolveImportTarget(
  requestId: unknown,
  requestType: unknown
): Promise<{ ok: true; kind: ImportKind; stored: StoredRequest | null } | Refusal> {
  if (requestType !== undefined && requestType !== 'audiobook' && requestType !== 'ebook') {
    return refuse(400, 'requestType must be "audiobook" or "ebook"');
  }
  const flag = requestType as ImportKind | undefined;
  if (requestId === undefined || requestId === null) {
    return { ok: true, kind: flag ?? 'audiobook', stored: null };
  }
  if (typeof requestId !== 'string' || requestId === '') return refuse(400, 'requestId must be a string');

  const stored = await prisma.request.findFirst({ where: { id: requestId, deletedAt: null } });
  if (!stored) return refuse(404, 'Request not found');
  const kind: ImportKind = stored.type === 'ebook' ? 'ebook' : 'audiobook';
  if (flag !== undefined && flag !== kind) {
    return refuse(400, `Request ${stored.id} is an ${kind} request, not an ${flag} request`);
  }
  return { ok: true, kind, stored };
}

/**
 * The request the import runs on, set to `processing`: the named request, else the book's
 * newest request of this kind, recycled in place; otherwise a new one. A new ebook request
 * links to the book's delivered audiobook request, as the ebook routes do.
 */
export async function claimImportRequest(opts: {
  kind: ImportKind;
  audiobookId: string;
  userId: string;
  stored: StoredRequest | null;
}): Promise<{ ok: true; requestId: string; recycled: boolean } | Refusal> {
  const { kind, audiobookId, userId, stored } = opts;
  const existing = stored ?? (await prisma.request.findFirst({
    where: { audiobookId, type: kind, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  }));

  if (existing && ACTIVE_STATUSES.includes(existing.status)) {
    return refuse(409, `This ${kind} is already being processed`);
  }
  if (existing && RECYCLABLE_STATUSES.includes(existing.status)) {
    await prisma.request.update({
      where: { id: existing.id },
      data: {
        status: 'processing',
        progress: 100,
        errorMessage: null,
        importAttempts: 0,
        autoRerequestCount: 0, // a manual import restarts the automatic re-request backoff
        updatedAt: new Date(),
      },
    });
    return { ok: true, requestId: existing.id, recycled: true };
  }

  // No request, or one in a status we do not recycle: a new one
  const parent = kind === 'ebook'
    ? await prisma.request.findFirst({
        where: { audiobookId, type: 'audiobook', deletedAt: null, status: { in: ['available', 'downloaded'] } },
        orderBy: { createdAt: 'desc' },
      })
    : null;
  const created = await prisma.request.create({
    data: {
      userId,
      audiobookId,
      type: kind,
      status: 'processing',
      progress: 100,
      ...(kind === 'ebook' ? { parentRequestId: parent?.id ?? null } : {}),
    },
  });
  return { ok: true, requestId: created.id, recycled: false };
}

/**
 * Ebook files for an ebook import of `folder`: the selected names (files directly in the
 * folder, ebook extensions only), else every ebook file directly in it. Always an explicit
 * list, so the organizer and any source cleanup stay on these files.
 */
export async function resolveEbookSelection(
  folder: string,
  selectedFiles: string[] | undefined
): Promise<{ ok: true; files: string[] } | Refusal> {
  if (!selectedFiles || selectedFiles.length === 0) {
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    const files = entries.filter((e) => e.isFile() && isEbookFile(e.name)).map((e) => e.name).sort();
    return files.length > 0 ? { ok: true, files } : refuse(400, 'No ebook files found in the selected directory');
  }

  for (const fileName of selectedFiles) {
    if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('\0') || fileName === '..' || fileName === '.') {
      return refuse(400, `Invalid file name: ${fileName}`);
    }
    if (!isEbookFile(fileName)) return refuse(400, `Not an ebook file: ${fileName}`);
    try {
      if (!(await fs.stat(path.join(folder, fileName))).isFile()) return refuse(400, `Not a file: ${fileName}`);
    } catch {
      return refuse(404, `File not found: ${fileName}`);
    }
  }
  return { ok: true, files: [...selectedFiles] };
}
