/**
 * Component: Admin Discord Settings API tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The config writes must be all-or-nothing: a partial save would leave the bot running on a mix of
 * old and new settings, and would skip the restart that applies them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const botServiceMock = vi.hoisted(() => ({ restart: vi.fn(() => Promise.resolve()) }));
const configServiceMock = vi.hoisted(() => ({ clearCache: vi.fn() }));
const encryptionMock = vi.hoisted(() => ({ encrypt: vi.fn((v: string) => `enc(${v})`) }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/discord/discord-bot.service', () => ({
  getDiscordBotService: () => botServiceMock,
}));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: any, handler: any) => handler(req),
  requireAdmin: (req: any, handler: any) => handler(req),
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

const body = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  guildId: 'g1',
  requestChannelId: 'c1',
  adminRoleId: 'r1',
  ...overrides,
});

const put = async (payload: Record<string, unknown>) => {
  const { PUT } = await import('@/app/api/admin/settings/discord/route');
  return PUT({ json: vi.fn().mockResolvedValue(payload) } as any);
};

describe('PUT /api/admin/settings/discord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockResolvedValue([]);
  });

  it('writes the whole config in a single transaction', async () => {
    const response = await put(body());

    expect(response.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // Every plain key goes through the transaction, not as loose sequential statements.
    expect(prismaMock.$transaction.mock.calls[0][0]).toHaveLength(8);
  });

  it('includes the encrypted bot token in the same transaction', async () => {
    await put(body({ botToken: 'secret-token' }));

    expect(encryptionMock.encrypt).toHaveBeenCalledWith('secret-token');
    expect(prismaMock.$transaction.mock.calls[0][0]).toHaveLength(9);
  });

  it('leaves a masked bot token untouched', async () => {
    await put(body({ botToken: '••••••••' }));

    expect(encryptionMock.encrypt).not.toHaveBeenCalled();
    expect(prismaMock.$transaction.mock.calls[0][0]).toHaveLength(8);
  });

  it('does not restart the bot when the transaction fails', async () => {
    prismaMock.$transaction.mockRejectedValue(new Error('db down'));

    const response = await put(body());

    expect(response.status).toBe(500);
    // A failed save must not leave the bot reloading a half-written config.
    expect(botServiceMock.restart).not.toHaveBeenCalled();
    expect(configServiceMock.clearCache).not.toHaveBeenCalled();
  });

  it('clears the config cache and restarts the bot after a successful save', async () => {
    await put(body());

    expect(configServiceMock.clearCache).toHaveBeenCalled();
    expect(botServiceMock.restart).toHaveBeenCalledTimes(1);
  });
});
