/**
 * Component: Database Client
 * Documentation: documentation/backend/database.md
 */

import { PrismaClient } from '@/generated/prisma/client';
import { oncePerProcess, processSingleton } from '@/lib/utils/process-singleton';

/**
 * Append connection pool parameters to DATABASE_URL if not already present.
 * - connection_limit=20: up from default 9, fits 22 max workers + API routes
 * - pool_timeout=30: up from default 10s, gives queued requests time
 */
function getPooledDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL || '';
  if (!baseUrl) return baseUrl;

  const separator = baseUrl.includes('?') ? '&' : '?';
  const params: string[] = [];

  if (!baseUrl.includes('connection_limit')) {
    params.push('connection_limit=20');
  }
  if (!baseUrl.includes('pool_timeout')) {
    params.push('pool_timeout=30');
  }

  if (params.length === 0) return baseUrl;
  return `${baseUrl}${separator}${params.join('&')}`;
}

// One Prisma Client per process (survives dev HMR and duplicate module evaluation).
// Two audiobook columns are left out of every audiobook result unless a query selects them (or sets
// `omit: { <column>: false }`):
// - `library_asin` (#325a): responses show only the effective value, through
//   src/lib/services/library/library-display.ts.
// - `file_size_bytes` (#600): a BigInt, which NextResponse.json cannot serialize, so full-row reads
//   must not carry it into a response. Readers select it and convert it (toJsonSafe).
export const prisma = processSingleton('prisma', () =>
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: getPooledDatabaseUrl(),
      },
    },
    omit: {
      audiobook: { libraryAsin: true, fileSizeBytes: true },
    },
  })
);

// Graceful shutdown
oncePerProcess('prisma-disconnect', () => {
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
});

export default prisma;
