/**
 * Component: In-memory prisma.user.count over fixture rows
 * Documentation: documentation/testing.md
 */

type UserRow = Record<string, unknown>;
type Condition = unknown;

const matches = (value: unknown, condition: Condition): boolean => {
  if (condition === null || typeof condition !== 'object' || condition instanceof Date) {
    return value === condition || (condition === null && value === undefined);
  }
  const ops = condition as Record<string, unknown>;
  return Object.entries(ops).every(([op, operand]) => {
    switch (op) {
      case 'startsWith':
        return typeof value === 'string' && value.startsWith(String(operand));
      case 'not':
        return !matches(value, operand);
      default:
        throw new Error(`countUsersIn: unsupported operator "${op}"`);
    }
  });
};

/**
 * Returns a prisma.user.count implementation that applies the query's `where`
 * to the given rows, so a missing filter shows up as a wrong count.
 */
export const countUsersIn = (rows: UserRow[]) =>
  async (args?: { where?: Record<string, Condition> }): Promise<number> => {
    const where = args?.where ?? {};
    return rows.filter((row) =>
      Object.entries(where).every(([field, condition]) => matches(row[field], condition))
    ).length;
  };
