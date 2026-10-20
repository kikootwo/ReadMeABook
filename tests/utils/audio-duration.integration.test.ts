/**
 * Component: Tagged-copy verification against real audio (real ffmpeg/ffprobe)
 * Documentation: documentation/phase3/file-organization.md
 *
 * A generated corpus (m4b with chapters, VBR MP3 without a Xing header, CBR
 * MP3, FLAC) is tagged with the real tagger; each tagged copy must probe to
 * the original's duration and be placed as a verified derivative. Skips when
 * ffmpeg/ffprobe are not on PATH (CI and the Docker image have them).
 */

import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeStreamDurationMs } from '@/lib/utils/audio-duration';
import { tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';
import { placeAudio, TAGGED_DURATION_TOLERANCE_MS } from '@/lib/utils/organize-copy';

const execFileP = promisify(execFile);

function has(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function encoders(): string {
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

const available = has('ffmpeg') && has('ffprobe');
const hasLame = available && encoders().includes('libmp3lame');

let dir: string;

async function ffmpeg(args: string[]) {
  await execFileP('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

/** Varied noise so a VBR encoder really varies its frame sizes. */
const SOURCE = ['-f', 'lavfi', '-i', 'anoisesrc=d=8:color=pink:amplitude=0.3,volume=enable=between(t\\,3\\,5):volume=0.05'];

describe.skipIf(!available)('tagged copies of real audio keep their duration', () => {
  const corpus: Record<string, string> = {};

  beforeAll(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-corpus-')));
    const meta = path.join(dir, 'chapters.txt');
    fs.writeFileSync(
      meta,
      ';FFMETADATA1\ntitle=Corpus\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=4000\ntitle=One\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=4000\nEND=8000\ntitle=Two\n'
    );
    corpus.m4b = path.join(dir, 'chapters.m4b');
    await ffmpeg([...SOURCE, '-i', meta, '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'aac', '-b:a', '64k', '-f', 'mp4', corpus.m4b]);
    corpus.flac = path.join(dir, 'lossless.flac');
    await ffmpeg([...SOURCE, '-c:a', 'flac', corpus.flac]);
    if (hasLame) {
      corpus.cbr = path.join(dir, 'cbr.mp3');
      await ffmpeg([...SOURCE, '-c:a', 'libmp3lame', '-b:a', '128k', corpus.cbr]);
      corpus.vbrNoXing = path.join(dir, 'vbr-no-xing.mp3');
      await ffmpeg([...SOURCE, '-c:a', 'libmp3lame', '-q:a', '6', '-write_xing', '0', corpus.vbrNoXing]);
    }
  }, 60_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  const cases = ['m4b', 'flac', 'cbr', 'vbrNoXing'];

  it.each(cases)('%s: tagged copy probes to the original duration and is placed as a verified derivative', async (key) => {
    const original = corpus[key];
    if (!original) return; // libmp3lame missing: MP3 cases need it

    const tagged = await tagAudioFileMetadata(original, { title: 'Corpus Book', author: 'Corpus Author', asin: 'B000TEST00' });
    expect(tagged.success).toBe(true);

    const [a, b] = [await probeStreamDurationMs(original), await probeStreamDurationMs(tagged.taggedFilePath!)];
    expect(a).toBeGreaterThan(7000);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(TAGGED_DURATION_TOLERANCE_MS);

    const target = path.join(dir, 'library', key, path.basename(original));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const placed = await placeAudio(original, tagged.taggedFilePath, target, {
      fileMode: 0o664,
      compareExisting: true,
      probeDuration: probeStreamDurationMs,
    });

    expect(placed).toMatchObject({ status: 'copied', verified: true, usedDerivative: true });
    expect(fs.readFileSync(target).equals(fs.readFileSync(tagged.taggedFilePath!))).toBe(true);
  }, 60_000);

  it('a truncated derivative is caught and the original is placed instead', async () => {
    const original = corpus.flac;
    const truncated = path.join(dir, 'truncated.flac.tmp');
    await ffmpeg(['-i', original, '-t', '3', '-c', 'copy', '-f', 'flac', truncated]);
    const target = path.join(dir, 'library', 'truncated', 'lossless.flac');
    fs.mkdirSync(path.dirname(target), { recursive: true });

    const placed = await placeAudio(original, truncated, target, {
      fileMode: 0o664,
      compareExisting: true,
      probeDuration: probeStreamDurationMs,
    });

    expect(placed).toMatchObject({ status: 'copied', verified: true, usedDerivative: false });
    expect(fs.readFileSync(target).equals(fs.readFileSync(original))).toBe(true);
  }, 60_000);
});
