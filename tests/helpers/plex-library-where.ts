/**
 * Component: Test helper - plex_library rows filtered by a Prisma `where` the way Postgres does
 * Documentation: documentation/features/bulk-import.md
 *
 * `in`, `equals` and `contains` compare case-sensitively unless `mode: 'insensitive'`, so a mock
 * built on this returns a row in another case only when the query asks for that.
 */

type Row = { asin?: string | null; plexGuid?: string | null };
type StringFilter = { in?: string[]; equals?: string; contains?: string; mode?: 'insensitive' | 'default' };
type Where = { OR?: Where[]; asin?: StringFilter; plexGuid?: StringFilter };

function matchesFilter(value: string | null | undefined, filter: StringFilter): boolean {
  if (value == null) return false;
  const fold = filter.mode === 'insensitive' ? (s: string) => s.toLowerCase() : (s: string) => s;
  const v = fold(value);
  if (filter.in && !filter.in.map(fold).includes(v)) return false;
  if (filter.equals !== undefined && fold(filter.equals) !== v) return false;
  if (filter.contains !== undefined && !v.includes(fold(filter.contains))) return false;
  return true;
}

function matchesWhere(row: Row, where: Where): boolean {
  if (where.OR && !where.OR.some((w) => matchesWhere(row, w))) return false;
  if (where.asin && !matchesFilter(row.asin, where.asin)) return false;
  if (where.plexGuid && !matchesFilter(row.plexGuid, where.plexGuid)) return false;
  return true;
}

/** The rows a `plexLibrary.findMany({ where })` would return. */
export function plexLibraryWhere<T extends Row>(rows: T[], where: Where): T[] {
  return rows.filter((row) => matchesWhere(row, where));
}
