/**
 * Component: E2E #177 Library perf gate: the run's own conditions (2-CPU cap, sample counts, quiet host) and its budgets
 * Documentation: documentation/testing/e2e-harness.md
 *
 * No imports, so a saved `177-perf/result.json` can be judged offline with the same rules
 * (`node 177-perf-gate.ts` type stripping, or any TS loader). Order of judgement: the cap, then the
 * quiet-host gate (a miss voids the run: the budgets are not judged), then the sample counts, then
 * the budgets.
 */

export const BUDGET = { fullP95: 300, liveP95: 50, lagP99: 100, healthMarginMs: 25 };

/**
 * Quiet host, from the run's own numbers (a quiet 2-CPU reference run gave 37 / 42 / 18 / 6 ms idle,
 * 1554 / 472 stress calls and 126 ms idle at 30k). Idle figures come before the load, the stress
 * counts and the 30k idle figure after it, so contention at either end voids the run.
 */
export const QUIET = { idleFullP50: 45, idleFullP95: 55, idleLiveP50: 21, idleHealthP95: 10, stressLiveN: 1400, stressFullN: 425, idle30FullP50: 150 };

/**
 * Sample counts the schedule makes. `every()` plans its slots from the start time (no drift), so a
 * slow host bunches calls rather than dropping them: full 30 steady + 10 burst, live 5 pollers x 12.
 * Lag (1200 slots) and health (300 slots) may lose a slot or a few when the runner starts a loop
 * late, so they get a 20-slot and a 5-slot tolerance.
 */
export const EXPECTED = {
  idle: { lagProbe: 40, health: 40, full: 10, live: 20 },
  full: 40,
  burst: 10,
  live: 60,
  lag: { min: 1180, max: 1200 },
  health: { min: 295, max: 300 },
  writes: { 'recently-added touch': 6, 'progress tick': 12, 'new library row': 1 } as Record<string, number>,
  rows: { seeded: 10_000, afterWindow: 10_001, total: 11_000 },
  guidWindowsMin: 9_000,
};

/** Prints the container's CPU quota: `v2 <quota|max> <period>` (cgroup v2), `v1 <quota|-1> <period>` (v1, Docker Desktop), else `unknown`. */
export const CPU_CAP_PROBE = [
  'c=/sys/fs/cgroup;',
  'if [ -r $c/cpu.max ]; then echo "v2 $(cat $c/cpu.max)";',
  'elif [ -r $c/cpu/cpu.cfs_quota_us ]; then echo "v1 $(cat $c/cpu/cpu.cfs_quota_us) $(cat $c/cpu/cpu.cfs_period_us)";',
  'else echo unknown; fi',
].join(' ');

/** CPUs allowed by a probe line (quota / period); null when uncapped (`max`, `-1`) or unreadable. */
export function cpusFromProbe(raw: string | undefined): number | null {
  const m = /^(?:v[12] )?(\d+) (\d+)$/.exec(String(raw ?? '').trim());
  if (!m || Number(m[2]) === 0) return null;
  return Number(m[1]) / Number(m[2]);
}

interface Stats { n: number; p50: number; p95: number; p99: number; max: number }
interface Idle { lagProbe: Stats; health: Stats; full: Stats; live: Stats }
interface Loaded { full: Stats; fullSteady: Stats; fullBurst: Stats; live: Stats; health: Stats; lagProbe: Stats }
interface Window { idle: Idle; loaded: Loaded; lagP99Ms: number; healthP95OverIdleMs: number; errors: string[]; writes: string[] }

export interface PerfResult {
  cpuMax?: string;
  guidRowsWithAsinWindows?: number;
  rows10000?: Window & {
    counts?: { libraryRows?: number; afterWindow?: number; total?: number };
    stress?: { live?: Stats; full?: Stats; errors?: string[] };
  };
  rows30000?: { idle?: Partial<Idle> };
}

export type Outcome = 'no cap' | 'void' | 'incomplete' | 'budget miss' | 'pass';

export interface Judgement {
  cpus: number | null;
  outcome: Outcome;
  cap: string[];
  notQuiet: string[];
  incomplete: string[];
  budgetMisses: string[];
}

