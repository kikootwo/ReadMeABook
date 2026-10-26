/**
 * Component: API Validation Bounds Tests (bounded request lists, validation error logging)
 * Documentation: documentation/backend/validation.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { NOTIFICATION_EVENT_KEYS } from '@/lib/constants/notification-events';

const LARGE = 100_000;

const prismaMock = createPrismaMock();
prismaMock.notificationBackend = {
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
} as any;

// Plain functions and holders: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({
  body: undefined as unknown,
  logged: [] as Array<{ message: string; meta?: Record<string, unknown> }>,
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) =>
    handler({ user: { id: 'user-1', sub: 'user-1', role: 'admin' }, json: async () => state.body }),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));

vi.mock('@/lib/services/notification', () => ({
  getNotificationService: () => ({}),
  getRegisteredProviderTypes: () => ['discord'],
}));

vi.mock('@/lib/utils/logger', () => {
  const record = (message: string, meta?: Record<string, unknown>) => {
    state.logged.push({ message, meta });
  };
  return {
    RMABLogger: { create: () => ({ info: record, error: record, warn: record, debug: record }) },
  };
});

const jsonRequest = () => ({ json: async () => state.body }) as any;
const params = { params: Promise.resolve({ id: 'backend-1' }) };

async function expectSingleLengthIssue(call: () => Promise<Response>, maximum: number) {
  const started = performance.now();
  const response = await call();
  const elapsed = performance.now() - started;
  const payload = await response.json();
  expect(response.status).toBe(400);
  expect(payload.error).toBe('ValidationError');
  expect(payload.details).toHaveLength(1);
  expect(payload.details[0]).toMatchObject({ code: 'too_big', type: 'array', maximum });
  expect(elapsed).toBeLessThan(2000);
}

beforeEach(() => {
  state.body = undefined;
  state.logged.length = 0;
});

describe('PUT /api/user/home-sections list bounds', () => {
  const put = async () => (await import('@/app/api/user/home-sections/route')).PUT(jsonRequest());

  it('returns one length issue for 11 invalid sections', async () => {
    state.body = { sections: new Array(11).fill(1) };
    await expectSingleLengthIssue(put, 10);
  });

  it('returns one length issue for a very large invalid list', async () => {
    state.body = { sections: new Array(LARGE).fill(1) };
    await expectSingleLengthIssue(put, 10);
  });

  it('keeps element issue paths for an in-bounds invalid list', async () => {
    state.body = { sections: [{ sectionType: 'popular', sortOrder: 0 }, { sectionType: 'bogus', sortOrder: -1 }] };
    const response = await put();
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.details.map((d: { path: unknown[] }) => d.path)).toEqual([
      ['sections', 1, 'sectionType'],
      ['sections', 1, 'sortOrder'],
    ]);
  });

  it('logs the issue count and paths, not the full validation message', async () => {
    state.body = { sections: [{ sectionType: 'bogus', sortOrder: 0 }] };
    await put();
    const entry = state.logged.find((l) => l.message === 'Failed to save home sections');
    expect(entry?.meta?.error).toBe('Validation failed: 1 issue(s) at sections.0.sectionType');
  });
});

describe('notification backend event list bounds', () => {
  const max = NOTIFICATION_EVENT_KEYS.length;
  const post = async () => (await import('@/app/api/admin/notifications/route')).POST(jsonRequest());
  const put = async () =>
    (await import('@/app/api/admin/notifications/[id]/route')).PUT(jsonRequest(), params);
  const backend = (events: unknown[]) => ({ type: 'discord', name: 'Discord', config: {}, events });

  it('POST returns one length issue for one more invalid event than there are event types', async () => {
    state.body = backend(new Array(max + 1).fill('bogus'));
    await expectSingleLengthIssue(post, max);
  });

  it('POST returns one length issue for a very large invalid event list', async () => {
    state.body = backend(new Array(LARGE).fill('bogus'));
    await expectSingleLengthIssue(post, max);
  });

  it('PUT returns one length issue for one more invalid event than there are event types', async () => {
    state.body = { events: new Array(max + 1).fill('bogus') };
    await expectSingleLengthIssue(put, max);
  });

  it('PUT returns one length issue for a very large invalid event list', async () => {
    state.body = { events: new Array(LARGE).fill('bogus') };
    await expectSingleLengthIssue(put, max);
  });

  it('PUT still rejects an empty event list', async () => {
    state.body = { events: [] };
    const response = await put();
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.details).toHaveLength(1);
    expect(payload.details[0]).toMatchObject({ code: 'too_small', path: ['events'] });
  });

  it('PUT accepts every event type once', async () => {
    state.body = { events: [...NOTIFICATION_EVENT_KEYS] };
    prismaMock.notificationBackend.findUnique.mockResolvedValue(null);
    const response = await put();
    expect(response.status).toBe(404);
  });
});
