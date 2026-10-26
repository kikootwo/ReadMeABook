/**
 * Component: Admin Notifications API Route Tests (event list)
 * Documentation: documentation/backend/services/notifications.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
prismaMock.notificationBackend = {
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
} as any;

const notificationServiceMock = vi.hoisted(() => ({
  prepareSubmittedConfig: vi.fn((_type: string, config: any) => ({ ok: true, config })),
  maskConfig: vi.fn((_type: string, config: any) => config),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: any, handler: any) => handler(Object.assign(req, { user: { id: 'admin-1', role: 'admin' } })),
  requireAdmin: (_req: any, handler: any) => handler(),
}));

vi.mock('@/lib/services/notification', () => ({
  getNotificationService: () => notificationServiceMock,
  getRegisteredProviderTypes: () => ['discord'],
}));

const request = (body: unknown) => ({ json: vi.fn().mockResolvedValue(body) }) as any;
const saved = (data: any) => ({ id: '1', type: 'discord', name: 'n', config: {}, enabled: true, ...data });

describe('Admin notifications routes: event list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.notificationBackend.create.mockImplementation(async ({ data }: any) => saved(data));
    prismaMock.notificationBackend.update.mockImplementation(async ({ data }: any) => saved(data));
    prismaMock.notificationBackend.findUnique.mockResolvedValue(saved({ events: ['request_error'] }));
  });

  it('POST stores each event type once', async () => {
    const { POST } = await import('@/app/api/admin/notifications/route');

    const response = await POST(request({
      type: 'discord',
      name: 'Discord',
      config: { webhookUrl: 'https://discord.com/webhook' },
      events: ['request_available', 'request_error', 'request_available'],
    }));

    expect(response.status).toBe(201);
    expect(prismaMock.notificationBackend.create.mock.calls[0][0].data.events).toEqual(['request_available', 'request_error']);
  });

  it('PUT stores each event type once', async () => {
    const { PUT } = await import('@/app/api/admin/notifications/[id]/route');

    const response = await PUT(request({ events: ['request_error', 'request_error'] }), {
      params: Promise.resolve({ id: '1' }),
    });

    expect(response.status).toBe(200);
    expect(prismaMock.notificationBackend.update.mock.calls[0][0].data.events).toEqual(['request_error']);
  });
});
