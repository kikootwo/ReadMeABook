/**
 * Component: Discord User Resolver Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

describe('resolveRmabUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no user is linked to the Discord ID', async () => {
    const { resolveRmabUser } = await import('@/lib/services/discord/discord-user.resolver');
    prismaMock.user.findFirst.mockResolvedValue(null);
    const result = await resolveRmabUser('123');
    expect(result).toBeNull();
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { discordUserId: '123', deletedAt: null },
      select: expect.any(Object),
    });
  });

  it('marks role=admin users as admin', async () => {
    const { resolveRmabUser } = await import('@/lib/services/discord/discord-user.resolver');
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'u1',
      plexUsername: 'alice',
      role: 'admin',
      isSetupAdmin: false,
      discordUserId: '123',
    });
    const result = await resolveRmabUser('123');
    expect(result?.isAdmin).toBe(true);
    expect(result?.user.plexUsername).toBe('alice');
  });

  it('marks the setup admin as admin even with role=user', async () => {
    const { resolveRmabUser } = await import('@/lib/services/discord/discord-user.resolver');
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'u2',
      plexUsername: 'root',
      role: 'user',
      isSetupAdmin: true,
      discordUserId: '456',
    });
    const result = await resolveRmabUser('456');
    expect(result?.isAdmin).toBe(true);
  });

  it('marks regular users as non-admin', async () => {
    const { resolveRmabUser } = await import('@/lib/services/discord/discord-user.resolver');
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'u3',
      plexUsername: 'bob',
      role: 'user',
      isSetupAdmin: false,
      discordUserId: '789',
    });
    const result = await resolveRmabUser('789');
    expect(result?.isAdmin).toBe(false);
  });
});
