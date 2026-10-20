/**
 * Component: Credential Recovery User Selection Tests
 * Documentation: documentation/admin-features/credential-recovery.md
 *
 * The recovery script offers every user who logs in with a password (local users and
 * the Plex-mode setup admin, which is stored with authProvider 'plex'), and never a
 * Plex or OIDC user who has no password.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PASSWORD_LOGIN_WHERE,
  isPasswordLoginUser,
  listPasswordUsers,
  describePasswordUser,
  findPasswordUser,
} = require('../../scripts/lib/password-users.js');

// Rows as setup/complete, LocalAuthProvider, the Plex callback and OIDC create them
const plexModeAdmin = { id: 'u1', plexId: 'local-admin', plexUsername: 'admin', role: 'admin', isSetupAdmin: true, authProvider: 'plex', deletedAt: null };
const absModeAdmin = { id: 'u2', plexId: 'local-root', plexUsername: 'root', role: 'admin', isSetupAdmin: true, authProvider: 'local', deletedAt: null };
const registered = { id: 'u3', plexId: 'local-bob', plexUsername: 'bob', role: 'user', isSetupAdmin: false, authProvider: 'local', deletedAt: null };
const legacyNullProvider = { id: 'u4', plexId: 'local-old', plexUsername: 'old', role: 'user', isSetupAdmin: false, authProvider: null, deletedAt: null };
const plexUser = { id: 'p1', plexId: '12345678', plexUsername: 'admin', role: 'user', isSetupAdmin: false, authProvider: 'plex', deletedAt: null };
const oidcUser = { id: 'o1', plexId: 'a7f3-subject', plexUsername: 'carol', role: 'user', isSetupAdmin: false, authProvider: 'oidc', deletedAt: null };
const oidcLocalLookingSubject = { id: 'o2', plexId: 'local-dave', plexUsername: 'dave', role: 'user', isSetupAdmin: false, authProvider: 'oidc', deletedAt: null };
const softDeleted = { id: 'd1', plexId: 'local-eve-deleted-1700000000000', plexUsername: 'eve', role: 'user', isSetupAdmin: false, authProvider: 'local', deletedAt: new Date() };

describe('isPasswordLoginUser', () => {
  it.each([
    ['the Plex-mode setup admin (authProvider plex, plexId local-*)', plexModeAdmin],
    ['the Audiobookshelf-mode setup admin', absModeAdmin],
    ['a registered local user', registered],
    ['a legacy local row with no authProvider', legacyNullProvider],
  ])('offers %s', (_label, user) => {
    expect(isPasswordLoginUser(user)).toBe(true);
  });

  it.each([
    ['a Plex user (no password, even with the same username as the admin)', plexUser],
    ['an OIDC user', oidcUser],
    ['an OIDC user whose subject starts with "local-"', oidcLocalLookingSubject],
    ['a soft-deleted local user', softDeleted],
  ])('does not offer %s', (_label, user) => {
    expect(isPasswordLoginUser(user)).toBe(false);
  });
});

describe('listPasswordUsers', () => {
  it('queries undeleted local-* rows of the password providers, and filters again in JS', async () => {
    const findMany = vi.fn().mockResolvedValue([plexModeAdmin, registered, plexUser, oidcLocalLookingSubject, softDeleted]);

    const users = await listPasswordUsers({ user: { findMany } });

    expect(users.map((u: { id: string }) => u.id)).toEqual(['u1', 'u3']);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      deletedAt: null,
      plexId: { startsWith: 'local-' },
      OR: [{ authProvider: { in: ['local', 'plex'] } }, { authProvider: null }],
    });
    expect(args.where).toBe(PASSWORD_LOGIN_WHERE);
    expect(args.orderBy).toEqual([{ isSetupAdmin: 'desc' }, { plexUsername: 'asc' }]);
  });

  it('returns the Plex-mode admin when it is the only password user (was "No local users exist")', async () => {
    const findMany = vi.fn().mockResolvedValue([plexModeAdmin]);

    expect(await listPasswordUsers({ user: { findMany } })).toEqual([plexModeAdmin]);
  });
});

describe('findPasswordUser / describePasswordUser', () => {
  const listed = [plexModeAdmin, registered];

  it('matches the typed username trimmed and case-insensitively', () => {
    expect(findPasswordUser(listed, '  ADMIN ')).toBe(plexModeAdmin);
    expect(findPasswordUser(listed, 'bob')).toBe(registered);
  });

  it('never resolves to an unlisted user, such as a Plex user with the same name', () => {
    expect(findPasswordUser([registered], 'admin')).toBeNull();
    expect(findPasswordUser(listed, '')).toBeNull();
  });

  it('labels the Plex-mode admin', () => {
    expect(describePasswordUser(plexModeAdmin)).toBe('admin   [admin, setup-admin, Plex-mode admin]');
    expect(describePasswordUser(registered)).toBe('bob   [user]');
  });
});

describe('the login rules this selection mirrors', () => {
  const src = (file: string) => readFileSync(path.join(__dirname, '../..', file), 'utf8');

  it('the admin login finds the user by plexId local-<username>, whatever its authProvider', () => {
    const route = src('src/app/api/auth/admin/login/route.ts');

    expect(route).toContain('where: { plexId: `local-${normalizedUsername}` }');
    expect(route).not.toContain('authProvider');
  });

  it('setup stores the admin as local-<username>, with authProvider plex in Plex mode', () => {
    const setup = src('src/app/api/setup/complete/route.ts');

    expect(setup).toContain('plexId: `local-${normalizedAdminUsername}`');
    expect(setup).toContain("authProvider: backendMode === 'plex' ? 'plex' : 'local'");
  });
});

describe('recover-credentials.js', () => {
  it('selects users through listPasswordUsers, not an authProvider=local query', () => {
    const source = readFileSync(path.join(__dirname, '../../scripts/recover-credentials.js'), 'utf8');

    expect(source).toContain("require('./lib/password-users')");
    expect(source).toContain('await listPasswordUsers(prisma)');
    expect(source).not.toMatch(/authProvider:\s*'local'/);
  });
});
