/**
 * Component: Unified container stop settings — Tests
 * Documentation: documentation/deployment/unified.md
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SHUTDOWN_DRAIN_MS, SHUTDOWN_HARD_DEADLINE_MS, SHUTDOWN_STEP_LIMIT_MS } from '@/lib/constants/shutdown';

/** Docker's `docker stop` default, also what the Unraid template gets (no --stop-timeout) */
const DEFAULT_DOCKER_STOP_S = 10;

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// e2e/Dockerfile.test's build context leaves out docker-compose*.yml, so the containerized unit suite
// skips those rows with a reason. Never on GitHub Actions (full checkout). (Not CI: Dockerfile.test sets CI=true.)
const onGitHubActions = process.env.GITHUB_ACTIONS === 'true';

const SUPERVISORD = 'docker/unified/supervisord.conf';
const sections = read(SUPERVISORD).split(/^(?=\[)/m);
const programs = sections.filter((s) => s.startsWith('[program:'));
const postgresql = programs.find((s) => s.startsWith('[program:postgresql]')) ?? '';
const app = programs.find((s) => s.startsWith('[program:app]')) ?? '';
const APP_START = 'docker/unified/app-start.sh';
// Comments stripped, so a commented-out line never satisfies a check
const appStart = read(APP_START).split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

const stopWaitSecs = (section: string): number | undefined => {
  const m = section.match(/^stopwaitsecs\s*=\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : undefined;
};

// supervisord stops programs one at a time, each up to its stopwaitsecs (default 10) before SIGKILL.
const worstCaseStop = programs.reduce((sum, s) => sum + (stopWaitSecs(s) ?? 10), 0);

describe('Unified container stop settings', () => {
  it(`${SUPERVISORD}: postgresql stops with SIGINT (fast shutdown)`, () => {
    expect(postgresql, `${SUPERVISORD}: no [program:postgresql] section`).not.toBe('');
    expect(postgresql).toMatch(/^stopsignal\s*=\s*INT\s*$/m);
  });

  it(`${SUPERVISORD}: postgresql gets at least 30 s to finish its checkpoint`, () => {
    expect(stopWaitSecs(postgresql), `${SUPERVISORD}: [program:postgresql] has no stopwaitsecs=<n>`).toBeGreaterThanOrEqual(30);
  });

  it('postgres-start.sh execs postgres, so the signal reaches PostgreSQL and not a shell', () => {
    expect(read('docker/unified/postgres-start.sh')).toMatch(/^exec\s+\S*\/postgres\s/m);
  });

  it(`${SUPERVISORD}: app SIGKILLs its whole group at the backstop, never SIGTERMs it`, () => {
    expect(app, `${SUPERVISORD}: no [program:app] section`).not.toBe('');
    expect(app).toMatch(/^killasgroup\s*=\s*true\s*$/m);
    // stopasgroup would SIGTERM a running ffmpeg at t=0 and fail its import
    expect(app).not.toMatch(/^stopasgroup\s*=\s*true\s*$/m);
  });

  it(`${SUPERVISORD}: app's stopwaitsecs leaves node's hard deadline at least 3 s of room`, () => {
    const wait = stopWaitSecs(app);
    expect(wait, `${SUPERVISORD}: [program:app] has no stopwaitsecs=<n>`).toBeDefined();
    expect(wait!).toBeGreaterThanOrEqual(SHUTDOWN_HARD_DEADLINE_MS / 1000 + 3);
  });

  it(`${SUPERVISORD}: app's stopwaitsecs leaves Redis and PostgreSQL about 2 s of a default 10 s stop`, () => {
    expect(stopWaitSecs(app)!).toBeLessThanOrEqual(DEFAULT_DOCKER_STOP_S - 2);
  });

  it('node: the drain and three step limits end before the hard deadline, so every step warning prints', () => {
    expect(SHUTDOWN_DRAIN_MS + 3 * SHUTDOWN_STEP_LIMIT_MS).toBeLessThan(SHUTDOWN_HARD_DEADLINE_MS);
  });

  it(`${APP_START}: a watchdog SIGKILLs node by wall clock after its deadline and before supervisord's backstop`, () => {
    const m = appStart.match(/^APP_STOP_KILL_AFTER=(\d+)$/m);
    expect(m, 'no APP_STOP_KILL_AFTER=<seconds>').not.toBeNull();
    const killAfter = Number(m![1]);
    expect(killAfter).toBeGreaterThan(SHUTDOWN_HARD_DEADLINE_MS / 1000);
    expect(killAfter).toBeLessThan(stopWaitSecs(app)!);
    // Started from the stop trap, in the background, after the SIGTERM is forwarded
    const onStop = appStart.match(/^on_stop\(\) \{\n([\s\S]*?)^\}$/m)?.[1] ?? '';
    expect(onStop, 'no on_stop() function').not.toBe('');
    const forward = onStop.search(/kill -TERM "\$SERVER_PID"/);
    const watchdog = onStop.search(/\(\n\s*sleep "\$APP_STOP_KILL_AFTER"\n[\s\S]*kill -KILL "\$SERVER_PID"[^\n]*\n[\s\S]*?\n\s*\) &$/m);
    expect(forward).toBeGreaterThanOrEqual(0);
    expect(watchdog, 'no `( sleep "$APP_STOP_KILL_AFTER"; ... kill -KILL "$SERVER_PID" ... ) &` in on_stop').toBeGreaterThan(forward);
  });

  it(`${APP_START}: a process gone between the /proc glob and the read logs nothing`, () => {
    // `read < "$stat" 2>/dev/null` reports the failed input redirect before stderr is redirected
    expect(appStart).toMatch(/\{ read -r line < "\$stat"; \} 2>\/dev\/null \|\| continue/);
    expect(appStart).not.toMatch(/read -r line < "\$stat" 2>\/dev\/null/);
  });

  it(`${APP_START}: zombies (exited, waiting for supervisord to reap them) are not counted as leftovers`, () => {
    // The watchdog's orphaned sleep is reaped on supervisord's next tick; counting it cost every stop 1 s
    expect(appStart).toMatch(/read -r state _ pgrp _ <<< "\$rest"/);
    expect(appStart).toMatch(/if \[ "\$state" = "Z" \]; then continue; fi/);
  });

  it(`${APP_START}: hands the signal to node's coordinator and forwards it before node starts`, () => {
    expect(appStart).toMatch(/^export NEXT_MANUAL_SIG_HANDLE=true$/m);
    const trap = appStart.search(/^trap on_stop TERM INT$/m);
    const start = appStart.search(/^start_server$/m);
    expect(trap, 'no `trap on_stop TERM INT`').toBeGreaterThanOrEqual(0);
    expect(start, 'no `start_server` call').toBeGreaterThan(trap);
    expect(appStart).toMatch(/kill -TERM "\$SERVER_PID"/);
  });

  it(`${APP_START}: every wait survives set -e (a trapped signal makes wait return >128)`, () => {
    const waits = appStart.split('\n').filter((line) => /(^|[\s;])wait\b/.test(line) && !/wait_for_node/.test(line));
    expect(waits.length).toBeGreaterThan(0);
    for (const line of waits) expect(line, `bare wait: ${line.trim()}`).toMatch(/\|\|/);
    // The final wait loops until node is gone, and the wrapper ends leftovers only after that
    expect(appStart).toMatch(/kill -0 "\$SERVER_PID"[^\n]*then break/);
    expect(appStart).toMatch(/kill -TERM -- "-\$\$"/);
  });

  it.for(['docker-compose.yml', 'docker-compose.local.yml', 'README.md'])(
    '%s: stop_grace_period is above the summed stopwaitsecs',
    (file, { skip }) => {
      if (!fs.existsSync(path.join(root, file))) {
        if (onGitHubActions) throw new Error(`${file} is missing on GitHub Actions`);
        const reason = `${file} is not in this checkout (e2e/Dockerfile.test build context); checked on GitHub Actions and host runs`;
        console.warn(`[supervisord-config] skipped: ${reason}`);
        skip(reason);
        return;
      }
      const graces = [...read(file).matchAll(/^\s*stop_grace_period:\s*(\d+)s\b/gm)].map((m) => Number(m[1]));
      expect(graces.length, `${file}: no stop_grace_period: <n>s line (write plain seconds, e.g. 90s)`).toBeGreaterThan(0);
      for (const g of graces) {
        expect(g, `${file}: stop_grace_period ${g}s must exceed the ${worstCaseStop} s worst-case stop in ${SUPERVISORD}`).toBeGreaterThan(worstCaseStop);
      }
    },
  );
});
