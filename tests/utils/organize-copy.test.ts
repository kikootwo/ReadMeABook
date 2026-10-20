/**
 * Component: Verified File Placement Tests (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partialNameFor } from '@/lib/utils/copy-file';
import { placeAudio, placeFile, removeStalePartials } from '@/lib/utils/organize-copy';

let root: string;
const SOURCE = Buffer.from('original-audio-'.repeat(50000));
const OPTS = { fileMode: 0o664, compareExisting: true };

function write(rel: string, data: Buffer | string): string {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
}

/** File symlinks need a privilege on Windows; returns false when the platform refuses. */
function linkFile(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
}

describe('placeFile', () => {
  let source: string;
  let target: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-place-')));
    source = write('downloads/Book.m4b', SOURCE);
    target = path.join(root, 'media', 'Author', 'Book', 'Book.m4b');
    fs.mkdirSync(path.dirname(target), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('copies when there is no target', async () => {
    const result = await placeFile(source, target, OPTS);

    expect(result).toEqual({ status: 'copied', target });
    expect(fs.readFileSync(target).equals(SOURCE)).toBe(true);
  });

  it.each([
    ['an empty file', 0],
    ['a truncated copy', 4096],
    ['all but one byte', SOURCE.length - 1],
  ])('re-copies over %s that is a byte-prefix of the source', async (_label, length) => {
    fs.writeFileSync(target, SOURCE.subarray(0, length));

    const result = await placeFile(source, target, OPTS);

    expect(result.status).toBe('copied');
    expect(fs.readFileSync(target).equals(SOURCE)).toBe(true);
  });

  it('never overwrites a smaller file that is not a prefix (e.g. another book or an edited file)', async () => {
    const other = Buffer.from('another book entirely');
    fs.writeFileSync(target, other);

    const result = await placeFile(source, target, OPTS);

    expect(result.status).toBe('differs');
    expect(fs.readFileSync(target).equals(other)).toBe(true);
  });

  it('never overwrites a larger file', async () => {
    const larger = Buffer.concat([SOURCE, Buffer.from('extra')]);
    fs.writeFileSync(target, larger);

    const result = await placeFile(source, target, OPTS);

    expect(result.status).toBe('differs');
    expect(fs.readFileSync(target).equals(larger)).toBe(true);
  });

  it('reports identical bytes as identical, and different bytes of the same size as differs', async () => {
    fs.writeFileSync(target, SOURCE);
    expect((await placeFile(source, target, OPTS)).status).toBe('identical');

    const flipped = Buffer.from(SOURCE);
    flipped[flipped.length - 1] ^= 0xff;
    fs.writeFileSync(target, flipped);
    expect((await placeFile(source, target, OPTS)).status).toBe('differs');
    expect(fs.readFileSync(target).equals(flipped)).toBe(true);
  });

  it('does not compare a same-size target when no delete depends on it', async () => {
    fs.writeFileSync(target, SOURCE);

    const result = await placeFile(source, target, { ...OPTS, compareExisting: false });

    expect(result.status).toBe('present');
  });

  it('treats a library symlink pointing at the source as differs and leaves it alone', async (ctx) => {
    if (!linkFile(source, target)) return ctx.skip();

    const result = await placeFile(source, target, OPTS);

    expect(result.status).toBe('differs');
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
  });

  it('treats a directory at the target name as differs', async () => {
    fs.mkdirSync(target);

    expect((await placeFile(source, target, OPTS)).status).toBe('differs');
  });

  it('accepts a hard link to the source as identical', async () => {
    fs.linkSync(source, target);

    expect((await placeFile(source, target, OPTS)).status).toBe('identical');
  });

  it('treats the .m4b name that format coercion gave an earlier .mp4 copy as the existing target', async () => {
    const mp4Source = write('downloads/Book.mp4', SOURCE);
    const coerced = path.join(path.dirname(target), 'Book.m4b');
    fs.writeFileSync(coerced, SOURCE);

    const result = await placeFile(mp4Source, path.join(path.dirname(target), 'Book.mp4'), OPTS);

    expect(result).toEqual({ status: 'identical', target: coerced });
    expect(fs.existsSync(path.join(path.dirname(target), 'Book.mp4'))).toBe(false);
  });

  it('two concurrent placements of the same name never overwrite each other', async () => {
    const other = Buffer.from(SOURCE);
    other[0] ^= 0xff;
    const sourceB = write('downloads/Other/Book.m4b', other);

    const [a, b] = await Promise.all([placeFile(source, target, OPTS), placeFile(sourceB, target, OPTS)]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['copied', 'differs']);
    const winner = a.status === 'copied' ? SOURCE : other;
    expect(fs.readFileSync(target).equals(winner)).toBe(true);
  });

  it('a placement racing a file that appears at the target re-checks it instead of overwriting', async () => {
    const results = await Promise.all([placeFile(source, target, OPTS), placeFile(source, target, OPTS)]);

    expect(results.map((r) => r.status).sort()).toEqual(['copied', 'identical']);
    expect(fs.readFileSync(target).equals(SOURCE)).toBe(true);
  });

  it('reports a missing source as failed', async () => {
    const result = await placeFile(path.join(root, 'downloads', 'missing.m4b'), target, OPTS);

    expect(result.status).toBe('failed');
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('removeStalePartials', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-stale-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes partials for this name and partials older than 24 h, nothing else', async () => {
    const mine = write(partialNameFor('Book.m4b'), 'partial');
    const otherFresh = write(partialNameFor('Other.m4b'), 'partial');
    const otherOld = write(partialNameFor('Old.m4b'), 'partial');
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(otherOld, dayAgo, dayAgo);
    const lookalike = write('.rmab-partial-notahash-123.part', 'keep');
    const audio = write('Book.m4b', 'keep');
    const dirMatch = path.join(root, partialNameFor('Book.m4b'));
    fs.mkdirSync(dirMatch);

    await removeStalePartials(root, 'Book.m4b');

    expect(fs.existsSync(mine)).toBe(false);
    expect(fs.existsSync(otherOld)).toBe(false);
    expect(fs.existsSync(otherFresh)).toBe(true);
    expect(fs.existsSync(lookalike)).toBe(true);
    expect(fs.existsSync(audio)).toBe(true);
    expect(fs.existsSync(dirMatch)).toBe(true);
  });
});

describe('placeAudio (tagged derivative)', () => {
  let original: string;
  let tagged: string;
  let target: string;
  const TAGGED = Buffer.concat([Buffer.from('TAGS'), SOURCE]);

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-tagged-')));
    original = write('downloads/Book.m4b', SOURCE);
    tagged = write('downloads/Book.m4b.tmp', TAGGED);
    target = path.join(root, 'media', 'Book.m4b');
    fs.mkdirSync(path.dirname(target), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const probeWith = (durations: Record<string, number>) => async (p: string) => {
    if (p === original) return durations.original;
    return durations.placed;
  };

  it('keeps the tagged copy when its duration matches the original within 1 s', async () => {
    const result = await placeAudio(original, tagged, target, {
      ...OPTS,
      probeDuration: probeWith({ original: 60000, placed: 60400 }),
    });

    expect(result).toMatchObject({ status: 'copied', verified: true, usedDerivative: true });
    expect(fs.readFileSync(target).equals(TAGGED)).toBe(true);
  });

  it('places the original untagged when the tagged duration is off', async () => {
    const result = await placeAudio(original, tagged, target, {
      ...OPTS,
      probeDuration: probeWith({ original: 60000, placed: 30000 }),
    });

    expect(result).toMatchObject({
      status: 'copied', verified: true, usedDerivative: false, tagsDropped: 'the tagged version had a different length',
    });
    expect(fs.readFileSync(target).equals(SOURCE)).toBe(true);
  });

  it('places the original untagged when the duration cannot be probed', async () => {
    const result = await placeAudio(original, tagged, target, {
      ...OPTS,
      probeDuration: async () => { throw new Error('ffprobe missing'); },
    });

    expect(result).toMatchObject({ verified: true, usedDerivative: false, tagsDropped: 'the length could not be checked' });
    expect(result.reason).toContain('ffprobe missing');
    expect(fs.readFileSync(target).equals(SOURCE)).toBe(true);
  });

  it('checks the tagged copy even when no delete depends on the import (a seeding torrent is removed later)', async () => {
    const result = await placeAudio(original, tagged, target, {
      ...OPTS,
      compareExisting: false,
      probeDuration: probeWith({ original: 10000, placed: 4049 }),
    });

    expect(result).toMatchObject({ status: 'copied', verified: true, usedDerivative: false });
    expect(fs.readFileSync(target).equals(SOURCE)).toBe(true);
  });
  it('verifies against the original when the library already holds the untagged bytes', async () => {
    fs.writeFileSync(target, SOURCE);

    const result = await placeAudio(original, tagged, target, {
      ...OPTS,
      probeDuration: probeWith({ original: 60000, placed: 60000 }),
    });

    expect(result).toMatchObject({ status: 'identical', verified: true, usedDerivative: false });
    expect(fs.readFileSync(target).equals(SOURCE)).toBe(true);
  });

  it('reports identical, without probing or comparing, when the target is the original itself', async () => {
    // A same-size tagged copy and no byte compare used to make this 'present' (logged only at debug)
    const sameSize = Buffer.from(SOURCE);
    sameSize.write('TAGS');
    fs.writeFileSync(tagged, sameSize);
    fs.linkSync(original, target);
    const probe = vi.fn(async () => 60000);

    const viaLink = await placeAudio(original, tagged, target, { fileMode: 0o664, compareExisting: false, probeDuration: probe });
    const samePath = await placeAudio(original, tagged, original, { fileMode: 0o664, compareExisting: false, probeDuration: probe });

    expect(viaLink).toEqual({ status: 'identical', target, verified: true, usedDerivative: false });
    expect(samePath).toEqual({ status: 'identical', target: original, verified: true, usedDerivative: false });
    expect(probe).not.toHaveBeenCalled();
    expect(fs.readFileSync(target).equals(SOURCE)).toBe(true);
  });

  it('never counts a library symlink to the original as identical: differs, link and source left alone', async (ctx) => {
    if (!linkFile(original, target)) return ctx.skip();

    for (const compareExisting of [false, true]) {
      const result = await placeAudio(original, tagged, target, { fileMode: 0o664, compareExisting, probeDuration: async () => 60000 });
      expect(result).toMatchObject({ status: 'differs', verified: false });
    }
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(original).equals(SOURCE)).toBe(true);
  });
});
