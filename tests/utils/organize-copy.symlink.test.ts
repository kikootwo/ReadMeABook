/**
 * Component: Verified File Placement Tests (symlinked library target, simulated)
 * Documentation: documentation/phase3/file-organization.md
 *
 * A library entry that is a symlink to the download must never count as the
 * download being in the library (cleanup would then delete it and leave a
 * dangling link). Real file symlinks need a privilege on Windows, so this
 * file simulates one: fs/promises reports the target as a symlink whose
 * realpath is the original. organize-copy.test.ts has the real-symlink case.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const links = vi.hoisted(() => new Map<string, string>()); // link path -> what it points at
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const key = (p: unknown) => path.resolve(String(p));
  const lstat = (async (p: unknown, ...rest: unknown[]) => {
    const pointsAt = links.get(key(p));
    if (!pointsAt) return (actual.lstat as (...a: unknown[]) => unknown)(p, ...rest);
    const real = await (actual.lstat as (...a: unknown[]) => Promise<fs.Stats>)(p, ...rest);
    return Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
      isFile: () => false,
      isSymbolicLink: () => true,
    });
  }) as typeof actual.lstat;
  const follow = (p: unknown) => links.get(key(p)) ?? p;
  const realpath = ((p: unknown, ...rest: unknown[]) =>
    (actual.realpath as (...a: unknown[]) => unknown)(follow(p), ...rest)) as typeof actual.realpath;
  const stat = ((p: unknown, ...rest: unknown[]) => (actual.stat as (...a: unknown[]) => unknown)(follow(p), ...rest)) as typeof actual.stat;
  const mocked = { ...actual, lstat, realpath, stat };
  return { ...mocked, default: mocked };
});

import { isVerifiedStatus, placeAudio, placeFile } from '@/lib/utils/organize-copy';

let root: string;
let original: string;
let tagged: string;
let target: string;
const SOURCE = Buffer.from('original-audio-'.repeat(20000));

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-symlink-sim-')));
  original = path.join(root, 'downloads', 'Book.m4b');
  tagged = `${original}.tmp`;
  target = path.join(root, 'media', 'Book.m4b');
  fs.mkdirSync(path.dirname(original), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(original, SOURCE);
  const sameSize = Buffer.from(SOURCE);
  sameSize.write('TAGS');
  fs.writeFileSync(tagged, sameSize);
  // The "link": a placeholder entry reported as a symlink resolving to the original
  fs.writeFileSync(target, 'placeholder');
  links.set(path.resolve(target), original);
});

afterEach(() => {
  links.clear();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('symlinked library target (simulated)', () => {
  it('placeAudio reports differs, unverified, whether or not existing files are compared', async () => {
    for (const compareExisting of [false, true]) {
      const result = await placeAudio(original, tagged, target, { fileMode: 0o664, compareExisting, probeDuration: async () => 60000 });
      expect(result.status).toBe('differs');
      expect(result.verified).toBe(false);
      expect(isVerifiedStatus(result.status)).toBe(false);
      // Tagged copy and original refused for the same reason: stated once
      expect(result.reason).toBe('existing target is not a regular file');
    }
    expect(fs.readFileSync(original).equals(SOURCE)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('placeholder');
  });

  it('placeFile reports differs for it too (the link is never overwritten)', async () => {
    const result = await placeFile(original, target, { fileMode: 0o664, compareExisting: false });
    expect(result.status).toBe('differs');
    expect(fs.readFileSync(target, 'utf8')).toBe('placeholder');
  });
});
