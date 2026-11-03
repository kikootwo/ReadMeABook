/**
 * Component: Request File Download Route Tests (zip cancel, read error, slow reader)
 * Documentation: documentation/backend/services/auth.md
 *
 * Runs the real route and the real archiver over real temp files. File handles and bytes read
 * are counted by wrapping fs.open, fs.read and fs.close, which every fs.ReadStream calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
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

const MB = 1024 * 1024;
const openFds = new Map<number, string>();
let opened = 0;
let bytesRead = 0;
let failReadsOf: string | null = null;

/** Tracks every file the route opens under `dir`; reads of `failReadsOf` fail with EIO */
function instrumentFs(dir: string) {
  mutableFs.open = function (this: unknown, file: unknown, ...rest: unknown[]) {
    const cb = rest[rest.length - 1];
    // archiver passes paths with '/' separators, so compare resolved paths
    if (typeof file === 'string' && path.resolve(file).startsWith(dir) && typeof cb === 'function') {
      rest[rest.length - 1] = (err: unknown, fd: number) => {
        if (!err) {
          opened++;
          openFds.set(fd, file);
        }
        (cb as Callback)(err, fd);
      };
    }
    return realFs.open.call(fs, file, ...rest);
  };
  mutableFs.read = function (this: unknown, fd: unknown, ...rest: unknown[]) {
    const cb = rest[rest.length - 1];
    const file = typeof fd === 'number' ? openFds.get(fd) : undefined;
    if (file && typeof cb === 'function') {
      if (failReadsOf && path.basename(file) === failReadsOf) {
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

async function startZip(): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const { generateDownloadToken } = await import('@/lib/utils/jwt');
  const { GET } = await import('@/app/api/requests/[id]/download/route');
  const token = generateDownloadToken('user-1', 'req-1');
  const response = await GET(
    new NextRequest(`http://localhost/api/requests/req-1/download?token=${token}`),
    { params: Promise.resolve({ id: 'req-1' }) }
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/zip');
  return response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    } catch {
      return 'errored' as const;
    }
  })();
  return Promise.race([read, sleep(ms).then(() => 'timeout' as const)]);
}

describe('GET /api/requests/[id]/download (zip stream)', () => {
  let bookDir: string;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null;
  const uncaught: unknown[] = [];
  const onUncaught = (err: unknown) => uncaught.push(err);

  function writeParts(count: number, bytes: number) {
    const data = crypto.randomBytes(bytes); // random bytes don't compress: the zip is as big as the files
    for (let i = 1; i <= count; i++) fs.writeFileSync(path.join(bookDir, `Part ${i}.mp3`), data);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    logged.length = 0;
    uncaught.length = 0;
    openFds.clear();
    opened = 0;
    bytesRead = 0;
    failReadsOf = null;
    reader = null;
    bookDir = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-download-zip-stream-')));
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
    process.off('uncaughtException', onUncaught);
    try {
      fs.rmSync(bookDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // a handle left open by a failing run keeps the folder on Windows
    }
  });

  it('closes every file it opened when the client cancels partway', async () => {
    writeParts(3, 2 * MB);
    reader = await startZip();

    // past the first entry's header, so a file is being read when the client goes away
    let received = 0;
    while (received < 512 * 1024) received += (await reader.read()).value?.byteLength ?? 0;
    expect(opened).toBeGreaterThan(0);
    await reader.cancel();
    reader = null;

    await waitFor(() => openFds.size === 0, 3000);
    await sleep(200);
    expect({ stillOpen: openFds.size, uncaught: uncaught.map(String) }).toEqual({ stillOpen: 0, uncaught: [] });
  });

  it('ends the response with an error when a file cannot be read, and logs it once', async () => {
    writeParts(3, MB / 4);
    failReadsOf = 'Part 2.mp3';
    reader = await startZip();

    const outcome = await drain(reader, 5000);

    await waitFor(() => openFds.size === 0, 3000);
    expect({ outcome, stillOpen: openFds.size, uncaught: uncaught.map(String) }).toEqual({
      outcome: 'errored',
      stillOpen: 0,
      uncaught: [],
    });
    const errors = logged.filter((entry) => entry.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].metadata).toMatchObject({ requestId: 'req-1', error: expect.stringContaining('EIO') });
  });

  it('reads the files only as fast as the client reads the zip', async () => {
    writeParts(5, 20 * MB); // a 100 MB zip
    reader = await startZip();

    await reader.read();
    await sleep(3000); // the client stops reading
    const readWhilePaused = bytesRead;
    console.log(`[zip-stream] read from disk while the client paused: ${(readWhilePaused / MB).toFixed(1)} MB of 100 MB`);

    expect(readWhilePaused).toBeLessThan(16 * MB);

    // The client reads on: the zip carries on from where it stopped
    let received = 0;
    while (received < 4 * MB) received += (await reader.read()).value?.byteLength ?? 0;
    expect(bytesRead).toBeGreaterThan(readWhilePaused);
    await reader.cancel();
    reader = null;

    await waitFor(() => openFds.size === 0, 3000);
    expect({ stillOpen: openFds.size, uncaught: uncaught.map(String) }).toEqual({ stillOpen: 0, uncaught: [] });
  }, 40000);
});
