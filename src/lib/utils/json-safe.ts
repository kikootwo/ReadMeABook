/**
 * Component: JSON-safe Serializer (BigInt columns in API responses)
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * `JSON.stringify` (and so `NextResponse.json`) throws on BigInt. Prisma returns
 * BigInt for `DownloadHistory.torrentSizeBytes`, `Audiobook.fileSizeBytes` and
 * `PlexLibrary.duration`, so a route that returns those rows must pass them
 * through here first.
 */

/** `T` with every bigint replaced by number, at any depth. */
export type JsonSafe<T> = T extends bigint
  ? number
  : T extends Date
    ? T
    : T extends readonly (infer U)[]
      ? JsonSafe<U>[]
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K]> }
        : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Copy `value` with BigInt turned into number. Byte sizes and millisecond
 * durations stay far below Number.MAX_SAFE_INTEGER. Arrays and plain objects
 * are walked; Dates, Prisma Decimals and other class instances pass through
 * untouched so their own `toJSON` still applies.
 */
export function toJsonSafe<T>(value: T): JsonSafe<T> {
  return convert(value) as JsonSafe<T>;
}

function convert(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(convert);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = convert(item);
    return out;
  }
  return value;
}
