/**
 * Component: Setup Guard Fail-closed Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  configuration: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const request = () => ({ nextUrl: { pathname: '/api/setup/test-abs' }, headers: new Headers() }) as any;

describe('setup guards fail closed when the setup state cannot be read', () => {
  beforeEach(() => {
    prismaMock.configuration.findUnique.mockRejectedValue(new Error('connection refused'));
  });

  it.each(['requireSetupIncompleteOrAdmin', 'requireSetupIncomplete'] as const)(
    '%s returns 503 and does not run the handler',
    async (guard) => {
      const auth = await import('@/lib/middleware/auth');
      const handler = vi.fn();

      const response = await auth[guard](request(), handler);

      expect(response.status).toBe(503);
      expect(handler).not.toHaveBeenCalled();
      expect(JSON.stringify(await response.json())).not.toContain('connection refused');
    }
  );

  it('still lets the setup wizard through while setup is incomplete', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    const auth = await import('@/lib/middleware/auth');
    const handler = vi.fn(async () => new Response(null, { status: 204 }) as any);

    const response = await auth.requireSetupIncompleteOrAdmin(request(), handler);

    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(204);
  });
});
