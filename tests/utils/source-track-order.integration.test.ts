/**
 * Component: Source Ordering Integration Tests
 * Documentation: documentation/features/source-track-order.md
 */
import { execFile, spawnSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileOrganizer } from '@/lib/utils/file-organizer';
import { analyzeChapterFiles, probeAudioFile } from '@/lib/utils/chapter-merger';
import { tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';

const settings = vi.hoisted(() => new Map<string, string>());
vi.mock('@/lib/db', () => ({ prisma: { configuration: {
  findUnique: async ({ where: { key } }: { where: { key: string } }) => ({ value: settings.get(key) }),
} } }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => ({ debug() {}, warn() {}, error() {} }) } }));
const run = promisify(execFile);
const available = ['ffmpeg', 'ffprobe'].every(bin => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0);
let root = '';
const release = 'Pierce Brown - Morning Star Book III of the Red Rising Trilogy (Unabridged)';
const names = ['1-2/001', '1-2/002', '1-2/003', '3/001', '3/002'].map(section => {
  const [part, track] = section.split('/');
  return `${release} Part ${part}/Morning Star Book III of the Red Rising Trilogy (Unabridged) - ${track}.mp3`;
});
const positions = [{ disc: 1, track: 1 }, { disc: 1, track: 2 }, { disc: 1, track: 3 }, { disc: 2, track: 1 }, { disc: 2, track: 2 }];
const digest = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
let originalHashes: string[];

beforeAll(async () => {
  if (!available) return;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-order-it-'));
  for (let i = 0; i < names.length; i++) {
    const file = path.join(root, 'source', names[i]);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `anoisesrc=seed=${i + 1}:sample_rate=44100`,
      '-t', '3', '-c:a', 'libmp3lame', '-b:a', '128k', '-metadata', `track=${positions[i].track}`, '-metadata', `title=Section ${i + 1}`, file]);
  }
  originalHashes = await Promise.all(names.map(name => digest(path.join(root, 'source', name))));
}, 30000);
afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });
beforeEach(() => { settings.clear(); });

