/**
 * Component: Request Body Reader Tests
 * Documentation: documentation/backend/validation.md
 */

import { describe, expect, it, vi } from 'vitest';
import {
  AUTH_JSON_BODY_LIMIT_BYTES,
  BULK_IMPORT_JSON_BODY_LIMIT_BYTES,
  JSON_BODY_LIMIT_BYTES,
  formatBodyLimit,
  readJsonBody,
} from '@/lib/utils/request-body';

const URL_ = 'http://localhost/api/test';
const encoder = new TextEncoder();

/**
 * A body stream that counts pulls and bytes handed out; highWaterMark 0 so nothing is read ahead.
 * An array of chunks ends after the last one; a function is called for every pull and never ends.
 */
function countingStream(chunks: Uint8Array[] | (() => Uint8Array)) {
  const stats = { pulls: 0, bytes: 0, cancels: 0 };
  let index = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        stats.pulls++;
        const next = typeof chunks === 'function' ? chunks() : chunks[index++];
        if (!next) {
          controller.close();
          return;
        }
        stats.bytes += next.byteLength;
        controller.enqueue(next);
      },
      cancel() {
        stats.cancels++;
      },
    },
    { highWaterMark: 0 }
  );
  return { stream, stats };
}

function streamRequest(stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request(URL_, { method: 'POST', body: stream, headers, duplex: 'half' } as RequestInit);
}

function textRequest(text: string | Uint8Array) {
  return new Request(URL_, { method: 'POST', body: text as BodyInit });
}

async function errorOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a rejection');
}

