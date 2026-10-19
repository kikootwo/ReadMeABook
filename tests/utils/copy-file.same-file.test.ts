/**
 * Component: Stream-based File Copy Utility Tests (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFile, isSameFile, sameIdentity } from '@/lib/utils/copy-file';

let root: string;
const BYTES = Buffer.from('cover-art-bytes-'.repeat(4096));

describe('copyFile on the real filesystem', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-copy-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('leaves a file untouched when copied onto itself', async () => {
    const file = path.join(root, 'cover.jpg');
    fs.writeFileSync(file, BYTES);

    await copyFile(file, file);

    expect(fs.readFileSync(file).equals(BYTES)).toBe(true);
  });

  it('leaves a file untouched when the destination is another spelling of it', async () => {
    const file = path.join(root, 'cover.jpg');
    fs.writeFileSync(file, BYTES);

    await copyFile(file, path.join(root, '.', 'sub', '..', 'cover.jpg'));

    expect(fs.readFileSync(file).equals(BYTES)).toBe(true);
  });

  it('leaves a file untouched when the destination is a hard link to it', async () => {
    const file = path.join(root, 'cover.jpg');
    const link = path.join(root, 'link.jpg');
    fs.writeFileSync(file, BYTES);
    fs.linkSync(file, link);

    await copyFile(file, link);

    expect(fs.readFileSync(file).equals(BYTES)).toBe(true);
  });

  it('still copies between different files', async () => {
    const source = path.join(root, 'a.jpg');
    const dest = path.join(root, 'b.jpg');
    fs.writeFileSync(source, BYTES);
    fs.writeFileSync(dest, 'old');

    await copyFile(source, dest);

    expect(fs.readFileSync(dest).equals(BYTES)).toBe(true);
  });
});

describe('isSameFile / sameIdentity', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-copy-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('is false for different files and for missing paths', async () => {
    fs.writeFileSync(path.join(root, 'a'), '1');
    fs.writeFileSync(path.join(root, 'b'), '1');
    expect(await isSameFile(path.join(root, 'a'), path.join(root, 'b'))).toBe(false);
    expect(await isSameFile(path.join(root, 'a'), path.join(root, 'missing'))).toBe(false);
  });

  it('is true for a hard link (same device and inode, different realpath)', async () => {
    fs.writeFileSync(path.join(root, 'a'), '1');
    fs.linkSync(path.join(root, 'a'), path.join(root, 'b'));
    expect(await isSameFile(path.join(root, 'a'), path.join(root, 'b'))).toBe(true);
  });

  it('never treats inode 0 as a match', () => {
    expect(sameIdentity({ dev: BigInt(1), ino: BigInt(0) }, { dev: BigInt(1), ino: BigInt(0) })).toBe(false);
    expect(sameIdentity({ dev: BigInt(1), ino: BigInt(5) }, { dev: BigInt(2), ino: BigInt(5) })).toBe(false);
    expect(sameIdentity({ dev: BigInt(1), ino: BigInt(5) }, { dev: BigInt(1), ino: BigInt(5) })).toBe(true);
  });
});
