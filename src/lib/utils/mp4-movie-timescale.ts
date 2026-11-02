/**
 * Component: MP4 Movie Timescale (#511)
 * Documentation: documentation/phase3/file-organization.md
 *
 * FFmpeg 9 (commit 51f5f60443) sets the mov muxer's movie timescale to the LCM
 * of every stream's time base, and the QuickTime chapter track inherits it. With
 * a cover (1/90000) next to 22.05 or 44.1 kHz audio that is 4,410,000 units/s,
 * so a chapter over 487 s overflows INT_MAX: ffmpeg drops or clamps its sample
 * and still exits 0. `-movie_timescale 1000` restores ffmpeg 8's value. The
 * option exists from FFmpeg 5.0; an older build rejects it at argv parse (and
 * already writes 1000), so it is passed only when the mp4 muxer lists it.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { RMABLogger } from './logger';

const execFilePromise = promisify(execFile);
const logger = RMABLogger.create('Mp4MovieTimescale');

/** ffmpeg 8 and earlier's default: movie-level durations and chapter times in ms. */
export const MOVIE_TIMESCALE = 1000;
const PROBE_ARGS = ['-hide_banner', '-h', 'muxer=mp4'];
const PROBE_TIMEOUT_MS = 15_000;
/** The muxer's option table, one option per line: `  -movie_timescale   <int>  E... set movie timescale ...` */
const OPTION_LISTED = /^\s*-movie_timescale\s/m;

/** true/false: the muxer does/does not list the option; null: the probe failed. */
let probe: Promise<boolean | null> | undefined;
let failureLogged = false;

async function runProbe(): Promise<boolean | null> {
  try {
    const { stdout = '' } = await execFilePromise('ffmpeg', PROBE_ARGS, { timeout: PROBE_TIMEOUT_MS });
    const listed = OPTION_LISTED.test(stdout);
    logger.debug(`ffmpeg mp4 muxer ${listed ? 'lists' : 'does not list'} -movie_timescale: ${listed ? `passing ${MOVIE_TIMESCALE}` : 'not passed'}`);
    return listed;
  } catch (error) {
    if (!failureLogged) {
      failureLogged = true;
      logger.debug(`ffmpeg mp4 muxer probe failed, -movie_timescale not passed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}

/**
 * The argv pair for an ffmpeg run that writes MP4 (`[]` when this ffmpeg has no
 * such option). The probe runs once per process. A failed probe gives `[]` and
 * is run again by the next call.
 */
export async function movieTimescaleArgs(): Promise<string[]> {
  const current = (probe ??= runProbe());
  const listed = await current;
  if (listed === null && probe === current) probe = undefined;
  return listed ? ['-movie_timescale', String(MOVIE_TIMESCALE)] : [];
}

/** Tests only: forget the probe result. */
export function resetMovieTimescaleProbe(): void {
  probe = undefined;
  failureLogged = false;
}
