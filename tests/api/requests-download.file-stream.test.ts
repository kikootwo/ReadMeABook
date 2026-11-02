/**
 * Component: Request File Download Route Tests (single file: slow reader, cancel, read error)
 * Documentation: documentation/backend/services/auth.md
 *
 * Runs the real route. The slow-reader test counts the chunks a synchronous source makes; the
 * other tests use a real temp file and count file handles and bytes read by wrapping fs.open,
 * fs.read and fs.close, which every fs.ReadStream calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const { logged } = vi.hoisted(() => ({
  logged: [] as Array<{ level: string; message: string; metadata?: Record<string, unknown> }>,
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/utils/logger', () => {
  const make = () => ({
    debug: () => {},
    info: () => {},
    warn: (message: string, metadata?: Record<string, unknown>) => logged.push({ level: 'warn', message, metadata }),
    error: (message: string, metadata?: Record<string, unknown>) => logged.push({ level: 'error', message, metadata }),
  });
  return { RMABLogger: { create: make, forJob: make } };
});

type Callback = (...args: unknown[]) => void;
type FsFn = (...args: unknown[]) => unknown;
const mutableFs = fs as unknown as Record<'open' | 'read' | 'close', FsFn>;
const realFs = { open: mutableFs.open, read: mutableFs.read, close: mutableFs.close };
const realCreateReadStream = fs.createReadStream;

const KB = 1024;
const MB = 1024 * KB;
const openFds = new Set<number>();
let bytesRead = 0;
let failReads = false;

/** Tracks every file the route opens under `dir`; with `failReads`, its reads fail with EIO */
function instrumentFs(dir: string) {
  mutableFs.open = function (this: unknown, file: unknown, ...rest: unknown[]) {
    const cb = rest[rest.length - 1];
    if (typeof file === 'string' && path.resolve(file).startsWith(dir) && typeof cb === 'function') {
      rest[rest.length - 1] = (err: unknown, fd: number) => {
        if (!err) openFds.add(fd);
        (cb as Callback)(err, fd);
      };
    }
    return realFs.open.call(fs, file, ...rest);
  };
  mutableFs.read = function (this: unknown, fd: unknown, ...rest: unknown[]) {
    const cb = rest[rest.length - 1];
    if (typeof fd === 'number' && openFds.has(fd) && typeof cb === 'function') {
      if (failReads) {
        const err = Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO', errno: -5, syscall: 'read' });
        process.nextTick(cb as Callback, err);
        return undefined;
      }
      rest[rest.length - 1] = (err: unknown, n: number, buf: unknown) => {
        if (!err) bytesRead += n;
        (cb as Callback)(err, n, buf);
      };
    }
    return realFs.read.call(fs, fd, ...rest);
  };
  mutableFs.close = function (this: unknown, fd: unknown, ...rest: unknown[]) {
    if (typeof fd === 'number') openFds.delete(fd);
    return realFs.close.call(fs, fd, ...rest);
  };
}

/** Records every read stream the route creates, so a test can check it was destroyed */
function recordStreams(): fs.ReadStream[] {
  const created: fs.ReadStream[] = [];
  vi.spyOn(fs, 'createReadStream').mockImplementation(((...args: Parameters<typeof fs.createReadStream>) => {
    const stream = realCreateReadStream.apply(fs, args);
    created.push(stream);
    return stream;
  }) as typeof fs.createReadStream);
  return created;
}

