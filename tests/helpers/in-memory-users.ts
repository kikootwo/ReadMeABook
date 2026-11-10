/**
 * Component: In-memory Users Table (test helper)
 * Documentation: documentation/backend/services/auth.md
 *
 * A small stand-in for the Prisma `user` and `apiToken` models, for tests that run
 * several real routes in a row (delete an account, then sign in or use a credential)
 * and check which row each one read or wrote. Applies the schema defaults and the
 * unique `plexId` constraint. Plain functions (not vi.fn) so a test's mock resets
 * never clear them.
 */

import { randomUUID } from 'crypto';

type Fields = Record<string, unknown>;
export type UserRow = Fields & { id: string; plexId: string; plexUsername: string; role: string };
type Row = UserRow;

const users = new Map<string, Row>(); // keyed by id
const apiTokens: Fields[] = [];
const requestOwners: { id: string; userId: string }[] = [];

/** Prisma column defaults for `User` (prisma/schema.prisma). */
const USER_DEFAULTS = {
  role: 'user',
  isSetupAdmin: false,
  authProvider: null,
  oidcSubject: null,
  plexHomeUserId: null,
  registrationStatus: 'approved',
  loginTokenHash: null,
  sessionsInvalidatedAt: null,
  autoApproveRequests: null,
  downloadAccess: null,
  deletedAt: null,
  deletedBy: null,
};

function matches(row: Fields, where: Fields = {}): boolean {
  return Object.entries(where).every(([key, value]) =>
    value === null ? row[key] === null || row[key] === undefined : row[key] === value
  );
}

function assertPlexIdFree(plexId: string, exceptId?: string) {
  for (const row of users.values()) {
    if (row.plexId === plexId && row.id !== exceptId) {
      throw new Error('Unique constraint failed on the fields: (`plex_id`)');
    }
  }
}

function withCounts(row: Row): Row & { _count: { requests: number } } {
  return { ...row, _count: { requests: requestOwners.filter((r) => r.userId === row.id).length } };
}

function create(data: Fields): Row {
  assertPlexIdFree(data.plexId as string);
  const row = { id: randomUUID(), createdAt: new Date(), ...USER_DEFAULTS, ...data } as Row;
  users.set(row.id, row);
  return { ...row };
}

function updateRow(row: Row, data: Fields): Row {
  if (data.plexId !== undefined) assertPlexIdFree(data.plexId as string, row.id);
  const updated = { ...row, ...data } as Row;
  users.set(row.id, updated);
  return { ...updated };
}

function findFirst(where: Fields): Row | undefined {
  return [...users.values()].find((row) => matches(row, where));
}

export const usersDb = {
  prisma: {
    user: {
      count: async () => users.size,
      findUnique: async ({ where }: { where: Fields }) => {
        const row = findFirst(where);
        return row ? withCounts(row) : null;
      },
      findFirst: async ({ where }: { where: Fields }) => {
        const row = findFirst(where);
        return row ? withCounts(row) : null;
      },
      create: async ({ data }: { data: Fields }) => create(data),
      upsert: async ({ where, create: createData, update }: { where: Fields; create: Fields; update: Fields }) => {
        const row = findFirst(where);
        return row ? updateRow(row, update) : create(createData);
      },
      update: async ({ where, data }: { where: Fields; data: Fields }) => {
        const row = findFirst(where);
        if (!row) throw new Error('Record to update not found');
        return updateRow(row, data);
      },
      updateMany: async ({ where, data }: { where: Fields; data: Fields }) => {
        const rows = [...users.values()].filter((row) => matches(row, where));
        for (const row of rows) updateRow(row, data);
        return { count: rows.length };
      },
    },
    apiToken: {
      findUnique: async ({ where }: { where: Fields }) => {
        const token = apiTokens.find((t) => matches(t, where));
        if (!token) return null;
        const owner = users.get(token.userId as string);
        return { ...token, tokenUser: owner ? { ...owner } : null };
      },
      update: async () => ({}),
    },
    // No request rows: a route that gets past its account checks answers 404
    request: {
      findFirst: async () => null,
    },
  },

  reset() {
    users.clear();
    apiTokens.length = 0;
    requestOwners.length = 0;
  },
  /** Inserts a row with the schema defaults and returns it. */
  addUser(data: Fields): Row {
    return create(data);
  },
  addApiToken(data: Fields) {
    apiTokens.push({ id: randomUUID(), expiresAt: null, role: 'user', ...data });
  },
  addRequest(userId: string) {
    requestOwners.push({ id: randomUUID(), userId });
  },
  getUser(id: string): Row | undefined {
    const row = users.get(id);
    return row ? { ...row } : undefined;
  },
  findUser(where: Fields): Row | undefined {
    const row = findFirst(where);
    return row ? { ...row } : undefined;
  },
  allUsers(): Row[] {
    return [...users.values()].map((row) => ({ ...row }));
  },
  requestOwnerIds(): string[] {
    return requestOwners.map((r) => r.userId);
  },
};
