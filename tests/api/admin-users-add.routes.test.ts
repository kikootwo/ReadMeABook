/**
 * Component: Admin Add Local User Route Tests (real auth middleware)
 * Documentation: documentation/admin-dashboard.md
 *
 * POST /api/admin/users: admin sessions only (no API tokens), a local user with the
 * User role, already approved, whatever the registration and approval settings are.
 * Refused while local login is off. The password never reaches a log or a response.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const PASSWORD = 'Sup3r-secret-pw';
const ISSUED_AT = vi.hoisted(() => 1_700_000_000);

const state = vi.hoisted(() => ({
  config: {} as Record<string, string | null>,
  sessionUsers: {} as Record<string, { id: string; role: string; deletedAt: null; registrationStatus: string }>,
  logLines: [] as unknown[][],
}));

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  apiToken: {
    findUnique: vi.fn(async () => ({
      id: 't1', tokenPrefix: 'rmab_abc', expiresAt: null, role: 'admin',
      tokenUser: { id: 'u-admin', plexId: 'local-admin', plexUsername: 'admin', role: 'admin', deletedAt: null, registrationStatus: 'approved' },
    })),
    update: vi.fn(async () => ({})),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: (token: string) =>
    token === 'admin-token' ? { sub: 'u-admin', role: 'admin', plexId: 'local-admin', username: 'admin', iat: ISSUED_AT }
      : token === 'user-token' ? { sub: 'u-user', role: 'user', plexId: 'local-user', username: 'user', iat: ISSUED_AT }
      : null,
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async (key: string) => state.config[key] ?? null,
    getBackendMode: async () => state.config['system.backend_mode'] || 'plex',
  }),
}));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ encrypt: (value: string) => `enc:${value}`, decrypt: (value: string) => value.slice(4) }),
}));
vi.mock('@/lib/utils/logger', () => {
  const record = (...args: unknown[]) => { state.logLines.push(args); };
  return { RMABLogger: { create: () => ({ info: record, debug: record, warn: record, error: record }) } };
});

function post(body: unknown, token: string | null = 'admin-token') {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/admin/users', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call(req: NextRequest) {
  const { POST } = await import('@/app/api/admin/users/route');
  const response = await POST(req);
  const text = await response.text();
  return { status: response.status, text, payload: JSON.parse(text) };
}

const uniqueKeyError = () =>
  Object.assign(new Error('Unique constraint failed on the fields: (`plex_id`)'), { code: 'P2002' });

describe('POST /api/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.logLines = [];
    state.config = {
      'system.backend_mode': 'audiobookshelf',
      'auth.registration_enabled': 'true',
      'auth.require_admin_approval': 'false',
    };
    state.sessionUsers = {
      'u-admin': { id: 'u-admin', role: 'admin', deletedAt: null, registrationStatus: 'approved' },
      'u-user': { id: 'u-user', role: 'user', deletedAt: null, registrationStatus: 'approved' },
    };
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => state.sessionUsers[where.id] ?? null);
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-1', ...data }));
  });

  afterEach(() => {
    delete process.env.DISABLE_LOCAL_LOGIN;
    // Nothing a test sent as a password may show up in a log line
    expect(JSON.stringify(state.logLines)).not.toContain(PASSWORD);
  });

  it('creates an approved local user with the User role and returns no secrets', async () => {
    const { status, text, payload } = await call(post({ username: 'NewReader', password: PASSWORD }));

    expect(status).toBe(201);
    expect(payload).toEqual({
      user: { id: 'new-1', plexUsername: 'newreader', role: 'user', authProvider: 'local' },
    });
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('authToken');
    const { data } = prismaMock.user.create.mock.calls[0][0];
    expect(data).toMatchObject({
      plexId: 'local-newreader',
      plexUsername: 'newreader',
      authProvider: 'local',
      role: 'user',
      isSetupAdmin: false,
      registrationStatus: 'approved',
    });
    expect(data.authToken).toMatch(/^enc:\$2[aby]\$10\$/);
    expect(data.authToken).not.toContain(PASSWORD);
  });

  it('ignores a role or status in the body', async () => {
    const { status } = await call(
      post({ username: 'sneaky', password: PASSWORD, role: 'admin', registrationStatus: 'pending_approval', isSetupAdmin: true })
    );

    expect(status).toBe(201);
    expect(prismaMock.user.create.mock.calls[0][0].data).toMatchObject({
      role: 'user',
      isSetupAdmin: false,
      registrationStatus: 'approved',
    });
  });

  it('works with self-registration off and admin approval on', async () => {
    state.config['auth.registration_enabled'] = 'false';
    state.config['auth.require_admin_approval'] = 'true';

    const { status } = await call(post({ username: 'invited', password: PASSWORD }));

    expect(status).toBe(201);
    expect(prismaMock.user.create.mock.calls[0][0].data.registrationStatus).toBe('approved');
  });

  it('refuses a non-admin session', async () => {
    const { status, payload } = await call(post({ username: 'newreader', password: PASSWORD }, 'user-token'));

    expect(status).toBe(403);
    expect(payload.message).toBe('Admin access required');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('refuses an API token, even an admin one', async () => {
    const { status, payload } = await call(post({ username: 'newreader', password: PASSWORD }, 'rmab_abcdef'));

    expect(status).toBe(403);
    expect(payload.message).toBe('This endpoint is not available via API token authentication');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('refuses a request without a session', async () => {
    const { status } = await call(post({ username: 'newreader', password: PASSWORD }, null));

    expect(status).toBe(401);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it.each([
    ['DISABLE_LOCAL_LOGIN is true', 'audiobookshelf', 'true'],
    ['the backend is Plex', 'plex', undefined],
  ])('refuses with a clear message when %s', async (_label, mode, disable) => {
    state.config['system.backend_mode'] = mode;
    if (disable) process.env.DISABLE_LOCAL_LOGIN = disable;

    const { status, payload } = await call(post({ username: 'newreader', password: PASSWORD }));

    expect(status).toBe(403);
    expect(payload.message).toBe('Local login is not enabled, so local users cannot be added');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ username: 'ab', password: PASSWORD }, 'Username must be at least 3 characters'],
    [{ username: 'newreader', password: 'short' }, 'Password must be at least 8 characters'],
    [{ username: 'newreader', password: '' }, 'Password is required'],
  ])('answers the rule a person can act on (%j)', async (body, message) => {
    const { status, payload } = await call(post(body));

    expect(status).toBe(400);
    expect(payload).toEqual({ error: 'ValidationError', message });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing password', { username: 'newreader' }],
    ['a number for a username', { username: 12345, password: PASSWORD }],
    ['a body that is not JSON', '{"username":'],
  ])('answers 400 for %s', async (_label, body) => {
    const { status, text, payload } = await call(post(body));

    expect(status).toBe(400);
    expect(payload.error).toBe('ValidationError');
    expect(payload.message).toBe('Username and password are required');
    expect(text).not.toContain(PASSWORD);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('answers 413 for a body over the 64 KB sign-in limit', async () => {
    const { status, payload } = await call(post({ username: 'newreader', password: 'x'.repeat(64 * 1024) }));

    expect(status).toBe(413);
    expect(payload.error).toBe('PayloadTooLarge');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('answers 409 for a taken username in another case', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 'existing' });

    const { status, payload } = await call(post({ username: 'NEWREADER', password: PASSWORD }));

    expect(status).toBe(409);
    expect(payload).toEqual({ error: 'Conflict', message: 'That username is already taken' });
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { plexUsername: 'newreader', authProvider: 'local', deletedAt: null },
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('answers 409, not the database text, for a name equal to a deleted account\'s freed key', async () => {
    prismaMock.user.create.mockRejectedValue(uniqueKeyError());

    const { status, text, payload } = await call(post({ username: 'bob-deleted-1700000000000', password: PASSWORD }));

    expect(status).toBe(409);
    expect(payload.message).toBe('That username is already taken');
    expect(text).not.toMatch(/constraint|plex_id/i);
  });

  it('answers a generic 500 for any other failure', async () => {
    prismaMock.user.create.mockRejectedValue(new Error('connection lost'));

    const { status, text } = await call(post({ username: 'newreader', password: PASSWORD }));

    expect(status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'Failed to add user', message: 'Failed to add user' });
  });
});

describe('GET /api/admin/users localLoginEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.DISABLE_LOCAL_LOGIN;
  });

  it.each([
    ['audiobookshelf', undefined, true],
    ['audiobookshelf', 'true', false],
    ['plex', undefined, false],
  ])('backend %s, DISABLE_LOCAL_LOGIN=%s: %s', async (mode, disable, expected) => {
    state.config = { 'system.backend_mode': mode };
    if (disable) process.env.DISABLE_LOCAL_LOGIN = disable;
    state.sessionUsers = { 'u-admin': { id: 'u-admin', role: 'admin', deletedAt: null, registrationStatus: 'approved' } };
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => state.sessionUsers[where.id] ?? null);

    const { GET } = await import('@/app/api/admin/users/route');
    const response = await GET(
      new NextRequest('http://localhost/api/admin/users', { headers: { authorization: 'Bearer admin-token' } })
    );

    expect((await response.json()).localLoginEnabled).toBe(expected);
  });
});