async function startDownload(expectedLength: number): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const { generateDownloadToken } = await import('@/lib/utils/jwt');
  const { GET } = await import('@/app/api/requests/[id]/download/route');
  const token = generateDownloadToken('user-1', 'req-1');
  const response = await GET(
    new NextRequest(`http://localhost/api/requests/req-1/download?token=${token}`),
    { params: Promise.resolve({ id: 'req-1' }) }
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(response.headers.get('content-disposition')).toBe('attachment; filename="My Book.m4b"');
  expect(response.headers.get('content-length')).toBe(String(expectedLength));
  return response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const yieldToIo = () => new Promise<void>((resolve) => setImmediate(resolve));

async function waitFor(condition: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await sleep(20);
  return condition();
}

/** Reads to the end; 'timeout' when the response neither ends nor fails within `ms` */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number) {
  const read = (async () => {
    try {
      for (;;) {
        if ((await reader.read()).done) return 'done' as const;
      }
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  })();
  return Promise.race([read, sleep(ms).then(() => 'timeout' as const)]);
}

describe('GET /api/requests/[id]/download (single file stream)', () => {
  let bookDir: string;
  let filePath: string;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null;
  const uncaught: unknown[] = [];
  const onUncaught = (err: unknown) => uncaught.push(err);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    logged.length = 0;
    uncaught.length = 0;
    openFds.clear();
    bytesRead = 0;
    failReads = false;
    reader = null;
    bookDir = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-download-file-stream-')));
    filePath = path.join(bookDir, 'book.m4b');
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'downloaded',
      type: 'audiobook',
      audiobook: { title: 'My Book', filePath: bookDir },
    });
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({
      role: 'user',
      downloadAccess: null,
      deletedAt: null,
      registrationStatus: 'approved',
      sessionsInvalidatedAt: null,
    });
    process.on('uncaughtException', onUncaught);
    instrumentFs(bookDir);
  });

  afterEach(async () => {
    await reader?.cancel().catch(() => {});
    await sleep(50);
    Object.assign(mutableFs, realFs);
    vi.restoreAllMocks();
    process.off('uncaughtException', onUncaught);
    try {
      fs.rmSync(bookDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // a handle left open by a failing run keeps the folder on Windows
    }
  });

  it('makes no more of the file than the client takes while it is paused, then carries on', async () => {
    const chunkSize = 64 * KB;
    const chunkCount = 64;
    fs.writeFileSync(filePath, Buffer.alloc(chunkSize * chunkCount));
    // A source that makes each chunk the moment it is asked: with no backpressure, a flowing
    // stream drains all of it in one tick
    let made = 0;
    const source = new Readable({
      highWaterMark: chunkSize,
      read() {
        if (made === chunkCount) this.push(null);
        else this.push(Buffer.alloc(chunkSize, made++ % 256));
      },
    });
    vi.spyOn(fs, 'createReadStream').mockReturnValue(source as unknown as fs.ReadStream);

    reader = await startDownload(chunkSize * chunkCount);
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value!.byteLength).toBe(chunkSize);
    for (let i = 0; i < 10; i++) await yieldToIo(); // the client stops reading

    expect(made).toBeLessThanOrEqual(4);

    // The client reads on: every chunk arrives, in order
    const parts: Buffer[] = [Buffer.from(first.value!)];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(Buffer.from(value));
    }
    reader = null;
    const body = Buffer.concat(parts);
    const chunkMarks = Array.from({ length: chunkCount }, (_, i) => body[i * chunkSize]);
    expect({ length: body.length, made }).toEqual({ length: chunkSize * chunkCount, made: chunkCount });
    expect(chunkMarks).toEqual(Array.from({ length: chunkCount }, (_, i) => i % 256));
  });

  it('reads a real file only as fast as the client reads it', async () => {
    fs.writeFileSync(filePath, crypto.randomBytes(32 * MB));
    reader = await startDownload(32 * MB);

    await reader.read();
    await sleep(500); // the client stops reading
    const readWhilePaused = bytesRead;

    expect(readWhilePaused).toBeLessThan(MB);

    let received = 0;
    while (received < 2 * MB) received += (await reader.read()).value?.byteLength ?? 0;
    expect(bytesRead).toBeGreaterThan(readWhilePaused);
  });

  it('closes the file when the client cancels, without logging an error', async () => {
    fs.writeFileSync(filePath, crypto.randomBytes(4 * MB));
    const created = recordStreams();
    reader = await startDownload(4 * MB);

    await reader.read();
    expect(openFds.size).toBe(1);
    await reader.cancel();
    reader = null;

    await waitFor(() => openFds.size === 0, 3000);
    await sleep(100);
    expect(created).toHaveLength(1);
    expect({
      destroyed: created[0].destroyed,
      stillOpen: openFds.size,
      errors: logged.filter((entry) => entry.level === 'error'),
      uncaught: uncaught.map(String),
    }).toEqual({ destroyed: true, stillOpen: 0, errors: [], uncaught: [] });
  });

  it('ends the response with the read error, logs it once and closes the file', async () => {
    fs.writeFileSync(filePath, crypto.randomBytes(MB));
    failReads = true;
    reader = await startDownload(MB);

    const outcome = await drain(reader, 5000);
    reader = null;

    await waitFor(() => openFds.size === 0, 3000);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain('EIO');
    expect({ stillOpen: openFds.size, uncaught: uncaught.map(String) }).toEqual({ stillOpen: 0, uncaught: [] });
    const errors = logged.filter((entry) => entry.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].metadata).toMatchObject({ requestId: 'req-1', error: expect.stringContaining('EIO') });
  });
});
