/**
 * Component: Local Account Creation (shared by self-registration and admin-added users)
 * Documentation: documentation/backend/services/auth.md
 */

import bcrypt from 'bcrypt';
import type { User } from '@/generated/prisma';
import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import { getEncryptionService } from '@/lib/services/encryption.service';

export const USERNAME_TAKEN_ERROR = 'That username is already taken';

export type LocalCredentialsCheck =
  | { ok: true; username: string; password: string }
  | { ok: false; error: string };

/** The account a new local user gets (who decides it differs per caller). */
export interface LocalAccountState {
  role: 'user' | 'admin';
  isSetupAdmin: boolean;
  registrationStatus: 'approved' | 'pending_approval';
  /** Now for a sign-up (it signs in at once); null for an account nobody has signed in to yet */
  lastLoginAt: Date | null;
}

export type CreateLocalAccountResult =
  | { ok: true; user: User }
  | { ok: false; error: string };

/**
 * Username and password rules for every local account. The username is trimmed and
 * lowercased (sign-in looks it up the same way); the password is never changed.
 */
export function checkLocalCredentials(username: unknown, password: unknown): LocalCredentialsCheck {
  const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (normalizedUsername.length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters' };
  }
  if (typeof password !== 'string' || !password) {
    return { ok: false, error: 'Password is required' };
  }
  if (process.env.ALLOW_WEAK_PASSWORD !== 'true' && password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters' };
  }
  return { ok: true, username: normalizedUsername, password };
}

/** Prisma unique-constraint violation (P2002) */
function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/**
 * Creates a local account: checks the rules, refuses a username a non-deleted local
 * account holds, hashes and encrypts the password, writes the row (`plexId`
 * `local-<username>`). A unique-key clash on write (a concurrent sign-up, or a name
 * equal to a deleted account's freed key) answers as a taken username.
 */
export async function createLocalAccount(
  input: { username: unknown; password: unknown },
  state: LocalAccountState
): Promise<CreateLocalAccountResult> {
  const check = checkLocalCredentials(input.username, input.password);
  if (!check.ok) return check;
  const { username } = check;

  // Usernames of deleted accounts can be used again
  const existing = await prisma.user.findFirst({
    where: { plexUsername: username, authProvider: 'local', deletedAt: null },
  });
  if (existing) return { ok: false, error: USERNAME_TAKEN_ERROR };

  const passwordHash = await bcrypt.hash(check.password, 10);
  const encryptedHash = getEncryptionService().encrypt(passwordHash);

  try {
    const user = await prisma.user.create({
      data: {
        plexId: `local-${username}`,
        plexUsername: username,
        authToken: encryptedHash,
        authProvider: 'local',
        role: state.role,
        isSetupAdmin: state.isSetupAdmin,
        registrationStatus: state.registrationStatus,
        lastLoginAt: state.lastLoginAt,
      },
    });
    return { ok: true, user };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, error: USERNAME_TAKEN_ERROR };
    throw error;
  }
}

/**
 * Local (username/password) sign-in is offered: Audiobookshelf mode with
 * DISABLE_LOCAL_LOGIN not 'true'. /api/auth/providers puts the 'local' login form
 * behind this (and also hides the form while no local account exists and registration
 * is off; an admin adding one is what changes that).
 * @param backendMode the stored system.backend_mode, when the caller has already read it
 */
export async function isLocalLoginEnabled(backendMode?: string | null): Promise<boolean> {
  if (process.env.DISABLE_LOCAL_LOGIN === 'true') return false;
  const mode = backendMode === undefined ? await getConfigService().getBackendMode() : backendMode;
  return mode === 'audiobookshelf';
}
