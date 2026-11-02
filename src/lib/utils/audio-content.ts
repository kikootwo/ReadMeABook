/**
 * Component: Audio Content Probe (how much audio a file really holds)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Walks the first audio stream's packets (no decoding) and measures the
 * playable content. Every merge input and output codec (MP3, AAC, FLAC) has a
 * fixed frame, the most common packet duration: each packet counts as one
 * frame (packets whose timestamps overlap get clamped durations but still hold
 * a full frame), the last packet as its own duration (end trimming), minus the
 * samples the decoder discards (encoder delay/priming and padding, from the
 * "Skip Samples" side data: LAME gapless headers, AAC priming).
 * Timeline gaps are reported separately: a packet stretched to over 2 frames
 * (ffmpeg writes one over the hole when an input ends early) or a forward
 * jump between packets. The end timestamp is NOT the content: a merge that
 * lost audio can still end at the full length. Integer timestamps (stream
 * time base) keep the frame exact over millions of packets. A
 * variable-blocksize FLAC counts its short blocks as full frames (more
 * content, never less).
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 10 * 60 * 1000;
/** Packets or jumps longer than this are kept for gap analysis (every codec's frame is shorter). */
const GAP_CANDIDATE_S = 0.25;

export interface AudioContent {
  /** Playable audio (ms): one frame per packet minus discarded samples, not counting gaps. */
  contentMs: number;
  /** Timeline gaps (ms): time the timeline claims but no packet holds. */
  gapMs: number;
  /** Most common packet duration (ms), the codec's frame. */
  frameMs: number;
  /**
   * Every packet as one full frame (ms, unrounded): no end trim, no discarded
   * samples. A codec-copy merge carries every source packet over, so its
   * framedMs equals the sum of the chapters' framedMs exactly.
   */
  framedMs: number;
  /** Timestamp where the last packet ends (ms); not the content. */
  endMs: number;
  packets: number;
  /**
   * Decoded format, "<sample rate>/<channels>/<channel layout>/<sample format>":
   * chapters that differ here make ffmpeg rebuild its filter graph mid-merge.
   */
  decodedFormat: string;
}

async function streamInfo(filePath: string): Promise<{ sampleRate: number; timeBase: number; decodedFormat: string }> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,time_base,channels,channel_layout,sample_fmt', '-of', 'json', filePath],
    { timeout: 30000 }
  );
  const stream = (JSON.parse(stdout).streams ?? [])[0] ?? {};
  const [num, den] = String(stream.time_base ?? '').split('/').map(Number);
  const timeBase = num > 0 && den > 0 ? num / den : 0;
  if (!(timeBase > 0)) throw new Error('no audio stream time base');
  const decodedFormat = [stream.sample_rate, stream.channels, stream.channel_layout, stream.sample_fmt].map((v) => String(v ?? '')).join('/');
  return { sampleRate: parseInt(stream.sample_rate, 10) || 0, timeBase, decodedFormat };
}

/** key=value fields of one ffprobe csv line (side data keys keep only their last segment). */
function fields(line: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of line.split(',').slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) map.set(part.slice(part.lastIndexOf(':', eq) + 1, eq), part.slice(eq + 1));
  }
  return map;
}

/** Content of the first audio stream. Throws when ffprobe fails or finds no packets. */
export async function probeAudioContent(filePath: string): Promise<AudioContent> {
  const { sampleRate, timeBase, decodedFormat } = await streamInfo(filePath);
  const candidateTicks = GAP_CANDIDATE_S / timeBase;

  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'packet=pts,duration:packet_side_data',
      '-of', 'csv=p=1:nk=0',
      filePath,
    ]);
    let packets = 0;
    let skippedSamples = 0;
    let lastLength = 0;
    let end = 0;
    const lengths = new Map<number, number>(); // duration (ticks) -> count
    const candidates: Array<{ length: number; hole: number }> = []; // ticks
    let pending = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), PROBE_TIMEOUT_MS);

    const consume = (line: string) => {
      if (!line.startsWith('packet,')) return;
      const f = fields(line);
      const start = parseInt(f.get('pts') ?? '', 10);
      if (!Number.isFinite(start)) return;
      const parsed = parseInt(f.get('duration') ?? '', 10);
      const length = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      skippedSamples += (parseInt(f.get('skip_samples') ?? '', 10) || 0) + (parseInt(f.get('discard_padding') ?? '', 10) || 0);
      const hole = packets > 0 ? start - end : 0;
      if (length > candidateTicks || hole > candidateTicks) candidates.push({ length, hole });
      lengths.set(length, (lengths.get(length) ?? 0) + 1);
      end = packets > 0 ? Math.max(end, start + length) : start + length;
      packets++;
      lastLength = length;
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) consume(line.trim());
    });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (pending.trim()) consume(pending.trim());
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${stderr.trim().slice(0, 300)}`));
      if (packets === 0) return reject(new Error('no audio packets found'));

      let frame = 0;
      let frameCount = -1;
      for (const [length, count] of lengths) if (count > frameCount) [frame, frameCount] = [length, count];
      const limit = Math.max(2 * frame, candidateTicks);
      let gaps = 0;
      for (const c of candidates) {
        if (c.length > limit) gaps += c.length - frame;
        if (c.hole > limit) gaps += c.hole;
      }
      // One frame per packet; the last one as its own (trimmed) duration
      const last = lastLength > 0 && lastLength <= frame ? lastLength : frame;
      const framedSeconds = ((packets - 1) * frame + last) * timeBase;
      const skippedSeconds = sampleRate > 0 ? skippedSamples / sampleRate : 0;
      resolve({
        contentMs: Math.round((framedSeconds - skippedSeconds) * 1000),
        gapMs: Math.round(gaps * timeBase * 1000),
        frameMs: Math.round(frame * timeBase * 10000) / 10,
        framedMs: packets * frame * timeBase * 1000,
        endMs: Math.round(end * timeBase * 1000),
        packets,
        decodedFormat,
      });
    });
  });
}
