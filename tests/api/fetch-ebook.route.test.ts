/**
 * Component: Fetch Ebook by ASIN API tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Pins the status-code contract the route had before its logic moved into the shared service:
 * 201 only for a freshly created request, 200 when an existing retryable request is re-driven.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createEbookRequestForUser = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/ebook-request-creator.service', () => ({ createEbookRequestForUser }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: any, handler: any) => handler({ ...req, user: { id: 'user-1' } }),
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

const post = async (asin = 'B000XXXXXX') => {
  const { POST } = await import('@/app/api/audiobooks/[asin]/fetch-ebook/route');
  return POST({} as any, { params: Promise.resolve({ asin }) });
};

describe('POST /api/audiobooks/[asin]/fetch-ebook', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 201 when a new request is created', async () => {
    createEbookRequestForUser.mockResolvedValue({
      success: true,
      requestId: 'req-1',
      needsApproval: false,
      message: 'E-book request created and search started',
      created: true,
    });

    const response = await post();

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, requestId: 'req-1' });
  });

  it('returns 200 when an existing request is retried', async () => {
    createEbookRequestForUser.mockResolvedValue({
      success: true,
      requestId: 'req-1',
      needsApproval: false,
      message: 'E-book search retried',
      created: false,
    });

    const response = await post();

    // The original route returned 200 for the retry path; 201 here was the one deviation.
    expect(response.status).toBe(200);
  });

  it('returns 201 when a request is created awaiting approval', async () => {
    createEbookRequestForUser.mockResolvedValue({
      success: true,
      requestId: 'req-1',
      needsApproval: true,
      message: 'Ebook request submitted for admin approval',
      created: true,
    });

    const response = await post();

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ needsApproval: true });
  });

  it.each([
    ['feature_disabled', 400],
    ['not_found_on_audible', 404],
    ['not_available', 400],
    ['already_active', 409],
    ['user_not_found', 404],
  ])('maps %s to %i', async (reason, status) => {
    createEbookRequestForUser.mockResolvedValue({ success: false, reason, message: 'nope' });

    const response = await post();

    expect(response.status).toBe(status);
  });

  it('rejects a malformed ASIN before touching the service', async () => {
    const response = await post('short');

    expect(response.status).toBe(400);
    expect(createEbookRequestForUser).not.toHaveBeenCalled();
  });
});