/** Every comparison is written so a missing value (undefined, NaN) fails it. */
export function judgePerfRun(r: PerfResult): Judgement {
  const cpus = cpusFromProbe(r.cpuMax);
  const cap = cpus === 2 ? [] : [`rmab CPU cap ${cpus ?? 'unknown'} (probe "${r.cpuMax ?? ''}"), expected 2`];

  const w = r.rows10000;
  const notQuiet: string[] = [];
  const atMost = (into: string[], label: string, value: number | undefined, limit: number, unit = ' ms') => {
    if (!(Number(value) <= limit)) into.push(`${label} ${value}${unit} > ${limit}`);
  };
  const atLeast = (into: string[], label: string, value: number | undefined, limit: number) => {
    if (!(Number(value) >= limit)) into.push(`${label} ${value} < ${limit}`);
  };
  atMost(notQuiet, 'idle10 full p50', w?.idle?.full?.p50, QUIET.idleFullP50);
  atMost(notQuiet, 'idle10 full p95', w?.idle?.full?.p95, QUIET.idleFullP95);
  atMost(notQuiet, 'idle10 live p50', w?.idle?.live?.p50, QUIET.idleLiveP50);
  atMost(notQuiet, 'idle10 health p95', w?.idle?.health?.p95, QUIET.idleHealthP95);
  atLeast(notQuiet, 'stress live n', w?.stress?.live?.n, QUIET.stressLiveN);
  atLeast(notQuiet, 'stress full n', w?.stress?.full?.n, QUIET.stressFullN);
  atMost(notQuiet, 'idle30 full p50', r.rows30000?.idle?.full?.p50, QUIET.idle30FullP50);

  const incomplete: string[] = [];
  const exactly = (label: string, value: number | undefined, want: number) => {
    if (value !== want) incomplete.push(`${label} ${value}, expected ${want}`);
  };
  const within = (label: string, value: number | undefined, { min, max }: { min: number; max: number }) => {
    if (!(Number(value) >= min && Number(value) <= max)) incomplete.push(`${label} ${value}, expected ${min}-${max}`);
  };
  for (const [k, want] of Object.entries(EXPECTED.idle)) exactly(`idle10 ${k} n`, w?.idle?.[k as keyof Idle]?.n, want);
  exactly('full n (steady + burst)', w?.loaded?.full?.n, EXPECTED.full);
  exactly('burst n', w?.loaded?.fullBurst?.n, EXPECTED.burst);
  exactly('live n', w?.loaded?.live?.n, EXPECTED.live);
  within('lag n', w?.loaded?.lagProbe?.n, EXPECTED.lag);
  within('health n', w?.loaded?.health?.n, EXPECTED.health);
  const writes = w?.writes ?? [];
  for (const [label, want] of Object.entries(EXPECTED.writes)) {
    exactly(`writes done: ${label}`, writes.filter((x) => new RegExp(`^\\d+ms ${label}$`).test(x)).length, want);
  }
  const failed = writes.filter((x) => x.includes(' FAILED'));
  if (failed.length) incomplete.push(`writes failed: ${failed.join(' | ')}`);
  exactly('library rows seeded', w?.counts?.libraryRows, EXPECTED.rows.seeded);
  exactly('library rows after the window', w?.counts?.afterWindow, EXPECTED.rows.afterWindow);
  exactly('entries (rows + 1000 request-only)', w?.counts?.total, EXPECTED.rows.total);
  atLeast(incomplete, 'guid rows with ASIN windows', r.guidRowsWithAsinWindows, EXPECTED.guidWindowsMin);
  const errors = [...(w?.errors ?? ['window errors missing']), ...(w?.stress?.errors ?? ['stress errors missing'])];
  if (errors.length) incomplete.push(`errors: ${errors.join(' | ')}`);

  const budgetMisses: string[] = [];
  const under = (label: string, value: number | undefined, limit: number) => {
    if (!(Number(value) < limit)) budgetMisses.push(`${label} ${value} ms, budget < ${limit}`);
  };
  under('full p95', w?.loaded?.full?.p95, BUDGET.fullP95);
  under('live p95', w?.loaded?.live?.p95, BUDGET.liveP95);
  under('lag p99', w?.lagP99Ms, BUDGET.lagP99);
  if (!(Number(w?.healthP95OverIdleMs) <= BUDGET.healthMarginMs)) {
    budgetMisses.push(`health p95 over idle ${w?.healthP95OverIdleMs} ms, budget <= ${BUDGET.healthMarginMs}`);
  }

  const outcome: Outcome = cap.length ? 'no cap' : notQuiet.length ? 'void' : incomplete.length ? 'incomplete' : budgetMisses.length ? 'budget miss' : 'pass';
  return { cpus, outcome, cap, notQuiet, incomplete, budgetMisses };
}
