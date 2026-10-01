/**
 * Component: Admin Author Blacklist API Route Tests
 * Documentation: documentation/admin-features/author-blacklist.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let authRequest: any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const listBlockedAuthorsMock = vi.hoisted(() => vi.fn());
const addBlockedAuthorMock = vi.hoisted(() => vi.fn());
const removeBlockedAuthorMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/services/author-blacklist.service', () => ({
  listBlockedAuthors: listBlockedAuthorsMock,
  addBlockedAuthor: addBlockedAuthorMock,
  removeBlockedAuthor: removeBlockedAuthorMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('Admin author blacklist routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = {
      user: { id: 'admin-1', role: 'admin' },
      json: vi.fn(),
    };
    requireAuthMock.mockImplementation((_req: any, handler: any) =>
      handler(authRequest)
    );
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('GET returns entries and count', async () => {
    const entries = [
      {
        id: 'ba-1',
        authorName: 'Stephen King',
        authorKey: 'stephen king',
        createdAt: new Date(),
      },
    ];
    listBlockedAuthorsMock.mockResolvedValueOnce(entries);

    const { GET } = await import('@/app/api/admin/author-blacklist/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.entries).toHaveLength(1);
  });

  it('POST creates a new entry', async () => {
    authRequest.json.mockResolvedValueOnce({ authorName: 'Stephen King' });
    addBlockedAuthorMock.mockResolvedValueOnce({
      entry: {
        id: 'ba-1',
        authorName: 'Stephen King',
        authorKey: 'stephen king',
      },
      wasNew: true,
    });

    const { POST } = await import('@/app/api/admin/author-blacklist/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.entry.authorName).toBe('Stephen King');
    expect(addBlockedAuthorMock).toHaveBeenCalledWith({
      authorName: 'Stephen King',
      createdById: 'admin-1',
    });
  });

  it('POST returns 409 on duplicate', async () => {
    authRequest.json.mockResolvedValueOnce({ authorName: 'Stephen King' });
    addBlockedAuthorMock.mockResolvedValueOnce({
      entry: { id: 'ba-1', authorName: 'Stephen King' },
      wasNew: false,
    });

    const { POST } = await import('@/app/api/admin/author-blacklist/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toBe('DuplicateAuthor');
  });

  it('POST returns 400 on validation error', async () => {
    authRequest.json.mockResolvedValueOnce({ authorName: '' });

    const { POST } = await import('@/app/api/admin/author-blacklist/route');
    const response = await POST({} as any);

    expect(response.status).toBe(400);
  });

  it('DELETE removes an entry', async () => {
    removeBlockedAuthorMock.mockResolvedValueOnce(true);

    const { DELETE } = await import(
      '@/app/api/admin/author-blacklist/[id]/route'
    );
    const response = await DELETE({} as any, {
      params: Promise.resolve({ id: 'ba-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(removeBlockedAuthorMock).toHaveBeenCalledWith('ba-1');
  });

  it('DELETE returns 404 when missing', async () => {
    removeBlockedAuthorMock.mockResolvedValueOnce(false);

    const { DELETE } = await import(
      '@/app/api/admin/author-blacklist/[id]/route'
    );
    const response = await DELETE({} as any, {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(response.status).toBe(404);
  });
});
