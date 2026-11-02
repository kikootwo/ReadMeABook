/**
 * Component: Book Folder Junk and D1 Plan Tests (#526, real filesystem)
 * Documentation: documentation/admin-features/request-deletion.md
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isJunkDirName, isJunkFileName, JUNK_MAX_ENTRIES, planJunkDir, releaseJunkDir, removeJunkDir } from '@/lib/utils/book-folder-junk';
import { planBookFolderDelete, removeFolderIfOnlyJunk } from '@/lib/utils/book-folder-delete';
import { generateFilesHash } from '@/lib/utils/files-hash';
import { canonicalPath } from '@/lib/utils/delete-guard';

let root: string;

function write(file: string, content = 'x') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-526-junk-')));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('junk names', () => {
  it.each(['.DS_Store', 'Thumbs.db', 'desktop.ini', '._Book.m4b', '._cover.jpg', 'metadata.json', 'metadata.abs'])('%s is junk', (name) => {
    expect(isJunkFileName(name)).toBe(true);
  });

  it.each(['notes.txt', 'cover.jpg', 'thumbs.db', 'Desktop.ini', 'metadata.opf', 'my.DS_Store', 'Book.epub'])('%s is not', (name) => {
    expect(isJunkFileName(name)).toBe(false);
  });

  it('junk folders: @eaDir and .@__thumb only', () => {
    expect(isJunkDirName('@eaDir')).toBe(true);
    expect(isJunkDirName('.@__thumb')).toBe(true);
    expect(isJunkDirName('eaDir')).toBe(false);
    expect(isJunkDirName('Extras')).toBe(false);
  });
});

describe('planJunkDir / removeJunkDir: the limited walk', () => {
  it('walks and removes a nested NAS index folder, deepest first', async () => {
    const dir = path.join(root, '@eaDir');
    write(path.join(dir, 'Book.m4b', 'SYNOFILE_THUMB_M.jpg'));
    write(path.join(dir, 'Book.m4b', 'deeper', 'SYNO_INDEX'));
    write(path.join(dir, 'cover.jpg', 'SYNOPHOTO_THUMB_S.jpg'));

    const walked = await planJunkDir(dir);
    expect('plan' in walked).toBe(true);
    expect(await removeJunkDir((walked as { plan: Parameters<typeof removeJunkDir>[0] }).plan)).toBeNull();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it.each([
    ['a link', (dir: string) => fs.symlinkSync(path.join(root, 'elsewhere'), path.join(dir, 'link'), 'junction'), 'it holds a link'],
    ['an audio file', (dir: string) => write(path.join(dir, 'x', 'Book.mp3')), 'it holds an audio or ebook file'],
    ['an ebook file', (dir: string) => write(path.join(dir, 'Book.epub')), 'it holds an audio or ebook file'],
    ['folders deeper than 3 levels', (dir: string) => write(path.join(dir, 'a', 'b', 'c', 'd', 'f')), 'it is nested too deep'],
    ['more than 500 entries', (dir: string) => {
      for (let i = 0; i <= JUNK_MAX_ENTRIES; i++) write(path.join(dir, `t${i}`));
    }, `it holds more than ${JUNK_MAX_ENTRIES} entries`],
  ])('keeps everything when it holds %s', async (_label, setup, why) => {
    fs.mkdirSync(path.join(root, 'elsewhere'));
    write(path.join(root, 'elsewhere', 'keep.txt'));
    const dir = path.join(root, '@eaDir');
    write(path.join(dir, 'thumb.jpg'));
    setup(dir);

    expect(await planJunkDir(dir)).toEqual({ why });
    expect(fs.existsSync(path.join(dir, 'thumb.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'elsewhere', 'keep.txt'))).toBe(true);
  });

  it('accepts exactly 3 levels below the junk folder', async () => {
    const dir = path.join(root, '@eaDir');
    write(path.join(dir, 'a', 'b', 'c', 'f'));
    expect('plan' in (await planJunkDir(dir))).toBe(true);
  });

  // Deleted then made again: Linux hands the new folder the freed inode number unless the walk holds the old one open
  it.each([
    ['deleted and made again', (sub: string) => fs.rmSync(sub, { recursive: true })],
    ['moved aside and replaced', (sub: string) => fs.renameSync(sub, path.join(root, 'old-sub'))],
  ])('stops when a walked folder was %s before removal', async (_label, swapOut) => {
    const dir = path.join(root, '@eaDir');
    const sub = path.join(dir, 'sub');
    write(path.join(sub, 'thumb.jpg'));
    const walked = (await planJunkDir(dir)) as { plan: Parameters<typeof removeJunkDir>[0] };
    expect(walked.plan.nodes.map((n) => path.basename(n.dir))).toEqual(['sub', '@eaDir']);
    swapOut(sub);
    write(path.join(sub, 'thumb.jpg'), 'new');

    expect(await removeJunkDir(walked.plan)).toBe('changed');
    expect(fs.readFileSync(path.join(sub, 'thumb.jpg'), 'utf8')).toBe('new');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('a plan released without removing (twice) removes nothing', async () => {
    const dir = path.join(root, '@eaDir');
    write(path.join(dir, 'sub', 'thumb.jpg'));
    const walked = (await planJunkDir(dir)) as { plan: Parameters<typeof removeJunkDir>[0] };
    await releaseJunkDir(walked.plan);
    await releaseJunkDir(walked.plan);

    expect(fs.existsSync(path.join(dir, 'sub', 'thumb.jpg'))).toBe(true);
    fs.rmSync(dir, { recursive: true });
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe('planBookFolderDelete', () => {
  it('a folder that cannot be read: refused, nothing removed', async () => {
    expect(await planBookFolderDelete(path.join(root, 'missing'), 'x', [])).toEqual({ refused: 'the folder could not be read (ENOENT)' });
  });

  it('removes only the audio set the import hashed: any other audio name refuses', async () => {
    const dir = path.join(root, 'Book');
    write(path.join(dir, 'Book.m4b'));
    write(path.join(dir, 'Bonus.mp3'));
    expect(await planBookFolderDelete(dir, generateFilesHash(['Book.m4b']), [])).toEqual({ refused: 'folder contents changed since import' });
  });

  it('labels an ebook another request recorded here, matched through the canonical folder', async () => {
    const dir = path.join(root, 'Book');
    write(path.join(dir, 'Book.m4b'));
    write(path.join(dir, 'Book.epub'));
    const link = path.join(root, 'Link');
    fs.symlinkSync(dir, link, 'junction');

    // D1 gets the canonical folder (the guard's canonicalPath)
    const planned = await planBookFolderDelete(await canonicalPath(dir), generateFilesHash(['Book.m4b']), [{ path: path.join(link, 'Book.epub') }]);

    expect(planned).toMatchObject({ plan: { audio: ['Book.m4b'], alone: true, kept: [{ name: 'Book.epub', why: 'ebook of another request' }] } });
  });
});

describe('removeFolderIfOnlyJunk (D2 empty-folder step)', () => {
  it('removes a folder holding only junk', async () => {
    const dir = path.join(root, 'Book');
    write(path.join(dir, '.DS_Store'));
    write(path.join(dir, '@eaDir', 'x'));
    expect(await removeFolderIfOnlyJunk(dir)).toEqual({ removed: true });
    expect(fs.existsSync(dir)).toBe(false);
  });

  it.each([['a cover', 'cover.jpg'], ['a user file', 'notes.txt']])('keeps a folder that still holds %s, junk and all', async (_label, name) => {
    const dir = path.join(root, 'Book');
    write(path.join(dir, '.DS_Store'));
    write(path.join(dir, name));
    expect(await removeFolderIfOnlyJunk(dir)).toEqual({ removed: false });
    expect(fs.readdirSync(dir).sort()).toEqual(['.DS_Store', name].sort());
  });
});
