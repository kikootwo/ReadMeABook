/**
 * Component: Real-ffmpeg MP4 tag test helpers (fixtures + independent read-back)
 * Documentation: documentation/phase3/file-organization.md
 *
 * Fixtures are generated at test time (lavfi sine + colour cover + two
 * chapters). Read-back uses ffprobe/ffmpeg and plain byte scans, never the
 * module under test, so a parser bug cannot hide itself.
 */

import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileP = promisify(execFile);

const has = (bin: string) => {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
export const available = has('ffmpeg') && has('ffprobe');

export const ffmpeg = (args: string[]) => execFileP('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', ...args]);

export function makeDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const TAGS = {
  title: 'The Title',
  artist: 'Auth Or',
  album_artist: 'Auth Or',
  album: 'The Title',
  composer: 'Nar Rator',
  date: '2001',
  show: 'My Series',
  episode_id: '3',
};

/**
 * An .m4b with tags, an attached cover and two chapters. Nero chpl chapters are
 * disabled, so chapter titles can only come from the text track (whose chunk
 * offsets must then be right).
 */
export async function makeM4b(dir: string, name: string, opts: { faststart: boolean; extra?: string[] }): Promise<string> {
  const src = path.join(dir, 'src.m4a');
  const cover = path.join(dir, 'cover.jpg');
  const chapters = path.join(dir, 'chapters.txt');
  if (!fs.existsSync(src)) {
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'aac', '-b:a', '64k', src]);
    await ffmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-frames:v', '1', cover]);
    fs.writeFileSync(
      chapters,
      ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=3000\ntitle=Chapter One\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=6000\ntitle=Chapter Two\n'
    );
  }
  const out = path.join(dir, name);
  const metadata = Object.entries(TAGS).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
  await ffmpeg([
    '-y', '-i', src, '-i', cover, '-i', chapters,
    '-map', '0:a', '-map', '1:v', '-map_chapters', '2', '-c', 'copy', '-disposition:v', 'attached_pic',
    ...metadata, ...(opts.extra ?? []),
    '-movflags', opts.faststart ? '+faststart+disable_chpl' : '+disable_chpl',
    '-f', 'mp4', out,
  ]);
  return out;
}

export interface Probe {
  tags: Record<string, string>;
  streams: Array<{ codec_type: string; disposition?: { attached_pic?: number } }>;
  chapters: Array<{ start_time: string; end_time: string; tags?: { title?: string } }>;
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:stream=codec_type:stream_disposition=attached_pic', '-show_chapters', '-of', 'json', file]);
  const json = JSON.parse(stdout);
  return { tags: json.format?.tags ?? {}, streams: json.streams ?? [], chapters: json.chapters ?? [] };
}

/** MD5 of the audio packets (no decode): changes if any chunk offset points at other bytes. */
export async function audioMd5(file: string): Promise<string> {
  const { stdout } = await execFileP('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-map', '0:a', '-c', 'copy', '-f', 'md5', '-']);
  return stdout.trim();
}

/** Top-level box types in file order (a plain walk of the 32/64-bit headers). */
export function topLevelTypes(file: string): string[] {
  const buf = fs.readFileSync(file);
  const types: string[] = [];
  let pos = 0;
  while (pos + 8 <= buf.length) {
    let size = buf.readUInt32BE(pos);
    if (size === 1) size = Number(buf.readBigUInt64BE(pos + 8));
    if (size === 0) size = buf.length - pos;
    types.push(buf.toString('latin1', pos + 4, pos + 8));
    pos += size;
  }
  return types;
}

/** Number of freeform 'name' boxes called `name` in the file (byte scan, not a parser). */
export function countFreeform(file: string, name: string): number {
  const buf = fs.readFileSync(file);
  const needle = Buffer.concat([Buffer.from('name', 'latin1'), Buffer.alloc(4), Buffer.from(name, 'latin1')]);
  let count = 0;
  for (let at = buf.indexOf(needle); at !== -1; at = buf.indexOf(needle, at + 1)) {
    if (buf.readUInt32BE(at - 4) === 12 + name.length) count++;
  }
  return count;
}
