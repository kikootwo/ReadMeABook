/**
 * Component: OIDC Settings Save Route Tests
 * Documentation: documentation/settings-pages.md
 *
 * A masked or empty client secret keeps the saved secret only for the saved issuer.
 * Clearing the issuer disables OIDC and needs no secret. All values are written in
 * one transaction (setManyAtomic).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const MASK = '••••••••';
const saved = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));
const setManyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: unknown, handler: (r: unknown) => unknown) => handler(req),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: async (key: string) => saved.values[key] ?? null, setManyAtomic: setManyMock }),
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const base = { enabled: true, providerName: 'Authentik', clientId: 'rmab' };

async function save(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/admin/settings/oidc/route');
  return PUT({ json: async () => ({ ...base, ...body }) } as any);
}

const writes = () => (setManyMock.mock.calls[0]?.[0] ?? []) as Array<{ key: string; value: string; encrypted?: boolean }>;
const written = (key: string) => writes().find((u) => u.key === key);

describe('PUT /api/admin/settings/oidc', () => {
  beforeEach(() => {
    setManyMock.mockReset();
    saved.values = { 'oidc.issuer_url': 'https://auth.saved.example/application/o/rmab/', 'oidc.client_secret': 'saved-secret' };
  });

  it.each([
    ['the masked secret', MASK],
    ['an empty secret', ''],
    ['no secret', undefined],
  ])('refuses a new issuer with %s and saves nothing', async (_label, clientSecret) => {
    const response = await save({ issuerUrl: 'https://evil.example/', clientSecret });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('OIDC client secret');
    expect(setManyMock).not.toHaveBeenCalled();
  });

  it('keeps the saved secret for the saved issuer (trailing slash ignored)', async () => {
    const response = await save({ issuerUrl: 'https://auth.saved.example/application/o/rmab', clientSecret: MASK });

    expect(response.status).toBe(200);
    expect(written('oidc.client_secret')).toBeUndefined();
    expect(written('oidc.enabled')?.value).toBe('true');
  });

  it('saves a new issuer with a newly entered secret in the same write', async () => {
    const response = await save({ issuerUrl: 'https://auth.new.example/', clientSecret: 'new-secret' });

    expect(response.status).toBe(200);
    expect(writes()[0]).toEqual({ key: 'oidc.client_secret', value: 'new-secret', encrypted: true });
    expect(written('oidc.issuer_url')?.value).toBe('https://auth.new.example/');
  });

  it('allows clearing the issuer, which disables OIDC, without a secret', async () => {
    const response = await save({ issuerUrl: '', clientSecret: MASK });

    expect(response.status).toBe(200);
    expect(written('oidc.issuer_url')?.value).toBe('');
    expect(written('oidc.enabled')?.value).toBe('false');
    expect(written('oidc.client_secret')).toBeUndefined();
  });

  it('saves without a secret when none is saved and none is entered', async () => {
    saved.values = {};
    const response = await save({ issuerUrl: 'https://auth.new.example/', clientSecret: '' });

    expect(response.status).toBe(200);
    expect(written('oidc.client_secret')).toBeUndefined();
  });

  it('refuses a masked secret when none is saved', async () => {
    saved.values = {};
    const response = await save({ issuerUrl: 'https://auth.new.example/', clientSecret: MASK });

    expect(response.status).toBe(400);
    expect(setManyMock).not.toHaveBeenCalled();
  });

  it('rejects a non-text issuer', async () => {
    const response = await save({ issuerUrl: 42, clientSecret: 'x' });

    expect(response.status).toBe(400);
    expect(setManyMock).not.toHaveBeenCalled();
  });
});
