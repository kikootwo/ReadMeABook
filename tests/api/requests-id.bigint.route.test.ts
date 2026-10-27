/**
 * Component: Request By ID API Route Tests (BigInt columns, #261)
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

type AuthHandler = (req: unknown) => unknown;
let authRequest: { user: { id: string; role: string } };

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('@/lib/integrations/prowlarr-connection', () => ({
  getProwlarrConnection: async () => ({
    baseUrl: 'http://prowlarr:9696',
    apiKey: 'test-prowlarr-key',
    base: { origin: 'http://prowlarr:9696', protocol: 'http:', hostname: 'prowlarr', host: 'prowlarr:9696', port: '9696', defaultPort: false, userinfo: '', basePath: '' },
  }),
}));

const SIZE = 1_234_567_890;

/** A request whose selected download has a size, shaped like the Prisma result. */
function downloadedRequest(userId: string) {
  return {
    id: 'req-1',
    userId,
    status: 'downloaded',
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    audiobook: { id: 'ab-1', title: 'Big Book', fileSizeBytes: BigInt(SIZE * 2) as bigint | null },
    user: { id: userId, plexUsername: 'reader' },
    downloadHistory: [
      { id: 'dh-1', torrentName: 'Big Book [M4B]', torrentSizeBytes: BigInt(SIZE) as bigint | null, selected: true },
    ],
    jobs: [],
  };
}

async function getRequest() {
  const { GET } = await import('@/app/api/requests/[id]/route');
  return GET({} as never, { params: Promise.resolve({ id: 'req-1' }) });
}

describe('GET /api/requests/[id] with BigInt columns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', role: 'user' } };
    requireAuthMock.mockImplementation((_req: unknown, handler: AuthHandler) => handler(authRequest));
  });

  it('returns 200 with sizes as numbers for the owner', async () => {
    prismaMock.request.findFirst.mockResolvedValueOnce(downloadedRequest('user-1'));

    const response = await getRequest();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.request.downloadHistory[0].torrentSizeBytes).toBe(SIZE);
    expect(payload.request.audiobook.fileSizeBytes).toBe(SIZE * 2);
    expect(payload.request.createdAt).toBe('2026-10-01T12:00:00.000Z');
  });

  it('returns 200 with sizes as numbers for an admin', async () => {
    authRequest.user = { id: 'admin-1', role: 'admin' };
    prismaMock.request.findFirst.mockResolvedValueOnce(downloadedRequest('user-1'));

    const response = await getRequest();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.request.downloadHistory[0].torrentSizeBytes).toBe(SIZE);
    expect(payload.request.audiobook.fileSizeBytes).toBe(SIZE * 2);
  });

  it('keeps a missing size as null', async () => {
    const record = downloadedRequest('user-1');
    record.downloadHistory[0].torrentSizeBytes = null;
    record.audiobook.fileSizeBytes = null;
    prismaMock.request.findFirst.mockResolvedValueOnce(record);

    const response = await getRequest();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.request.downloadHistory[0].torrentSizeBytes).toBeNull();
    expect(payload.request.audiobook.fileSizeBytes).toBeNull();
  });
});
