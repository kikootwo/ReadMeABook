/**
 * Component: E2E helpers #216 (hold the chapter merge's ffmpeg and step it forward)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Same hold as 540-stop.spec.ts: a detached watcher SIGSTOPs the next ffmpeg whose argv holds
 * `concat` (only the merge's does) and records its PID in /tmp/e2e-ffpid. A step lets it run for
 * a set time with CONT, sleep and STOP in ONE container call, so the run window is the sleep,
 * not the exec latency between two calls.
 */

import { sh } from './242-helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PIDs of running ffmpeg processes in the rmab container. */
function ffmpegPids(): string[] {
  return sh(`for d in /proc/[0-9]*; do c=$(cat "$d/comm" 2>/dev/null) || continue; [ "$c" = ffmpeg ] && echo "\${d#/proc/}"; done; true`)
    .split(/\s+/)
    .filter(Boolean);
}

/** Start the watcher: the next merge ffmpeg is stopped as soon as it appears (5 min at most). */
export function holdNextMerge(): void {
  const skip = ffmpegPids().join(' ');
  sh(`rm -f /tmp/e2e-ffpid
cat > /tmp/e2e-hold.sh <<'EOS'
#!/bin/bash
skip=" $1 "
for _ in $(seq 1 15000); do
  for d in /proc/[0-9]*; do
    read -r c < "$d/comm" 2>/dev/null || continue
    [ "$c" = ffmpeg ] || continue
    p="\${d#/proc/}"
    case "$skip" in *" $p "*) continue ;; esac
    case "$(tr '\\0' ' ' < "$d/cmdline" 2>/dev/null)" in *concat*) kill -STOP "$p" && echo "$p" > /tmp/e2e-ffpid && exit 0 ;; esac
  done
  sleep 0.02
done
EOS
setsid bash /tmp/e2e-hold.sh '${skip}' >/dev/null 2>&1 </dev/null &`);
}

/** The held ffmpeg's PID, once the watcher has stopped it. */
export async function heldPid(timeoutMs = 240_000): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const pid = sh('cat /tmp/e2e-ffpid 2>/dev/null || true').trim();
    if (pid) return pid;
    if (Date.now() > end) throw new Error('the merge ffmpeg was never held');
    await sleep(1000);
  }
}

/** Let the held ffmpeg run for `ms`, then stop it again (one container call). */
export function step(pid: string, ms: number): void {
  sh(`kill -CONT ${pid}; sleep ${(ms / 1000).toFixed(3)}; kill -STOP ${pid}`);
}

/** Let it run to the end. */
export function release(pid: string): void {
  sh(`kill -CONT ${pid} 2>/dev/null || true`);
}

/** The process state letter (T = stopped), or '' when it has exited. */
export function procState(pid: string): string {
  return sh(`awk '{print $3}' /proc/${pid}/stat 2>/dev/null || true`).trim();
}
