/**
 * Component: Discord Actor Resolver Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

const LINKED_ID = '123456789012345678';

const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  plexUsername: 'reader',
  role: 'user',
  isSetupAdmin: false,
  registrationStatus: 'approved',
  deletedAt: null,
  ...overrides,
});

async function resolve(discordUserId: string) {
  const { resolveDiscordActor } = await import('@/lib/services/discord/discord-actor');
  return resolveDiscordActor(discordUserId);
}

describe('resolveDiscordActor', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.findFirst.mockResolvedValue(null);
  });

  it('returns a non-admin actor for a linked, approved user (isAdmin only, no role)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow());

    expect(await resolve(LINKED_ID)).toEqual({ userId: 'user-1', username: 'reader', isAdmin: false });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { discordUserId: LINKED_ID } })
    );
  });

  it('selects every field the refusal reads, so the refusal cannot pass on a field left out of the select', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow());

    await resolve(LINKED_ID);

    expect(prismaMock.user.findUnique.mock.calls[0][0].select).toMatchObject({
      role: true,
      registrationStatus: true,
      deletedAt: true,
    });
  });

  it('returns an admin actor when the account role is admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow({ role: 'admin' }));

    expect(await resolve(LINKED_ID)).toEqual({ userId: 'user-1', username: 'reader', isAdmin: true });
  });

  it.each([['pending_approval'], ['rejected']])('refuses a %s account', async (status) => {
    prismaMock.user.findUnique.mockResolvedValue(userRow({ registrationStatus: status }));

    expect(await resolve(LINKED_ID)).toBeNull();
  });

  it('allows an older row with no registration status', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow({ registrationStatus: null }));

    expect(await resolve(LINKED_ID)).toMatchObject({ userId: 'user-1', isAdmin: false });
  });

  it('refuses a soft-deleted account', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow({ deletedAt: new Date('2026-11-01T00:00:00Z') }));

    expect(await resolve(LINKED_ID)).toBeNull();
  });

  it('returns null for an ID no account is linked to', async () => {
    expect(await resolve(LINKED_ID)).toBeNull();
  });

  it('accepts 15 to 20 digits with no leading zero', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow());

    for (const value of ['1'.repeat(15), '9'.repeat(20), LINKED_ID]) {
      expect(await resolve(value)).toMatchObject({ userId: 'user-1' });
    }
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(3);
  });

  it('does not query for a value that is not a Discord user ID', async () => {
    for (const value of ['', 'abc', '12345', '1'.repeat(14), '1'.repeat(21), `0${LINKED_ID}`, `${LINKED_ID} `, '1'.repeat(26)]) {
      expect(await resolve(value)).toBeNull();
    }
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('takes admin from the role only: the setup admin flag on a user-role account is not admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow({ role: 'user', isSetupAdmin: true }));

    expect(await resolve(LINKED_ID)).toEqual({ userId: 'user-1', username: 'reader', isAdmin: false });
  });

  it('reads the role on every call, so a role change applies to the next call', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(userRow({ role: 'admin' }))
      .mockResolvedValueOnce(userRow({ role: 'user' }));

    expect(await resolve(LINKED_ID)).toMatchObject({ isAdmin: true });
    expect(await resolve(LINKED_ID)).toMatchObject({ isAdmin: false });
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
