/**
 * Component: Password-Login Users for the Credential Recovery Script
 * Documentation: documentation/admin-features/credential-recovery.md
 *
 * A user can log in with a password when their row was created with one: plexId
 * `local-<username>` and authToken holding the encrypted bcrypt hash. That covers
 * - local users (authProvider 'local': setup admin in Audiobookshelf mode, registered users)
 * - the Plex-mode setup admin (authProvider 'plex', logs in through /api/auth/admin/login)
 * Plex and OIDC users never have a password (their authToken is a provider token); an OIDC
 * subject that happens to start with "local-" is excluded by provider.
 */

'use strict';

const LOCAL_ID_PREFIX = 'local-';
const PASSWORD_PROVIDERS = ['local', 'plex'];

/** Prisma filter; authProvider null is a legacy row and kept (the admin login ignores it). */
const PASSWORD_LOGIN_WHERE = {
  deletedAt: null,
  plexId: { startsWith: LOCAL_ID_PREFIX },
  OR: [{ authProvider: { in: PASSWORD_PROVIDERS } }, { authProvider: null }],
};

function isPasswordLoginUser(user) {
  return (
    Boolean(user) &&
    !user.deletedAt &&
    typeof user.plexId === 'string' &&
    user.plexId.startsWith(LOCAL_ID_PREFIX) &&
    (user.authProvider === null || user.authProvider === undefined || PASSWORD_PROVIDERS.includes(user.authProvider))
  );
}

/** Users who can log in with a password, setup admin first, then by username. */
async function listPasswordUsers(prisma) {
  const users = await prisma.user.findMany({
    where: PASSWORD_LOGIN_WHERE,
    select: {
      id: true,
      plexId: true,
      plexUsername: true,
      role: true,
      isSetupAdmin: true,
      authProvider: true,
      deletedAt: true,
    },
    orderBy: [{ isSetupAdmin: 'desc' }, { plexUsername: 'asc' }],
  });
  // Checked again in JS so the rule holds whatever the query layer does with NULLs
  return users.filter(isPasswordLoginUser);
}

/** One list line: "name   [role, setup-admin, Plex-mode admin]". */
function describePasswordUser(user) {
  const tags = [user.role];
  if (user.isSetupAdmin) tags.push('setup-admin');
  if (user.authProvider === 'plex') tags.push('Plex-mode admin');
  return `${user.plexUsername}   [${tags.join(', ')}]`;
}

/** The listed user whose username matches what was typed (trimmed, case-insensitive). */
function findPasswordUser(users, typed) {
  const name = String(typed || '').trim().toLowerCase();
  if (!name) return null;
  return users.find((u) => String(u.plexUsername || '').toLowerCase() === name) || null;
}

module.exports = {
  PASSWORD_LOGIN_WHERE,
  isPasswordLoginUser,
  listPasswordUsers,
  describePasswordUser,
  findPasswordUser,
};
