/**
 * Component: E2E harness spec helpers (env, RMAB/ABS/fake-arr clients, polling, stack exec)
 * Documentation: documentation/testing/e2e-harness.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** True when run.mjs started the exec bridge (untainted runs only). */
export const execBridgeAvailable = () => Boolean(process.env.E2E_EXEC_BRIDGE_URL && process.env.E2E_EXEC_TOKEN);
export const EXEC_BRIDGE_SKIP = 'needs the exec bridge (docker exec into the stack), which run.mjs only provides for untainted runs';

/**
 * Run argv inside a stack service (rmab | fake-arr | abs) via the host exec bridge, synchronously.
 * Throws like execFileSync on a non-zero exit. Untainted runs only.
 */
export function stackExecSync(service: string, argv: string[], { user, input }: { user?: string; input?: string } = {}): string {
  if (!execBridgeAvailable()) throw new Error(EXEC_BRIDGE_SKIP);
  return execFileSync(process.execPath, [path.join(__dirname, 'exec-client.cjs')], {
    encoding: 'utf8',
    input: JSON.stringify({ service, user, argv, input }),
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** `docker compose logs --no-color <service>` via the exec bridge (read-only). Untainted runs only. */
export function stackLogsSync(service: string): string {
  if (!execBridgeAvailable()) throw new Error(EXEC_BRIDGE_SKIP);
  return execFileSync(process.execPath, [path.join(__dirname, 'exec-client.cjs')], {
    encoding: 'utf8',
    input: JSON.stringify({ op: 'logs', service }),
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: run specs through e2e/run.mjs`);
  return value;
}

export const urls = {
  rmab: () => env('E2E_BASE_URL'),
  control: () => env('E2E_CONTROL_URL'),
  abs: () => env('E2E_ABS_URL'),
};

/** Absolute path under the evidence dir; parts may contain '/'. Parent directories are created. */
export const evidencePath = (...parts: string[]) => {
  const file = path.join(env('E2E_EVIDENCE_DIR'), ...parts.flatMap((p) => p.split('/')));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
};

/** Tokens and ids written by bootstrap.ts. */
export function authState(): { accessToken: string; refreshToken?: string; absLibraryId: string; setupRan: boolean } {
  return JSON.parse(fs.readFileSync(evidencePath('auth.json'), 'utf8'));
}

export function writeEvidence(name: string, value: unknown) {
  fs.writeFileSync(evidencePath(name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

/** Evidence screenshot: viewport-sized JPEG (1280x720, <=1600 px per side). */
export async function snap(page: { screenshot: (o: any) => Promise<unknown> }, dir: string, name: string) {
  await page.screenshot({ path: evidencePath(dir, `${name}.jpg`), type: 'jpeg', quality: 70, fullPage: false });
}

export async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, { timeoutMs = 60_000, intervalMs = 1_000 } = {}): Promise<T> {
  const end = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value as T;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > end) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${lastError ? ` (last error: ${String(lastError)})` : ''}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function json<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** RMAB API client authenticated with a bearer access token. */
export class Rmab {
  constructor(public token: string) {}

  static async loginAdmin(): Promise<Rmab> {
    const res = await fetch(`${urls.rmab()}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: env('E2E_ADMIN_USER'), password: env('E2E_ADMIN_PASSWORD') }),
    });
    const body = await json<{ accessToken: string }>(res, 'admin login');
    return new Rmab(body.accessToken);
  }

  async raw(method: string, p: string, body?: unknown): Promise<Response> {
    return fetch(`${urls.rmab()}${p}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async get<T = any>(p: string): Promise<T> {
    return json<T>(await this.raw('GET', p), `GET ${p}`);
  }

  async post<T = any>(p: string, body: unknown = {}): Promise<T> {
    return json<T>(await this.raw('POST', p, body), `POST ${p}`);
  }

  /** Create a request for a fixture book (bypasses the UI; used by regression specs). */
  async requestBook(book: Book) {
    return this.post<{ request: { id: string; status: string } }>('/api/requests', {
      audiobook: { asin: book.asin, title: book.title, author: book.author, narrator: book.narrator, durationMinutes: book.runtimeMin ?? undefined },
    });
  }

  async findRequest(asin: string) {
    const body = await this.get<{ requests: any[] }>('/api/requests?limit=100');
    return body.requests.find((r) => r.audiobook?.audibleAsin === asin || r.audiobook?.asin === asin);
  }

  async triggerScheduledJob(type: string) {
    const jobs = await this.get<{ jobs: { id: string; type: string }[] }>('/api/admin/jobs');
    const job = jobs.jobs.find((j) => j.type === type);
    if (!job) throw new Error(`scheduled job ${type} not found`);
    return this.post(`/api/admin/jobs/${job.id}/trigger`);
  }
}

export interface Book {
  asin: string;
  title: string;
  author: string;
  narrator: string;
  runtimeMin: number | null;
}

export interface Recorded {
  seq: number;
  ts: number;
  service: string;
  listener: number;
  method: string;
  host: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  status?: number;
  location?: string;
  added?: { hash?: string; nzoId?: string; releaseId: string | null }[];
}

/** fetch() against fake-arr /__control (adds the per-run control token). */
export const ctl = (p: string, init: RequestInit = {}) =>
  fetch(`${urls.control()}/__control${p}`, { ...init, headers: { 'x-control-token': env('E2E_CONTROL_TOKEN'), ...(init.headers || {}) } });

/** fake-arr control API client (token-protected; RMAB never has the token). */
export const fakeArr = {
  async scenario(name: string) {
    const res = await ctl('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    return json<{ ok: boolean; releases: string[] }>(res, `load scenario ${name}`);
  },
  async books(): Promise<Record<string, Book>> {
    return json(await ctl('/books'), 'books');
  },
  async requests(since = 0): Promise<Recorded[]> {
    return json(await ctl(`/requests?since=${since}`), 'recorded requests');
  },
  async plexLibrary(): Promise<{ refreshes: number; albums: { ratingKey: string; title: string; parentTitle: string; guid: string; dir: string }[] }> {
    return json(await ctl('/plex-library'), 'fake Plex library');
  },
  async state(): Promise<any> {
    return json(await ctl('/state'), 'fake-arr state');
  },
};

/** Recorded requests that carried the Prowlarr API key anywhere other than fake Prowlarr's own origin. */
export function keyLeaks(records: Recorded[], key: string, prowlarrListener = 9696) {
  return records.filter((r) => {
    const carries = Object.values(r.headers).some((v) => String(v).includes(key)) || Object.values(r.query).some((v) => String(v).includes(key));
    const prowlarrOrigin = r.service === 'prowlarr' && r.listener === prowlarrListener && r.host.startsWith('fake-arr:');
    return carries && !prowlarrOrigin;
  });
}

/** Audiobookshelf API client (root user). */
export class Abs {
  constructor(public token: string) {}

  static async login(): Promise<Abs> {
    const res = await fetch(`${urls.abs()}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: env('ABS_ROOT_USER'), password: env('ABS_ROOT_PASSWORD') }),
    });
    const body = await json<{ user: { token?: string; accessToken?: string; id: string } }>(res, 'ABS login');
    return new Abs(body.user.accessToken || body.user.token || '');
  }

  async req<T = any>(method: string, p: string, body?: unknown): Promise<T> {
    const res = await fetch(`${urls.abs()}${p}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return json<T>(res, `ABS ${method} ${p}`);
  }

  async libraryItems(libraryId: string): Promise<any[]> {
    return (await this.req<{ results: any[] }>('GET', `/api/libraries/${libraryId}/items?limit=100`)).results;
  }
}
