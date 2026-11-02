/**
 * Component: Unified container stop settings — Tests
 * Documentation: documentation/deployment/unified.md
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// e2e/Dockerfile.test's build context leaves out docker-compose*.yml, so the containerized unit suite
// skips those rows with a reason. Never on GitHub Actions (full checkout). (Not CI: Dockerfile.test sets CI=true.)
const onGitHubActions = process.env.GITHUB_ACTIONS === 'true';

const SUPERVISORD = 'docker/unified/supervisord.conf';
const sections = read(SUPERVISORD).split(/^(?=\[)/m);
const programs = sections.filter((s) => s.startsWith('[program:'));
const postgresql = programs.find((s) => s.startsWith('[program:postgresql]')) ?? '';

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
