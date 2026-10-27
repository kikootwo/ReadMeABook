/**
 * Component: Request File Download Route Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

const FILE_BYTES = Buffer.from('fake-m4b-audio-bytes');
let bookDir: string;

type Account = {
  role: string;
  downloadAccess: boolean | null;
  deletedAt: Date | null;
  registrationStatus: string | null;
  sessionsInvalidatedAt: Date | null;
};

const liveAccount = (overrides: Partial<Account> = {}): Account => ({
  role: 'user',
  downloadAccess: null,
  deletedAt: null,
  registrationStatus: 'approved',
  sessionsInvalidatedAt: null,
  ...overrides,
});

async function linkFor(userId = 'user-1', requestId = 'req-1'): Promise<string> {
  const { generateDownloadToken } = await import('@/lib/utils/jwt');
  return generateDownloadToken(userId, requestId);
}

/** A bare GET with only the link's query string: no cookie, no Authorization header. */
function linkRequest(token: string, requestId = 'req-1'): NextRequest {
  return new NextRequest(`http://localhost/api/requests/${requestId}/download?token=${token}`);
}

async function callDownload(token: string, requestId = 'req-1') {
  const { GET } = await import('@/app/api/requests/[id]/download/route');
  return GET(linkRequest(token, requestId), { params: Promise.resolve({ id: requestId }) });
}

describe('GET /api/requests/[id]/download', () => {
  beforeAll(() => {
    bookDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-download-'));
    fs.writeFileSync(path.join(bookDir, 'book.m4b'), FILE_BYTES);
  });

  afterAll(() => {
    fs.rmSync(bookDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-1',
      userId: 'user-1',
      status: 'available',
      type: 'audiobook',
      audiobook: { title: 'The Book', filePath: bookDir },
    });
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue(liveAccount());
  });

  it("serves a live account's file with no session cookie, headers unchanged", async () => {
    const response = await callDownload(await linkFor());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="The Book.m4b"');
    expect(response.headers.get('content-length')).toBe(String(FILE_BYTES.length));
    expect(Buffer.from(await response.arrayBuffer()).equals(FILE_BYTES)).toBe(true);
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        role: true,
        downloadAccess: true,
        deletedAt: true,
        registrationStatus: true,
        sessionsInvalidatedAt: true,
      },
    });
  });

  it('keeps working when sessions were revoked before the link was made', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      liveAccount({ sessionsInvalidatedAt: new Date(Date.now() - 60_000) })
    );

    const response = await callDownload(await linkFor());

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(FILE_BYTES)).toBe(true);
  });

  const refusedAccounts: Array<[string, Account | null]> = [
    ['a missing account', null],
    ['a deleted account', liveAccount({ deletedAt: new Date() })],
    ['a rejected account', liveAccount({ registrationStatus: 'rejected' })],
    ['a pending account', liveAccount({ registrationStatus: 'pending_approval' })],
    ['an account whose sessions were revoked after the link was made',
      liveAccount({ sessionsInvalidatedAt: new Date(Date.now() + 60_000) })],
  ];

  it.each(refusedAccounts)('refuses a link for %s with 401 and never reads the disk', async (_label, account) => {
    prismaMock.user.findUnique.mockResolvedValue(account);
    const existsSpy = vi.spyOn(fs, 'existsSync');
    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    const streamSpy = vi.spyOn(fs, 'createReadStream');

    const response = await callDownload(await linkFor());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      message: 'Invalid or expired download token',
    });
    expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
    expect(existsSpy).not.toHaveBeenCalled();
    expect(readdirSpy).not.toHaveBeenCalled();
    expect(streamSpy).not.toHaveBeenCalled();
  });

  describe('download permission is checked on the current account', () => {
    it('refuses a link when the account has download access turned off', async () => {
      prismaMock.user.findUnique.mockResolvedValue(liveAccount({ downloadAccess: false }));
      const existsSpy = vi.spyOn(fs, 'existsSync');

      const response = await callDownload(await linkFor());

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'Forbidden',
        message: 'You do not have download access',
      });
      expect(prismaMock.request.findFirst).not.toHaveBeenCalled();
      expect(existsSpy).not.toHaveBeenCalled();
    });

    it('refuses a link made by an admin who has since lost the admin role and download access', async () => {
      prismaMock.user.findUnique.mockResolvedValue(
        liveAccount({ role: 'user', downloadAccess: false })
      );

      const response = await callDownload(await linkFor('admin-1'));

      expect(response.status).toBe(403);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'admin-1' } })
      );
    });

    it('refuses a link when the global download setting is off and the account has no override', async () => {
      prismaMock.configuration.findUnique.mockResolvedValue({ key: 'download_access', value: 'false' });

      const response = await callDownload(await linkFor());

      expect(response.status).toBe(403);
      expect(prismaMock.configuration.findUnique).toHaveBeenCalledWith({ where: { key: 'download_access' } });
    });

    it('serves an admin regardless of the global download setting', async () => {
      prismaMock.configuration.findUnique.mockResolvedValue({ key: 'download_access', value: 'false' });
      prismaMock.user.findUnique.mockResolvedValue(liveAccount({ role: 'admin', downloadAccess: false }));

      const response = await callDownload(await linkFor('admin-1'));

      expect(response.status).toBe(200);
    });

    it("serves another user's completed request to an account with download access, as the link issuer allows", async () => {
      prismaMock.request.findFirst.mockResolvedValue({
        id: 'req-1',
        userId: 'someone-else',
        status: 'downloaded',
        type: 'audiobook',
        audiobook: { title: 'The Book', filePath: bookDir },
      });

      const response = await callDownload(await linkFor('user-1'));

      expect(response.status).toBe(200);
    });
  });

  it('still refuses a link for a different request before looking up the account', async () => {
    const response = await callDownload(await linkFor('user-1', 'req-2'));

    expect(response.status).toBe(401);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});
