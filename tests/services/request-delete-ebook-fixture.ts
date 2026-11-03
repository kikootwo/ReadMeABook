/**
 * Component: Ebook Request Delete Test Fixture (real temp library folders)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Shared by the ebook request delete tests: a temp media library, title folders
 * as an import leaves them, and placement record entries computed from the file
 * on disk (as RMAB stores them in Request.placedEbookFiles).
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateFilesHash } from '@/lib/utils/files-hash';

export interface Library {
  root: string;
  media: string;
  downloads: string;
}

export function makeLibrary(prefix: string): Library {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const media = path.join(root, 'media');
  const downloads = path.join(root, 'downloads');
  fs.mkdirSync(media, { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });
  return { root, media, downloads };
}

export function write(file: string, content = 'x'): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/** An imported title folder: audio + cover (+ extra files). */
export function imported(media: string, rel: string, audio = ['Book.m4b'], extra: string[] = []): string {
  const dir = path.join(media, rel);
  for (const name of [...audio, 'cover.jpg', ...extra]) write(path.join(dir, name), `${name} bytes`);
  return dir;
}

export function book(filePath: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id: 'book-1',
    title: 'Book',
    author: 'Author',
    narrator: null,
    audibleAsin: 'B0TEST0001',
    plexGuid: null,
    absItemId: 'abs-1',
    filePath,
    fileFormat: 'epub',
    filesHash: generateFilesHash(['Book.m4b']),
    ...overrides,
  };
}

/** A placement record entry for `file` as it is on disk now. */
export function entryFor(file: string) {
  const data = fs.readFileSync(file);
  return {
    path: file,
    size: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    placedAt: '2026-10-01T00:00:00.000Z',
  };
}

/** The ebook request row deleteRequest loads (scalars plus the included book). */
export function ebookRequest(
  audiobook: ReturnType<typeof book>,
  fields: { status?: string; completedAt?: Date | null; placedEbookFiles?: unknown } = {}
) {
  return {
    id: 'req-1',
    type: 'ebook',
    status: fields.status ?? 'downloaded',
    completedAt: fields.completedAt === undefined ? new Date('2026-10-01T00:00:00Z') : fields.completedAt,
    placedEbookFiles: fields.placedEbookFiles === undefined ? null : fields.placedEbookFiles,
    audiobook,
    downloadHistory: [],
  };
}

/** Every file below `dir` with its bytes (to prove a folder is byte for byte unchanged). */
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
    const full = path.join(dir, rel);
    const stat = fs.lstatSync(full);
    if (stat.isFile()) out[rel.replace(/\\/g, '/')] = fs.readFileSync(full).toString('hex');
  }
  return out;
}
