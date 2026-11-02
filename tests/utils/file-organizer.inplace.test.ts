/**
 * Component: File Organization In-Place Re-Import Tests (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { configuration: { findUnique: vi.fn(async () => null) } },
}));

import { FileOrganizer } from '@/lib/utils/file-organizer';

let root: string;
const AUDIO = Buffer.from('audio-frame-'.repeat(8192));
const COVER = Buffer.from('jpeg-bytes-'.repeat(4096));

describe('FileOrganizer in-place re-import', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-inplace-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps cover.jpg and audio byte-for-byte when the source folder already is the target', async () => {
    const media = path.join(root, 'media');
    const bookDir = path.join(media, 'Author', 'Book');
    fs.mkdirSync(bookDir, { recursive: true });
    fs.writeFileSync(path.join(bookDir, 'Book.m4b'), AUDIO);
    fs.writeFileSync(path.join(bookDir, 'cover.jpg'), COVER);

    const organizer = new FileOrganizer(media, path.join(root, 'tmp'));
    const result = await organizer.organize(bookDir, { title: 'Book', author: 'Author' }, '{author}/{title}');

    expect(result.success).toBe(true);
    expect(path.resolve(result.targetPath)).toBe(bookDir);
    const cover = fs.readFileSync(path.join(bookDir, 'cover.jpg'));
    expect(cover.length).toBeGreaterThan(0);
    expect(cover.equals(COVER)).toBe(true);
    expect(result.coverArtFile).toBe(path.join(bookDir, 'cover.jpg'));
    expect(result.filesMovedCount).toBe(0);
    expect(fs.readFileSync(path.join(bookDir, 'Book.m4b')).equals(AUDIO)).toBe(true);
    expect(fs.readdirSync(bookDir).sort()).toEqual(['Book.m4b', 'cover.jpg']);
  });

  it('never deletes the source ebook itself, even for a direct download', async () => {
    const media = path.join(root, 'media');
    const sourceDir = path.join(root, 'downloads');
    fs.mkdirSync(sourceDir, { recursive: true });
    const source = path.join(sourceDir, 'Book.epub');
    fs.writeFileSync(source, 'epub-bytes');

    const organizer = new FileOrganizer(media, path.join(root, 'tmp'));
    const result = await organizer.organizeEbook(source, { title: 'Book', author: 'Author' }, '{author}/{title}', undefined, false);

    expect(result.success).toBe(true);
    expect(result.sourceFile).toBe(source);
    expect(fs.readFileSync(source, 'utf8')).toBe('epub-bytes');
    expect(fs.readdirSync(path.join(media, 'Author', 'Book'))).toEqual(['Book.epub']);
  });
});
