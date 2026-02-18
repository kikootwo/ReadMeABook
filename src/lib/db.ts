/**
 * Component: Database Client
 * Documentation: documentation/backend/database.md
 */

import { PrismaClient } from '@/generated/prisma/client';

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

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: getPooledDatabaseUrl(),
      },
    },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;
