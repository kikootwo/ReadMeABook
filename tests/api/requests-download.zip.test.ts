/**
 * Component: Request File Download Route Tests (multi-file zip)
 * Documentation: documentation/backend/services/auth.md
 *
 * Streams a real zip from files on disk through the route and reads it back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import AdmZip from 'adm-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

const PART_ONE = Buffer.from('ID3 part one audio bytes');
const PART_TWO = Buffer.alloc(64 * 1024, 7); // larger than one stream chunk

async function downloadZip(): Promise<{ response: Response; zip: AdmZip }> {
  const { generateDownloadToken } = await import('@/lib/utils/jwt');
  const { GET } = await import('@/app/api/requests/[id]/download/route');
  const token = generateDownloadToken('user-1', 'req-1');
  const response = await GET(
    new NextRequest(`http://localhost/api/requests/req-1/download?token=${token}`),
    { params: Promise.resolve({ id: 'req-1' }) }
  );
  expect(response.status).toBe(200);
  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  return { response, zip };
}

const entryNames = (zip: AdmZip) => zip.getEntries().map((e) => e.entryName).sort();

describe('GET /api/requests/[id]/download (multi-file zip)', () => {
  let bookDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    bookDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-download-zip-'));
    fs.writeFileSync(path.join(bookDir, 'Part 1.mp3'), PART_ONE);
    fs.writeFileSync(path.join(bookDir, 'Part 2.mp3'), PART_TWO);
    fs.writeFileSync(path.join(bookDir, 'cover.jpg'), Buffer.from('not audio'));
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
  });

  afterEach(() => {
    fs.rmSync(bookDir, { recursive: true, force: true });
  });

  it('streams a zip of the audio files that unzips to the same names and bytes', async () => {
    const { response, zip } = await downloadZip();

    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="My Book.zip"');
    expect(entryNames(zip)).toEqual(['Part 1.mp3', 'Part 2.mp3']);
    expect(zip.getEntry('Part 1.mp3')!.getData().equals(PART_ONE)).toBe(true);
    expect(zip.getEntry('Part 2.mp3')!.getData().equals(PART_TWO)).toBe(true);
  });

  // A backslash is an ordinary file name character only on POSIX file systems
  it.skipIf(process.platform === 'win32')('keeps a file whose name holds a backslash as one entry at the zip root', async () => {
    const odd = Buffer.from('ID3 odd name');
    fs.writeFileSync(path.join(bookDir, 'Disc 2\\Part 3.mp3'), odd);

    const { zip } = await downloadZip();
    const names = entryNames(zip);

    expect(names).toEqual(['Disc 2_Part 3.mp3', 'Part 1.mp3', 'Part 2.mp3']);
    expect(names.filter((n) => n.includes('/') || n.includes('\\'))).toEqual([]);
    expect(zip.getEntry('Disc 2_Part 3.mp3')!.getData().equals(odd)).toBe(true);
  });

  // Windows file names can't hold ':' either
  it.skipIf(process.platform === 'win32')('keeps the full name of a file whose name starts with a word and a colon', async () => {
    const intro = Buffer.from('ID3 intro');
    fs.writeFileSync(path.join(bookDir, 'Intro: The Start.mp3'), intro);

    const { zip } = await downloadZip();

    expect(entryNames(zip)).toEqual(['Intro_ The Start.mp3', 'Part 1.mp3', 'Part 2.mp3']);
    expect(zip.getEntry('Intro_ The Start.mp3')!.getData().equals(intro)).toBe(true);
  });
});
