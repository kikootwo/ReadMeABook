/**
 * Component: Password-Login Users for the Credential Recovery Script
 * Documentation: documentation/admin-features/credential-recovery.md
 *
 * A user can log in with a password when their row was created with one: plexId exactly
 * `local-<plexUsername>` (what /api/auth/admin/login looks up) and authToken holding the
 * encrypted bcrypt hash. That covers
 * - local users (authProvider 'local': setup admin in Audiobookshelf mode, registered users)
 * - the Plex-mode setup admin (authProvider 'plex', logs in through /api/auth/admin/login)
 * Plex users (authProvider null, plexId a Plex account id or Home uuid) and OIDC users never
 * have a password: their authToken is a provider token. Rows with any other provider, or
 * whose plexId is not exactly local-<plexUsername>, are never offered.
 */

'use strict';

const LOCAL_ID_PREFIX = 'local-';
const PASSWORD_PROVIDERS = ['local', 'plex'];

/** Prisma filter; the exact local-<plexUsername> match is checked in isPasswordLoginUser. */
const PASSWORD_LOGIN_WHERE = {
  deletedAt: null,
  plexId: { startsWith: LOCAL_ID_PREFIX },
  authProvider: { in: PASSWORD_PROVIDERS },
};

function isPasswordLoginUser(user) {
  return (
    Boolean(user) &&
    !user.deletedAt &&
    PASSWORD_PROVIDERS.includes(user.authProvider) &&
    typeof user.plexId === 'string' &&
    typeof user.plexUsername === 'string' &&
    user.plexUsername.length > 0 &&
    user.plexId.toLowerCase() === `${LOCAL_ID_PREFIX}${user.plexUsername}`.toLowerCase()
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
  // The exact plexId = local-<plexUsername> rule can't be expressed in the query
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
