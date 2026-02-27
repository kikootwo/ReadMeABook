/**
 * Component: Request File Download Endpoint
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyDownloadToken } from '@/lib/utils/jwt';
import { RMABLogger } from '@/lib/utils/logger';
import { AUDIO_EXTENSIONS, EBOOK_EXTENSIONS } from '@/lib/constants/audio-formats';
import { COMPLETED_STATUSES } from '@/lib/constants/request-statuses';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
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

    // Multiple files — stream zip via archiver (avoids loading all files into memory)
    const passThrough = new PassThrough();
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(passThrough);
    for (const filePath of matchingFiles) {
      archive.file(filePath, { name: path.basename(filePath) });
    }
    archive.finalize();

    const zipReadable = new ReadableStream({
      start(controller) {
        passThrough.on('data', chunk => controller.enqueue(new Uint8Array(chunk)));
        passThrough.on('end', () => controller.close());
        passThrough.on('error', err => {
          logger.error('Zip stream error', { error: err.message });
          controller.error(err);
        });
      },
      cancel() {
        archive.abort();
      },
    });

    return new NextResponse(zipReadable, {
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
