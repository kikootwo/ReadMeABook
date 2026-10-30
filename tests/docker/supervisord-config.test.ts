/**
 * Component: Unified container supervisord stop settings — Tests
 * Documentation: documentation/deployment/unified.md
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// docker-compose.yml is in .dockerignore, so the containerized unit suite (e2e/Dockerfile.test)
// can't see it. Skip it there with a reason, but never on GitHub Actions (full checkout).
const onGitHubActions = process.env.GITHUB_ACTIONS === 'true';

// supervisord's default when a program sets no stopwaitsecs
const SUPERVISORD_DEFAULT_STOPWAITSECS = 10;

type Section = Record<string, string>;

/** Minimal INI parser for supervisord.conf: `[section]` headers and `key=value` lines; `;` / `#` comments. */
function parseIni(text: string): Record<string, Section> {
  const sections: Record<string, Section> = {};
  let current: Section | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      current = sections[header[1]] = {};
      continue;
    }
    const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (kv && current) current[kv[1]] = kv[2];
  }
  return sections;
}

/** Docker/compose duration (`90s`, `1m30s`, `2m`, bare seconds) → seconds. */
function durationSeconds(value: string): number | undefined {
  const v = value.trim().replace(/^['"]|['"]$/g, '');
  if (/^\d+$/.test(v)) return Number(v);
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

const SUPERVISORD = 'docker/unified/supervisord.conf';
const sections = parseIni(read(SUPERVISORD));
const programs = Object.entries(sections).filter(([name]) => name.startsWith('program:'));
const stopWait = (s: Section) => (s.stopwaitsecs === undefined ? SUPERVISORD_DEFAULT_STOPWAITSECS : Number(s.stopwaitsecs));

describe('supervisord stop settings (clean PostgreSQL shutdown)', () => {
  it(`${SUPERVISORD}: defines the postgresql, redis and app programs`, () => {
    expect(programs.map(([name]) => name).sort()).toEqual(['program:app', 'program:postgresql', 'program:redis']);
  });

  it('postgresql stops with SIGINT (fast shutdown), not the default SIGTERM (smart shutdown)', () => {
    const pg = sections['program:postgresql'];
    expect(pg.stopsignal, `${SUPERVISORD}: [program:postgresql] stopsignal`).toBe('INT');
  });

  it('postgresql gets enough time to checkpoint before supervisord sends SIGKILL', () => {
    const pg = sections['program:postgresql'];
    expect(pg.stopwaitsecs, `${SUPERVISORD}: [program:postgresql] must set stopwaitsecs`).toBeDefined();
    expect(Number(pg.stopwaitsecs)).toBeGreaterThanOrEqual(30);
  });

  it('postgres-start.sh execs postgres, so the stop signal reaches PostgreSQL itself', () => {
    const script = read('docker/unified/postgres-start.sh');
    expect(script).toMatch(/^exec\s+\S*\/postgres\s/m);
  });

  it('docker-compose.yml stop_grace_period outlasts every program stopping in turn', ({ skip }) => {
    const file = 'docker-compose.yml';
    if (!fs.existsSync(path.join(root, file))) {
      if (onGitHubActions) throw new Error(`${file} is missing on GitHub Actions`);
      const reason = `${file} is not in this checkout (e2e/Dockerfile.test build context); checked on GitHub Actions and host runs`;
      console.warn(`[supervisord-config] skipped: ${reason}`);
      skip(reason);
      return;
    }
    const m = read(file).match(/^\s*stop_grace_period:\s*(\S+)/m);
    expect(m, `${file}: readmeabook service must set stop_grace_period (Docker's default 10s SIGKILLs PostgreSQL)`).not.toBeNull();
    const grace = durationSeconds(m![1]);
    expect(grace, `${file}: unparseable stop_grace_period "${m![1]}"`).toBeDefined();
    // supervisord stops programs one after another (reverse priority), so the worst case is the sum.
    const worstCase = programs.reduce((sum, [, s]) => sum + stopWait(s), 0);
    expect(grace!, `${file}: stop_grace_period ${grace}s must exceed the ${worstCase}s worst-case supervisord stop`).toBeGreaterThan(worstCase);
  });
});

describe('durationSeconds', () => {
  it.each([
    ['90s', 90],
    ['1m30s', 90],
    ['2m', 120],
    ['45', 45],
    ['"90s"', 90],
  ])('%s → %i', (input, expected) => {
    expect(durationSeconds(input)).toBe(expected);
  });

  it('rejects garbage', () => {
    expect(durationSeconds('soon')).toBeUndefined();
    expect(durationSeconds('')).toBeUndefined();
  });
});
