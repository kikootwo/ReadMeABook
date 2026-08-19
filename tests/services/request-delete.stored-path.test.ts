/**
 * Component: Request Delete Stored Path Regression Tests
 * Documentation: documentation/admin-features/request-deletion.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const configServiceMock = {
  get: vi.fn(),
  getBackendMode: vi.fn(),
};

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('deleteRequest stored media path', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-request-delete-'));
    configServiceMock.get.mockRejectedValue(
      new Error('Media deletion must not read current path configuration')
    );
    configServiceMock.getBackendMode.mockResolvedValue('plex');
    prismaMock.request.findMany.mockResolvedValue([]);
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('deletes the stored directory and preserves the path rendered by the current template', async () => {
    const storedPath = path.join(tempRoot, 'Arthur Conan Doyle', 'The Valley of Fear');
    const currentTemplatePath = path.join(
      tempRoot,
      'Arthur Conan Doyle',
      '1914 - The Valley of Fear'
    );
    const unrelatedFile = path.join(currentTemplatePath, 'my own rip.m4b');

    await fs.mkdir(storedPath, { recursive: true });
    await fs.mkdir(currentTemplatePath, { recursive: true });
    await fs.writeFile(path.join(storedPath, 'book.m4b'), 'organized by RMAB');
    await fs.writeFile(unrelatedFile, 'user-owned file');

    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-stored-path',
      type: 'audiobook',
      audiobook: {
        id: 'ab-stored-path',
        title: 'The Valley of Fear',
        author: 'Arthur Conan Doyle',
        narrator: null,
        audibleAsin: null,
        plexGuid: null,
        absItemId: null,
        filePath: storedPath,
        fileFormat: 'm4b',
      },
      downloadHistory: [],
    });

    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    const result = await deleteRequest('req-stored-path', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.filesDeleted).toBe(true);
    await expect(fs.access(storedPath)).rejects.toThrow();
    await expect(fs.readFile(unrelatedFile, 'utf8')).resolves.toBe('user-owned file');
    expect(configServiceMock.get).not.toHaveBeenCalled();
  });

  it('skips file deletion when a legacy row has no stored path', async () => {
    const unrelatedPath = path.join(tempRoot, 'Arthur Conan Doyle', 'The Valley of Fear');
    const unrelatedFile = path.join(unrelatedPath, 'my own rip.m4b');

    await fs.mkdir(unrelatedPath, { recursive: true });
    await fs.writeFile(unrelatedFile, 'user-owned file');

    prismaMock.request.findFirst.mockResolvedValue({
      id: 'req-no-stored-path',
      type: 'audiobook',
      audiobook: {
        id: 'ab-no-stored-path',
        title: 'The Valley of Fear',
        author: 'Arthur Conan Doyle',
        narrator: null,
        audibleAsin: null,
        plexGuid: null,
        absItemId: null,
        filePath: null,
        fileFormat: null,
      },
      downloadHistory: [],
    });

    const { deleteRequest } = await import('@/lib/services/request-delete.service');
    const result = await deleteRequest('req-no-stored-path', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.filesDeleted).toBe(false);
    await expect(fs.readFile(unrelatedFile, 'utf8')).resolves.toBe('user-owned file');
    expect(configServiceMock.get).not.toHaveBeenCalled();
  });
});