describe.skipIf(!available)('real source ordering pipeline', () => {
  it('probes disc tags and source folders rather than sorting repeated track numbers globally', async () => {
    const analyzed = await analyzeChapterFiles(names.map(name => path.join(root, 'source', name)).reverse());
    expect(analyzed.map(file => path.relative(path.join(root, 'source'), file.path))).toEqual(names);
    expect(analyzed.map(file => file.sourcePosition)).toEqual(positions);
  });
  it.each([false, true])('copies in the same order with tagging %s and optional renaming', async tagging => {
    settings.set('metadata_tagging_enabled', String(tagging));
    const organizer = new FileOrganizer(path.join(root, `media-${tagging}`), path.join(root, 'temp'));
    const result = await organizer.organize(path.join(root, 'source'), { title: 'Fixture', author: 'Author' },
      '{author}/{title}', undefined, tagging ? { enabled: true, template: '{title}' } : undefined);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.audioFiles).toHaveLength(5);
    expect([...result.audioFiles].sort()).toEqual(result.audioFiles);
    for (let i = 0; i < result.audioFiles.length; i++) {
      expect(path.basename(result.audioFiles[i])).toMatch(new RegExp(`^Disc 0${positions[i].disc} - 000${positions[i].track} - `));
      const probe = await probeAudioFile(result.audioFiles[i]);
      expect(probe.trackNumber).toBe(positions[i].track);
      expect(probe.discNumber).toBe(tagging ? positions[i].disc : undefined);
      if (!tagging) expect(await digest(result.audioFiles[i])).toBe(originalHashes[i]);
    }
    expect(await Promise.all(names.map(name => digest(path.join(root, 'source', name))))).toEqual(originalHashes);
  });
  it('merges into one M4B with the same chapter sequence and no disc prefix on the result', async () => {
    settings.set('chapter_merging_enabled', 'true');
    const organizer = new FileOrganizer(path.join(root, 'media-merged'), path.join(root, 'temp'));
    const result = await organizer.organize(path.join(root, 'source'), { title: 'Fixture', author: 'Author' }, '{author}/{title}');
    expect(result.errors).toEqual([]);
    expect(result.audioFiles.map(file => path.basename(file))).toEqual(['Fixture.m4b']);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', result.audioFiles[0]]);
    expect(JSON.parse(stdout).chapters.map((chapter: any) => chapter.tags.title)).toEqual(['Section 1', 'Section 2', 'Section 3', 'Section 4', 'Section 5']);
  });
  it('rejects a root introduction before any destination audio is written, even with merge enabled', async () => {
    settings.set('chapter_merging_enabled', 'true');
    const bad = path.join(root, 'ambiguous');
    await fs.mkdir(path.join(bad, 'CD1'), { recursive: true });
    await fs.copyFile(path.join(root, 'source', names[0]), path.join(bad, 'Intro.mp3'));
    await fs.copyFile(path.join(root, 'source', names[0]), path.join(bad, 'CD1', '01.mp3'));
    const media = path.join(root, 'media-ambiguous');
    const result = await new FileOrganizer(media).organize(bad, { title: 'Bad', author: 'Author' }, '{author}/{title}');
    expect(result.success).toBe(false);
    expect(result.errors.join()).toContain('Audio ordering needs review');
    await expect(fs.access(media)).rejects.toThrow();
  });
  it.each(['mp3', 'm4a', 'flac'])('writes interoperable track/disc tags to %s copies', async ext => {
    const file = path.join(root, `tag-fixture.${ext}`);
    await run('ffmpeg', ['-v', 'error', '-i', path.join(root, 'source', names[0]), file]);
    const original = await digest(file);
    const tagged = await tagAudioFileMetadata(file, { title: 'Fixture', author: 'Author', sourcePosition: { disc: 2, track: 3 } });
    expect(tagged.success).toBe(true);
    const probe = await probeAudioFile(tagged.taggedFilePath!);
    expect(probe.discNumber).toBe(2);
    expect(probe.trackNumber).toBe(3);
    expect(await digest(file)).toBe(original);
  });
  it('refuses legacy destination audio without writing tags or extra copies', async () => {
    settings.set('metadata_tagging_enabled', 'true');
    const media = path.join(root, 'media-legacy');
    const target = path.join(media, 'Author', 'Fixture');
    await fs.mkdir(target, { recursive: true });
    const legacy = path.join(target, 'old-flattened-track.mp3');
    await fs.copyFile(path.join(root, 'source', names[0]), legacy);
    const hash = await digest(legacy);
    const result = await new FileOrganizer(media).organize(path.join(root, 'source'), { title: 'Fixture', author: 'Author' }, '{author}/{title}');
    expect(result.success).toBe(false);
    expect(result.errors.join()).toContain('destination contains audio outside this import plan');
    expect(await fs.readdir(target)).toEqual(['old-flattened-track.mp3']);
    expect(await digest(legacy)).toBe(hash);
    for (const name of names) await expect(fs.access(path.join(root, 'source', name + '.tmp'))).rejects.toThrow();
  });
  it('retries an already copied import without adding duplicate files', async () => {
    const organizer = new FileOrganizer(path.join(root, 'media-retry'));
    const first = await organizer.organize(path.join(root, 'source'), { title: 'Fixture', author: 'Author' }, '{author}/{title}');
    expect(first.success).toBe(true);
    const second = await organizer.organize(path.join(root, 'source'), { title: 'Fixture', author: 'Author' }, '{author}/{title}');
    expect(second.success).toBe(true);
    expect(second.filesMovedCount).toBe(0);
    expect(second.audioFiles).toEqual(first.audioFiles);
    expect((await fs.readdir(first.targetPath)).length).toBe(5);
  });
  it('probes filenames containing shell syntax literally', async () => {
    const file = path.join(root, 'literal " $(touch never-created) `date`.mp3');
    await fs.copyFile(path.join(root, 'source', names[0]), file);
    expect((await probeAudioFile(file)).trackNumber).toBe(1);
  });
});
