/**
 * Component: Request Body Reader (size limits)
 * Documentation: documentation/backend/validation.md
 *
 * readJsonBody: reads an API route's JSON body under a size limit.
 * - Content-Length over the limit: 413 before any byte is read
 * - No or smaller Content-Length: the byte count is checked while reading; reading stops at the limit
 * - Within the limit: parsed exactly like `request.json()` (same result, same SyntaxError)
 */

import { NextResponse } from 'next/server';
import { RMABLogger } from './logger';

const logger = RMABLogger.create('RequestBody');

const KIB = 1024;
const MIB = 1024 * KIB;

/** Default limit for API route JSON bodies. */
export const JSON_BODY_LIMIT_BYTES = 1 * MIB;

/** Limit for the sign-in, registration and token-refresh routes. */
export const AUTH_JSON_BODY_LIMIT_BYTES = 64 * KIB;

/** Limit for the admin bulk import (one entry per scanned book). */
export const BULK_IMPORT_JSON_BODY_LIMIT_BYTES = 32 * MIB;

export type JsonBodyResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

export interface ReadJsonBodyOptions<T> {
  /** Max body size in bytes (default JSON_BODY_LIMIT_BYTES). */
  maxBytes?: number;
  /** Returned when the body is missing or not valid JSON (instead of throwing). Over-limit bodies still get a 413. */
  fallback?: NoInfer<T>;
}

/** A limit as shown to the client, e.g. "64 KB" or "1 MB". */
export function formatBodyLimit(bytes: number): string {
  if (bytes >= MIB && bytes % MIB === 0) return `${bytes / MIB} MB`;
  return `${Math.round(bytes / KIB)} KB`;
}

function tooLarge(request: Request, maxBytes: number, declaredBytes?: number): JsonBodyResult<never> {
  let path = '(unknown)';
  try {
    path = new URL(request.url).pathname;
  } catch {
    // Keep the placeholder path
  }
  logger.warn('Request body over size limit', { path, limitBytes: maxBytes, ...(declaredBytes !== undefined && { declaredBytes }) });
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'PayloadTooLarge', message: `Request body is larger than ${formatBodyLimit(maxBytes)}` },
      { status: 413 }
    ),
  };
}

/**
 * Reads the body chunk by chunk. Returns null once more than maxBytes have arrived;
 * the rest of the body is left unread (the reader is released, not cancelled, so the
 * 413 response still reaches the client).
 */
async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function declaredLength(request: Request): number | undefined {
  const header = request.headers?.get?.('content-length');
  if (header === null || header === undefined || header.trim() === '') return undefined;
  const value = Number(header);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Reads a JSON request body under a size limit.
 * Call pattern: `const bodyResult = await readJsonBody(request); if (!bodyResult.ok) return bodyResult.response;`
 * Invalid or empty JSON throws the same SyntaxError as `request.json()` unless `fallback` is set.
 * A body that was already read (or is locked by a reader) throws the same TypeError as
 * `request.json()`, with or without `fallback`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same contract as Request.json()
export async function readJsonBody<T = any>(
  request: Request,
  options: ReadJsonBodyOptions<T> = {}
): Promise<JsonBodyResult<T>> {
  const maxBytes = options.maxBytes ?? JSON_BODY_LIMIT_BYTES;
  const hasFallback = 'fallback' in options;

  const parse = async (read: () => Promise<T>): Promise<JsonBodyResult<T>> => {
    if (!hasFallback) return { ok: true, data: await read() };
    try {
      return { ok: true, data: await read() };
    } catch {
      return { ok: true, data: options.fallback as T };
    }
  };

  // A real Request's body is always a stream or null; undefined only on test doubles,
  // which provide json() directly.
  const body = (request as { body?: ReadableStream<Uint8Array> | null }).body;
  if (body === undefined && typeof request.json === 'function') {
    return parse(() => request.json());
  }

  if (body && (request.bodyUsed || body.locked)) {
    // request.json() rejects an unusable body with its own TypeError; rethrow exactly that
    throw await request.json().then(
      () => new TypeError('Body is unusable: Body has already been read'),
      (error: unknown) => error
    );
  }

  const declared = declaredLength(request);
  if (declared !== undefined && declared > maxBytes) return tooLarge(request, maxBytes, declared);

  let bytes: Uint8Array;
  try {
    const read = body ? await readCapped(body, maxBytes) : new Uint8Array(0);
    if (read === null) return tooLarge(request, maxBytes, declared);
    bytes = read;
  } catch (error) {
    if (hasFallback) return { ok: true, data: options.fallback as T };
    throw error;
  }

  // Response.json() decodes and parses exactly like Request.json()
  return parse(() => new Response(bytes as BodyInit).json() as Promise<T>);
}
