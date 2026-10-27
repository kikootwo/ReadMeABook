/**
 * Component: File Organizer {primaryAuthor} and {seriesPart:00} Tests (#250, real filesystem)
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

const TEMPLATE = '{primaryAuthor}/{series}/{seriesPart:00} - {title}';
const RENAME = { enabled: true, template: '{seriesPart:00} - {title}' };
const BOOK = {
  title: 'Relic',
  author: 'Douglas Preston, Lincoln Child',
  series: 'Pendergast',
  seriesPart: '1',
};

let root: string;

/** Every file under `dir`, as forward-slash paths relative to it ([] when it does not exist) */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((entry) => fs.statSync(path.join(dir, entry)).isFile())
    .map((entry) => entry.split(path.sep).join('/'))
    .sort();
}

describe('organizer: {primaryAuthor} and {seriesPart:00} in folder and rename templates', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-tplvars-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('places and renames an audiobook', async () => {
    const download = path.join(root, 'downloads', 'Relic.Unabridged');
    fs.mkdirSync(download, { recursive: true });
    fs.writeFileSync(path.join(download, 'relic.m4b'), 'audio-bytes');
    const media = path.join(root, 'media');

    const result = await new FileOrganizer(media, path.join(root, 'tmp')).organize(download, BOOK, TEMPLATE, undefined, RENAME);

    expect(path.resolve(result.targetPath)).toBe(path.join(media, 'Douglas Preston', 'Pendergast', '01 - Relic'));
    expect(filesUnder(media)).toEqual(['Douglas Preston/Pendergast/01 - Relic/01 - Relic.m4b']);
    expect(result.success).toBe(true);
  });

  it('places and renames an ebook', async () => {
    const downloads = path.join(root, 'downloads');
    fs.mkdirSync(downloads, { recursive: true });
    const source = path.join(downloads, 'relic.epub');
    fs.writeFileSync(source, 'epub-bytes');
    const media = path.join(root, 'media');

    const result = await new FileOrganizer(media, path.join(root, 'tmp')).organizeEbook(
      source,
      BOOK,
      TEMPLATE,
      undefined,
      false,
      RENAME
    );

    expect(filesUnder(media)).toEqual(['Douglas Preston/Pendergast/01 - Relic/01 - Relic.epub']);
    expect(result.success).toBe(true);
  });
});
