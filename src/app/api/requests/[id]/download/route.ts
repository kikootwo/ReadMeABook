/**
 * Component: Request File Download Endpoint
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyDownloadToken } from '@/lib/utils/jwt';
import { getSessionRefusal } from '@/lib/services/auth/local-account-status';
import { resolveDownloadAccess } from '@/lib/utils/permissions';
import { RMABLogger } from '@/lib/utils/logger';
import { AUDIO_EXTENSIONS, EBOOK_EXTENSIONS } from '@/lib/constants/audio-formats';
import { COMPLETED_STATUSES } from '@/lib/constants/request-statuses';
import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import { PassThrough } from 'stream';

const logger = RMABLogger.create('API.Download');

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Zips the files as the client reads the response. A cancel or a failure closes every file the
 * zip opened; a failure is logged once and ends the response with an error.
 */
function streamZip(requestId: string, filePaths: string[]): ReadableStream<Uint8Array> {
  // Flat entry names: '/' or '\' becomes '_', so each file stays at the zip root; so does ':',
  // since archiver drops a leading 'word:' from entry names. Stat first, so a file that is gone
  // fails the request before the zip starts.
  const entries = filePaths.map(filePath => ({
    filePath,
    name: path.basename(filePath).replace(/[\\/:]/g, '_'),
    stats: fs.lstatSync(filePath),
  }));

  const output = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 6 } });
  let current: fs.ReadStream | null = null;
  let failed = false;
  const fail = (err: Error) => {
    if (failed) return;
    failed = true;
    logger.error('Zip download failed', { requestId, error: err.message });
    output.destroy(err);
  };
  archive.on('error', fail);
  // A file archiver can't add: fail rather than send a zip without it
  archive.on('warning', fail);
  // Done, cancelled or failed: stop the archive and close the file being read, if any
  output.once('close', () => {
    archive.abort();
    current?.destroy();
  });
  archive.pipe(output);

  // One entry at a time: archiver starts reading a stream as soon as it is appended, so the next
  // file is opened only when the previous entry is written, and only one file is open at a time
  let next = 0;
  const appendNext = () => {
    if (failed || output.destroyed) return;
    if (next === entries.length) {
      // Failures arrive on 'error'; the promise only repeats them
      archive.finalize().catch(() => {});
      return;
    }
    const { filePath, name, stats } = entries[next++];
    if (stats.isFile()) {
      current = fs.createReadStream(filePath);
      current.on('error', fail);
      archive.append(current, { name, stats });
    } else {
      // A directory or symlink: archiver writes the entry without opening a file
      current = null;
      archive.file(filePath, { name, stats });
    }
  };
  archive.on('entry', appendNext);
  appendNext();

  // Pull-based: the next chunk is read only when the client has taken the last one, so a slow
  // reader holds the archive back instead of the zip queueing in memory
  const chunks = output[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(new Uint8Array(value));
    },
    cancel() {
      output.destroy();
    },
  });
}

/**
 * GET /api/requests/[id]/download?token=<JWT>
 * Token-authenticated file download — no session cookie required.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = request.nextUrl.searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized', message: 'Missing download token' }, { status: 401 });
    }

    const payload = verifyDownloadToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized', message: 'Invalid or expired download token' }, { status: 401 });
    }

    if (payload.requestId !== id) {
      return NextResponse.json({ error: 'Unauthorized', message: 'Token does not match request' }, { status: 401 });
    }

    // The link acts for its account: apply the session rule and the download permission the issuer checked
    const account = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        role: true,
        downloadAccess: true,
        deletedAt: true,
        registrationStatus: true,
        sessionsInvalidatedAt: true,
      },
    });

    const refusal = getSessionRefusal(account, payload.iat);
    if (!account || refusal) {
      logger.warn('Download link refused for account', { userId: payload.sub, reason: refusal });
      return NextResponse.json({ error: 'Unauthorized', message: 'Invalid or expired download token' }, { status: 401 });
    }

    if (!(await resolveDownloadAccess(account.role, account.downloadAccess))) {
      logger.warn('Download link refused: account has no download access', { userId: payload.sub });
      return NextResponse.json({ error: 'Forbidden', message: 'You do not have download access' }, { status: 403 });
    }

    const requestRecord = await prisma.request.findFirst({
      where: { id, deletedAt: null },
      include: { audiobook: true },
    });

    if (!requestRecord) {
      return NextResponse.json({ error: 'NotFound', message: 'Request not found' }, { status: 404 });
    }

    if (!COMPLETED_STATUSES.includes(requestRecord.status as typeof COMPLETED_STATUSES[number])) {
      return NextResponse.json({ error: 'BadRequest', message: 'Request is not yet completed' }, { status: 400 });
    }

    if (!requestRecord.audiobook?.filePath) {
      return NextResponse.json({ error: 'NotFound', message: 'No file path available for this request' }, { status: 404 });
    }

    const resolvedDir = path.resolve(requestRecord.audiobook.filePath);

    if (!fs.existsSync(resolvedDir)) {
      logger.error('Download directory does not exist', { path: resolvedDir });
      return NextResponse.json({ error: 'NotFound', message: 'File directory not found on disk' }, { status: 404 });
    }

    const requestType = requestRecord.type || 'audiobook';
    const allowedExtensions: readonly string[] = requestType === 'ebook' ? EBOOK_EXTENSIONS : AUDIO_EXTENSIONS;

    const allEntries = fs.readdirSync(resolvedDir);
    const matchingFiles = allEntries
      .filter(name => allowedExtensions.includes(path.extname(name).toLowerCase()))
      .map(name => path.join(resolvedDir, name));

    if (matchingFiles.length === 0) {
      return NextResponse.json({ error: 'NotFound', message: 'No matching files found in directory' }, { status: 404 });
    }

    const sanitizedTitle = sanitizeFilename(requestRecord.audiobook.title || 'download');

    if (matchingFiles.length === 1) {
      const filePath = matchingFiles[0];
      const ext = path.extname(filePath);
      const stat = fs.statSync(filePath);
      const fileStream = fs.createReadStream(filePath);

      const readableStream = new ReadableStream({
        start(controller) {
          fileStream.on('data', chunk => controller.enqueue(chunk));
          fileStream.on('end', () => controller.close());
          fileStream.on('error', err => {
            logger.error('File stream error', { error: err.message });
            controller.error(err);
          });
        },
        cancel() {
          fileStream.destroy();
        },
      });

      return new NextResponse(readableStream, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${sanitizedTitle}${ext}"`,
          'Content-Length': String(stat.size),
        },
      });
    }

    // Multiple files: a zip built as the client reads it
    return new NextResponse(streamZip(id, matchingFiles), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${sanitizedTitle}.zip"`,
      },
    });
  } catch (error) {
    logger.error('Download failed', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'DownloadError', message: 'Failed to serve file' }, { status: 500 });
  }
}
