/**
 * Component: Audio Stream Duration Probe (packet-accurate)
 * Documentation: documentation/phase3/file-organization.md
 *
 * format.duration is an estimate for some files (e.g. VBR MP3 without a Xing
 * header, where ffprobe extrapolates from the first frames' bitrate). This
 * walks the first audio stream's packets instead and returns where the last
 * one ends, so two files with the same audio frames report the same duration
 * whatever their container metadata says.
 */

import { spawn } from 'child_process';

const PROBE_TIMEOUT_MS = 10 * 60 * 1000;

/** Duration in milliseconds of the first audio stream, from its packets. Throws when ffprobe fails or finds no packets. */
export function probeStreamDurationMs(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'packet=pts_time,duration_time',
      '-of', 'csv=p=0',
      filePath,
    ]);
    let end = 0;
    let packets = 0;
    let pending = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), PROBE_TIMEOUT_MS);

    const consume = (line: string) => {
      const [pts, duration] = line.split(',');
      const start = parseFloat(pts);
      if (!Number.isFinite(start)) return;
      const length = parseFloat(duration);
      packets++;
      end = Math.max(end, start + (Number.isFinite(length) ? length : 0));
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
      resolve(Math.round(end * 1000));
    });
  });
}
