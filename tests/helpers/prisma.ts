/**
 * Component: Prisma Mock Factory
 * Documentation: documentation/backend/database.md
 */

import { vi } from 'vitest';

type PrismaModelMock = {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
};

const createModelMock = (): PrismaModelMock => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(() => Promise.resolve({})),
  update: vi.fn(() => Promise.resolve({})),
  updateMany: vi.fn(() => Promise.resolve({})),
  upsert: vi.fn(() => Promise.resolve({})),
  delete: vi.fn(() => Promise.resolve({})),
  deleteMany: vi.fn(() => Promise.resolve({})),
  count: vi.fn(),
});

export const createPrismaMock = () => ({
  configuration: createModelMock(),
  user: createModelMock(),
  request: createModelMock(),
  audiobook: createModelMock(),
  downloadHistory: createModelMock(),
  plexLibrary: createModelMock(),
  audibleCache: createModelMock(),
  job: createModelMock(),
  jobEvent: createModelMock(),
  scheduledJob: createModelMock(),
  bookDateConfig: createModelMock(),
  bookDateRecommendation: createModelMock(),
  bookDateSwipe: createModelMock(),
  goodreadsShelf: createModelMock(),
  goodreadsBookMapping: createModelMock(),
  followedAuthor: createModelMock(),
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
});