describe('readJsonBody', () => {
  it('uses the tier limits 64 KB / 1 MB / 32 MB', () => {
    expect([AUTH_JSON_BODY_LIMIT_BYTES, JSON_BODY_LIMIT_BYTES, BULK_IMPORT_JSON_BODY_LIMIT_BYTES]).toEqual([
      64 * 1024,
      1024 * 1024,
      32 * 1024 * 1024,
    ]);
    expect(formatBodyLimit(AUTH_JSON_BODY_LIMIT_BYTES)).toBe('64 KB');
    expect(formatBodyLimit(JSON_BODY_LIMIT_BYTES)).toBe('1 MB');
    expect(formatBodyLimit(BULK_IMPORT_JSON_BODY_LIMIT_BYTES)).toBe('32 MB');
  });

  it('parses a body within the limit like request.json()', async () => {
    const result = await readJsonBody(textRequest('{"a":[1,2],"b":"x"}'));
    expect(result).toEqual({ ok: true, data: { a: [1, 2], b: 'x' } });
  });

  it('returns 413 on a Content-Length over the limit without reading the body', async () => {
    const { stream, stats } = countingStream([encoder.encode('{}')]);
    const result = await readJsonBody(streamRequest(stream, { 'content-length': '1073741824' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
    expect(await result.response.json()).toEqual({
      error: 'PayloadTooLarge',
      message: 'Request body is larger than 1 MB',
    });
    expect(stats.pulls).toBe(0);
    expect(stats.cancels).toBe(0);
  });

  it('stops reading a body with no Content-Length once it passes the limit', async () => {
    const chunk = new Uint8Array(16 * 1024).fill(0x20);
    const { stream, stats } = countingStream(() => chunk);
    const result = await readJsonBody(streamRequest(stream), { maxBytes: 64 * 1024 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(413);
    expect(await result.response.json()).toMatchObject({ message: 'Request body is larger than 64 KB' });
    expect(stats.bytes).toBeLessThanOrEqual(64 * 1024 + chunk.byteLength);
    // Released, not cancelled: cancelling would close the connection before the 413 is sent
    expect(stats.cancels).toBe(0);
  });

  it('stops reading when the body is longer than its Content-Length says', async () => {
    const chunk = new Uint8Array(8 * 1024).fill(0x20);
    const { stream, stats } = countingStream(() => chunk);
    const result = await readJsonBody(streamRequest(stream, { 'content-length': '10' }), { maxBytes: 32 * 1024 });
    expect(result.ok).toBe(false);
    expect(stats.bytes).toBeLessThanOrEqual(32 * 1024 + chunk.byteLength);
    expect(stats.cancels).toBe(0);
  });

  it('accepts exactly the limit and rejects one byte more', async () => {
    const at = `"${'a'.repeat(100 - 2)}"`;
    expect(await readJsonBody(textRequest(at), { maxBytes: 100 })).toEqual({ ok: true, data: 'a'.repeat(98) });
    const over = await readJsonBody(textRequest(`${at} `), { maxBytes: 100 });
    expect(over.ok).toBe(false);
  });

  it('throws the same SyntaxError as request.json() for invalid and empty bodies', async () => {
    for (const text of ['{"a":', 'not json', '']) {
      const expected = await errorOf(textRequest(text).json());
      const actual = await errorOf(readJsonBody(textRequest(text)));
      expect(actual).toBeInstanceOf(SyntaxError);
      expect(actual.message).toBe(expected.message);
    }
    const noBody = await errorOf(readJsonBody(new Request(URL_, { method: 'POST' })));
    expect(noBody.message).toBe((await errorOf(new Request(URL_, { method: 'POST' }).json())).message);
  });

  it('decodes like request.json(): BOM, double BOM and a character split across chunks', async () => {
    const bom = '\uFEFF';
    for (const text of [`${bom}{"a":1}`, `${bom}${bom}"x"`]) {
      const expected = await textRequest(text).json().then((v) => ({ v }), (e: Error) => ({ e: e.message }));
      const actual = await readJsonBody(textRequest(text)).then((r) => ({ v: r.ok && r.data }), (e: Error) => ({ e: e.message }));
      expect(actual).toEqual(expected);
    }
    const bytes = encoder.encode('{"t":"café \u{1F4DA}"}');
    const split = [bytes.slice(0, 10), bytes.slice(10, 14), bytes.slice(14)];
    const { stream } = countingStream(split);
    expect(await readJsonBody(streamRequest(stream))).toEqual({ ok: true, data: { t: 'café \u{1F4DA}' } });
  });

  it('returns the fallback for invalid or empty JSON but still 413 when over the limit', async () => {
    expect(await readJsonBody(textRequest('nope'), { fallback: {} })).toEqual({ ok: true, data: {} });
    expect(await readJsonBody(new Request(URL_, { method: 'POST' }), { fallback: {} })).toEqual({ ok: true, data: {} });
    const over = await readJsonBody(textRequest('x'.repeat(200)), { maxBytes: 100, fallback: {} });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.response.status).toBe(413);
  });

  it('throws the same TypeError as request.json() for a body already read or locked, even with a fallback', async () => {
    const used = textRequest('{"a":1}');
    expect(await readJsonBody(used)).toEqual({ ok: true, data: { a: 1 } });
    const consumed = textRequest('{}');
    await consumed.text();
    const expected = await errorOf(consumed.json());
    for (const options of [{}, { fallback: {} }]) {
      const error = await errorOf(readJsonBody(used, options));
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe(expected.message);
    }

    const locked = textRequest('{"a":1}');
    const reader = locked.body!.getReader();
    const lockedExpected = await errorOf(locked.json());
    const lockedError = await errorOf(readJsonBody(locked, { fallback: {} }));
    expect(lockedError).toBeInstanceOf(TypeError);
    expect(lockedError.message).toBe(lockedExpected.message);
    reader.releaseLock();
  });

  it('never calls json() on a real Request; delegates to json() on a test double', async () => {
    const request = textRequest('{"a":1}');
    const spy = vi.spyOn(request, 'json');
    expect(await readJsonBody(request)).toEqual({ ok: true, data: { a: 1 } });
    expect(spy).not.toHaveBeenCalled();

    const double = { json: vi.fn().mockResolvedValue({ b: 2 }) } as unknown as Request;
    expect(await readJsonBody(double)).toEqual({ ok: true, data: { b: 2 } });
    const failing = { json: vi.fn().mockRejectedValue(new SyntaxError('bad')) } as unknown as Request;
    await expect(readJsonBody(failing)).rejects.toThrow('bad');
    expect(await readJsonBody(failing, { fallback: {} })).toEqual({ ok: true, data: {} });
  });
});
