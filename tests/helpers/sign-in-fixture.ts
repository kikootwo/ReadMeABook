/**
 * Component: Sign-in Route Test Fixture
 * Documentation: documentation/backend/services/auth.md
 *
 * In-memory accounts, bcrypt/encryption/logger doubles and request builders for the
 * sign-in attempt-limit tests. Test files wire these into vi.mock factories.
 */

import { vi } from 'vitest';
import { NextRequest } from 'next/server';

export const RIGHT_PASSWORD = 'correct horse battery';
export const WRONG_PASSWORD = 'wrong password';

export interface AccountRow {
  id: string;
  plexId: string;
  plexUsername: string;
  plexEmail: string | null;
  avatarUrl: string | null;
  role: string;
  authProvider: string;
  authToken: string | null;
  isSetupAdmin: boolean;
  registrationStatus: string | null;
  deletedAt: Date | null;
}

const rows: AccountRow[] = [];

export const prismaMock = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

export const bcryptMock = { compare: vi.fn(), hash: vi.fn(), getRounds: vi.fn() };
export const encryptionMock = { decrypt: vi.fn(), encrypt: vi.fn() };
export const loggerMock = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** The real stored hash of every fixture account: "hash-<id>" (encrypted as "enc:hash-<id>") */
export function defaultCompare(password: string, hash: string): boolean {
  return password === RIGHT_PASSWORD && hash.startsWith('hash-');
}

export function resetFixture(): void {
  rows.length = 0;
  for (const fn of [...Object.values(prismaMock.user), ...Object.values(bcryptMock), ...Object.values(encryptionMock), ...Object.values(loggerMock)]) {
    fn.mockReset();
  }
  prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { plexId: string } }) =>
    rows.find((row) => row.plexId === where.plexId) ?? null
  );
  prismaMock.user.findFirst.mockImplementation(
    async ({ where }: { where: { plexUsername: string; authProvider: string; deletedAt: null } }) =>
      rows.find((row) => row.plexUsername === where.plexUsername && row.authProvider === 'local' && row.deletedAt === null) ??
      null
  );
  prismaMock.user.update.mockResolvedValue({});
  bcryptMock.compare.mockImplementation(async (password: string, hash: string) => defaultCompare(password, hash));
  encryptionMock.decrypt.mockImplementation((value: string) => {
    if (!value.startsWith('enc:')) throw new Error('Invalid encrypted value');
    return value.slice(4);
  });
}

export function addAccount(username: string, overrides: Partial<AccountRow> = {}): AccountRow {
  const id = overrides.id ?? `user-${username}`;
  const row: AccountRow = {
    id,
    plexId: `local-${username}`,
    plexUsername: username,
    plexEmail: null,
    avatarUrl: null,
    role: 'user',
    authProvider: 'local',
    authToken: `enc:hash-${id}`,
    isSetupAdmin: false,
    registrationStatus: 'approved',
    deletedAt: null,
    ...overrides,
  };
  rows.push(row);
  return row;
}

export type SignInRoute = 'admin' | 'local';
export const SIGN_IN_ROUTES: SignInRoute[] = ['admin', 'local'];

export interface SignInOptions {
  ip?: string;
  cookie?: string;
  proto?: string;
}

export function signInRequest(route: SignInRoute, body: unknown, options: SignInOptions = {}): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': options.ip ?? '203.0.113.7',
  };
  if (options.cookie) headers.cookie = `rmab_known_browser=${options.cookie}`;
  if (options.proto) headers['x-forwarded-proto'] = options.proto;
  const path = route === 'admin' ? '/api/auth/admin/login' : '/api/auth/local/login';
  return new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body), headers });
}

export async function loadRoute(route: SignInRoute): Promise<(request: NextRequest) => Promise<Response>> {
  const mod =
    route === 'admin' ? await import('@/app/api/auth/admin/login/route') : await import('@/app/api/auth/local/login/route');
  return mod.POST;
}

export interface SignInResult {
  status: number;
  body: Record<string, unknown>;
  retryAfter: string | null;
  setCookie: string | null;
  knownBrowserCookie: string | undefined;
}

export async function signIn(
  route: SignInRoute,
  username: unknown,
  password: unknown,
  options: SignInOptions = {}
): Promise<SignInResult> {
  const POST = await loadRoute(route);
  const response = await POST(signInRequest(route, { username, password }, options));
  const setCookie = response.headers.get('set-cookie');
  const match = setCookie?.match(/rmab_known_browser=([^;]*)/);
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    retryAfter: response.headers.get('retry-after'),
    setCookie,
    knownBrowserCookie: match?.[1],
  };
}

/** Number of password checks against a real stored hash (not the dummy) */
export function realCompares(): number {
  return bcryptMock.compare.mock.calls.filter(([, hash]) => String(hash).startsWith('hash-')).length;
}
