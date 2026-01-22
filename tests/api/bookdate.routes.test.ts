/**
 * Component: BookDate API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const encryptionMock = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => `enc-${value}`),
  decrypt: vi.fn((value: string) => value.replace('enc-', '')),
}));
const configServiceMock = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
}));
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn().mockResolvedValue(undefined),
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));
const bookdateHelpersMock = vi.hoisted(() => ({
  buildAIPrompt: vi.fn(),
  callAI: vi.fn(),
  matchToAudnexus: vi.fn(),
  isInLibrary: vi.fn(),
  isAlreadyRequested: vi.fn(),
  isAlreadySwiped: vi.fn(),
}));
const audibleServiceMock = vi.hoisted(() => ({
  getAudiobookDetails: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/bookdate/helpers', () => bookdateHelpersMock);

describe('BookDate routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
  });

  it('returns BookDate config without API key', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      id: 'cfg-1',
      apiKey: 'secret',
      provider: 'openai',
      model: 'gpt',
    });

    const { GET } = await import('@/app/api/bookdate/config/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.config.apiKey).toBeUndefined();
    expect(payload.config.provider).toBe('openai');
  });

  it('returns null config when not configured', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce(null);

    const { GET } = await import('@/app/api/bookdate/config/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.config).toBeNull();
  });

  it('saves BookDate config and clears recommendations', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce(null);
    prismaMock.bookDateConfig.create.mockResolvedValueOnce({
      id: 'cfg-2',
      provider: 'openai',
      model: 'gpt',
      apiKey: 'enc-secret',
    });
    prismaMock.bookDateRecommendation.deleteMany.mockResolvedValueOnce({ count: 1 });
    authRequest.json.mockResolvedValue({ provider: 'openai', apiKey: 'secret', model: 'gpt' });

    const { POST } = await import('@/app/api/bookdate/config/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.bookDateRecommendation.deleteMany).toHaveBeenCalled();
  });

  it('rejects missing required fields when saving config', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce(null);
    authRequest.json.mockResolvedValue({ provider: 'openai', apiKey: 'key' });

    const { POST } = await import('@/app/api/bookdate/config/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Missing required fields/);
  });

  it('rejects invalid provider when saving config', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce(null);
    authRequest.json.mockResolvedValue({ provider: 'invalid', apiKey: 'key', model: 'gpt' });

    const { POST } = await import('@/app/api/bookdate/config/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid provider/);
  });

  it('rejects custom provider without baseUrl', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce(null);
    authRequest.json.mockResolvedValue({ provider: 'custom', apiKey: '', model: 'model-x' });

    const { POST } = await import('@/app/api/bookdate/config/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Base URL is required/);
  });

  it('rejects custom provider with invalid baseUrl', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce(null);
    authRequest.json.mockResolvedValue({
      provider: 'custom',
      apiKey: '',
      model: 'model-x',
      baseUrl: 'ftp://bad',
    });

    const { POST } = await import('@/app/api/bookdate/config/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid base URL/);
  });

  it('updates existing config without a new API key', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      id: 'cfg-9',
      apiKey: 'enc-existing',
    });
    prismaMock.bookDateConfig.update.mockResolvedValueOnce({
      id: 'cfg-9',
      provider: 'openai',
      model: 'gpt-4',
      apiKey: 'enc-existing',
    });
    authRequest.json.mockResolvedValue({ provider: 'openai', model: 'gpt-4' });

    const { POST } = await import('@/app/api/bookdate/config/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.bookDateConfig.update).toHaveBeenCalled();
  });

  it('creates custom config with empty API key', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce(null);
    prismaMock.bookDateConfig.create.mockResolvedValueOnce({
      id: 'cfg-10',
      provider: 'custom',
      model: 'model-x',
      apiKey: 'enc-',
    });
    prismaMock.bookDateRecommendation.deleteMany.mockResolvedValueOnce({ count: 1 });
    authRequest.json.mockResolvedValue({
      provider: 'custom',
      model: 'model-x',
      baseUrl: 'http://custom',
    });

    const { POST } = await import('@/app/api/bookdate/config/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(encryptionMock.encrypt).toHaveBeenCalledWith('');
  });

  it('deletes BookDate config', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({ id: 'cfg-3' });
    prismaMock.bookDateConfig.delete.mockResolvedValueOnce({});
    prismaMock.bookDateRecommendation.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.bookDateSwipe.deleteMany.mockResolvedValueOnce({ count: 1 });

    const { DELETE } = await import('@/app/api/bookdate/config/route');
    const response = await DELETE({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
  });

  it('returns 404 when deleting missing BookDate config', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce(null);

    const { DELETE } = await import('@/app/api/bookdate/config/route');
    const response = await DELETE({} as any);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/Configuration not found/);
  });

  it('returns BookDate preferences', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      bookDateLibraryScope: 'full',
      bookDateCustomPrompt: null,
      bookDateOnboardingComplete: true,
    });
    configServiceMock.getBackendMode.mockResolvedValueOnce('plex');

    const { GET } = await import('@/app/api/bookdate/preferences/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.libraryScope).toBe('full');
    expect(payload.onboardingComplete).toBe(true);
  });

  it('updates BookDate preferences', async () => {
    configServiceMock.getBackendMode.mockResolvedValueOnce('plex');
    prismaMock.user.update.mockResolvedValueOnce({
      bookDateLibraryScope: 'rated',
      bookDateCustomPrompt: 'Prompt',
      bookDateOnboardingComplete: true,
    });
    authRequest.json.mockResolvedValue({ libraryScope: 'rated', customPrompt: 'Prompt', onboardingComplete: true });

    const { PUT } = await import('@/app/api/bookdate/preferences/route');
    const response = await PUT({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.libraryScope).toBe('rated');
  });

  it('returns cached recommendations without calling AI', async () => {
    prismaMock.bookDateRecommendation.findMany.mockResolvedValueOnce([{ id: 'rec-1' }]);

    const { GET } = await import('@/app/api/bookdate/recommendations/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.source).toBe('cache');
    expect(payload.recommendations).toHaveLength(1);
  });

  it('returns error when recommendations are disabled', async () => {
    prismaMock.bookDateRecommendation.findMany.mockResolvedValueOnce([]);
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      isVerified: true,
      isEnabled: false,
    });

    const { GET } = await import('@/app/api/bookdate/recommendations/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/not configured/i);
  });

  it('returns 404 when recommendation user is missing', async () => {
    prismaMock.bookDateRecommendation.findMany.mockResolvedValueOnce([]);
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      isVerified: true,
      isEnabled: true,
      provider: 'openai',
      model: 'gpt',
      apiKey: 'enc-key',
    });
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const { GET } = await import('@/app/api/bookdate/recommendations/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/User not found/i);
  });

  it('generates and stores recommendations when AI returns matches', async () => {
    prismaMock.bookDateRecommendation.findMany.mockResolvedValueOnce([]);
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      isVerified: true,
      isEnabled: true,
      provider: 'openai',
      model: 'gpt',
      apiKey: 'enc-key',
      baseUrl: null,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      bookDateLibraryScope: 'full',
      bookDateCustomPrompt: null,
    });
    bookdateHelpersMock.buildAIPrompt.mockResolvedValueOnce('{}');
    bookdateHelpersMock.callAI.mockResolvedValueOnce({
      recommendations: [{ title: 'Title', author: 'Author', reason: 'Because' }],
    });
    bookdateHelpersMock.isAlreadySwiped.mockResolvedValue(false);
    bookdateHelpersMock.isInLibrary.mockResolvedValue(false);
    bookdateHelpersMock.matchToAudnexus.mockResolvedValueOnce({
      asin: 'ASIN1',
      title: 'Title',
      author: 'Author',
      narrator: null,
      rating: null,
      description: null,
      coverUrl: null,
    });
    bookdateHelpersMock.isAlreadyRequested.mockResolvedValue(false);
    (prismaMock.bookDateRecommendation as any).createMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    prismaMock.bookDateRecommendation.findMany.mockResolvedValueOnce([{ id: 'rec-1' }]);

    const { GET } = await import('@/app/api/bookdate/recommendations/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.source).toBe('generated');
    expect(prismaMock.bookDateRecommendation.createMany).toHaveBeenCalled();
    expect(payload.recommendations).toHaveLength(1);
  });

  it('returns 500 when AI response is missing recommendations', async () => {
    prismaMock.bookDateRecommendation.findMany.mockResolvedValueOnce([]);
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      isVerified: true,
      isEnabled: true,
      provider: 'openai',
      model: 'gpt',
      apiKey: 'enc-key',
      baseUrl: null,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      bookDateLibraryScope: 'full',
      bookDateCustomPrompt: null,
    });
    bookdateHelpersMock.buildAIPrompt.mockResolvedValueOnce('{}');
    bookdateHelpersMock.callAI.mockResolvedValueOnce({ invalid: true });

    const { GET } = await import('@/app/api/bookdate/recommendations/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/Invalid AI response format/);
  });

  it('returns generated response even when no valid recommendations match', async () => {
    prismaMock.bookDateRecommendation.findMany.mockResolvedValueOnce([]);
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      isVerified: true,
      isEnabled: true,
      provider: 'openai',
      model: 'gpt',
      apiKey: 'enc-key',
      baseUrl: null,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      bookDateLibraryScope: 'full',
      bookDateCustomPrompt: null,
    });
    bookdateHelpersMock.buildAIPrompt.mockResolvedValueOnce('{}');
    bookdateHelpersMock.callAI.mockResolvedValueOnce({
      recommendations: [{ title: 'Title only' }, { author: 'Author only' }],
    });
    prismaMock.bookDateRecommendation.findMany.mockResolvedValueOnce([]);
    (prismaMock.bookDateRecommendation as any).createMany = vi.fn();

    const { GET } = await import('@/app/api/bookdate/recommendations/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.source).toBe('generated');
    expect(payload.generatedCount).toBe(0);
    expect((prismaMock.bookDateRecommendation as any).createMany).not.toHaveBeenCalled();
  });

  it('returns error when generating recommendations without config', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/bookdate/generate/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/not configured/);
  });

  it('returns 404 when no new recommendations can be matched', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      isVerified: true,
      isEnabled: true,
      provider: 'openai',
      model: 'gpt',
      apiKey: 'enc-key',
      baseUrl: null,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      bookDateLibraryScope: 'full',
      bookDateCustomPrompt: null,
    });
    bookdateHelpersMock.buildAIPrompt.mockResolvedValueOnce('{}');
    bookdateHelpersMock.callAI.mockResolvedValueOnce({
      recommendations: [{ title: 'Title', author: 'Author' }],
    });
    bookdateHelpersMock.isAlreadySwiped.mockResolvedValue(false);
    bookdateHelpersMock.isInLibrary.mockResolvedValue(false);
    bookdateHelpersMock.matchToAudnexus.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/bookdate/generate/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/Could not find any new recommendations/i);
  });

  it('returns 404 when user is missing during generation', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      isVerified: true,
      isEnabled: true,
      provider: 'openai',
      model: 'gpt',
      apiKey: 'enc-key',
      baseUrl: null,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/bookdate/generate/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/User not found/);
  });

  it('returns 500 when generate receives invalid AI response', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      isVerified: true,
      isEnabled: true,
      provider: 'openai',
      model: 'gpt',
      apiKey: 'enc-key',
      baseUrl: null,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      bookDateLibraryScope: 'full',
      bookDateCustomPrompt: null,
    });
    bookdateHelpersMock.buildAIPrompt.mockResolvedValueOnce('{}');
    bookdateHelpersMock.callAI.mockResolvedValueOnce({ invalid: true });

    const { POST } = await import('@/app/api/bookdate/generate/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/Invalid AI response format/);
  });

  it('stores generated recommendations from the AI', async () => {
    prismaMock.bookDateConfig.findFirst.mockResolvedValueOnce({
      isVerified: true,
      isEnabled: true,
      provider: 'openai',
      model: 'gpt',
      apiKey: 'enc-key',
      baseUrl: null,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      bookDateLibraryScope: 'full',
      bookDateCustomPrompt: null,
    });
    bookdateHelpersMock.buildAIPrompt.mockResolvedValueOnce('{}');
    bookdateHelpersMock.callAI.mockResolvedValueOnce({
      recommendations: [{ title: 'Title', author: 'Author', reason: 'Because' }],
    });
    bookdateHelpersMock.isAlreadySwiped.mockResolvedValue(false);
    bookdateHelpersMock.isInLibrary.mockResolvedValue(false);
    bookdateHelpersMock.matchToAudnexus.mockResolvedValueOnce({
      asin: 'ASIN1',
      title: 'Title',
      author: 'Author',
      narrator: null,
      rating: null,
      description: null,
      coverUrl: null,
    });
    bookdateHelpersMock.isAlreadyRequested.mockResolvedValue(false);
    (prismaMock.bookDateRecommendation as any).createMany = vi.fn().mockResolvedValueOnce({ count: 1 });
    prismaMock.bookDateRecommendation.findMany.mockResolvedValueOnce([{ id: 'rec-2' }]);

    const { POST } = await import('@/app/api/bookdate/generate/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.source).toBe('generated');
    expect(prismaMock.bookDateRecommendation.createMany).toHaveBeenCalled();
    expect(payload.recommendations).toHaveLength(1);
  });

  it('returns 400 when swipe payload is missing fields', async () => {
    authRequest.json.mockResolvedValue({ action: 'left' });

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/recommendationId and action/);
  });

  it('returns 400 when swipe action is invalid', async () => {
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-1', action: 'sideways' });

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid action/);
  });

  it('returns 404 when recommendation is missing', async () => {
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-1', action: 'left' });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/Recommendation not found/);
  });

  it('does not create a request when right swipe is marked as known', async () => {
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-known', action: 'right', markedAsKnown: true });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-known',
      userId: 'user-1',
      title: 'Known Book',
      author: 'Known Author',
      audnexusAsin: 'ASIN-KNOWN',
    } as any);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('records left swipe without creating a request', async () => {
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-left', action: 'left' });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-left',
      userId: 'user-1',
      title: 'Left Book',
      author: 'Left Author',
      audnexusAsin: 'ASIN-LEFT',
    } as any);
    prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('updates existing audiobook year when Audnexus provides releaseDate', async () => {
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-year', action: 'right', markedAsKnown: false });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-year',
      userId: 'user-1',
      title: 'Year Book',
      author: 'Year Author',
      audnexusAsin: 'ASIN-YEAR',
    } as any);
    prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);
    audibleServiceMock.getAudiobookDetails.mockResolvedValueOnce({
      releaseDate: '2020-01-15',
    });
    prismaMock.audiobook.findFirst.mockResolvedValueOnce({
      id: 'ab-year',
      title: 'Year Book',
      author: 'Year Author',
      audibleAsin: 'ASIN-YEAR',
    } as any);
    prismaMock.audiobook.update.mockResolvedValueOnce({ id: 'ab-year' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce({ id: 'req-existing' } as any);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({
      where: { id: 'ab-year' },
      data: { year: 2020 },
    });
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('records swipe and creates request on right swipe (admin auto-approves)', async () => {
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-1', action: 'right', markedAsKnown: false });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-1',
      userId: 'user-1',
      title: 'Title',
      author: 'Author',
      audnexusAsin: 'ASIN',
    } as any);
    prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audiobook.create.mockResolvedValueOnce({ id: 'ab-1', title: 'Title', author: 'Author', audibleAsin: 'ASIN' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      role: 'admin',
      autoApproveRequests: null,
      plexUsername: 'testuser',
    } as any);
    prismaMock.request.create.mockResolvedValueOnce({ id: 'req-1', audiobook: { title: 'Title' }, user: { id: 'user-1', plexUsername: 'testuser' } } as any);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
        }),
      })
    );
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_approved',
      'req-1',
      'Title',
      'Author',
      'testuser'
    );
    expect(jobQueueMock.addSearchJob).toHaveBeenCalled();
  });

  it('creates request with awaiting_approval status when approval required (user with autoApproveRequests=false)', async () => {
    authRequest = { user: { id: 'user-2', role: 'user' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-2', action: 'right', markedAsKnown: false });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-2',
      userId: 'user-2',
      title: 'Title 2',
      author: 'Author 2',
      audnexusAsin: 'ASIN2',
    } as any);
    prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audiobook.create.mockResolvedValueOnce({ id: 'ab-2', title: 'Title 2', author: 'Author 2', audibleAsin: 'ASIN2' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-2',
      role: 'user',
      autoApproveRequests: false,
      plexUsername: 'testuser2',
    } as any);
    prismaMock.request.create.mockResolvedValueOnce({ id: 'req-2', audiobook: { title: 'Title 2' }, user: { id: 'user-2', plexUsername: 'testuser2' } } as any);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'awaiting_approval',
        }),
      })
    );
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_pending_approval',
      'req-2',
      'Title 2',
      'Author 2',
      'testuser2'
    );
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('creates request with pending status when user has autoApproveRequests=true', async () => {
    authRequest = { user: { id: 'user-3', role: 'user' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-3', action: 'right', markedAsKnown: false });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-3',
      userId: 'user-3',
      title: 'Title 3',
      author: 'Author 3',
      audnexusAsin: 'ASIN3',
    } as any);
    prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audiobook.create.mockResolvedValueOnce({ id: 'ab-3', title: 'Title 3', author: 'Author 3', audibleAsin: 'ASIN3' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-3',
      role: 'user',
      autoApproveRequests: true,
      plexUsername: 'testuser3',
    } as any);
    prismaMock.request.create.mockResolvedValueOnce({ id: 'req-3', audiobook: { title: 'Title 3' }, user: { id: 'user-3', plexUsername: 'testuser3' } } as any);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending',
        }),
      })
    );
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_approved',
      'req-3',
      'Title 3',
      'Author 3',
      'testuser3'
    );
    expect(jobQueueMock.addSearchJob).toHaveBeenCalled();
  });

  it('checks global setting when user autoApproveRequests is null', async () => {
    authRequest = { user: { id: 'user-4', role: 'user' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    authRequest.json.mockResolvedValue({ recommendationId: 'rec-4', action: 'right', markedAsKnown: false });
    prismaMock.bookDateRecommendation.findUnique.mockResolvedValueOnce({
      id: 'rec-4',
      userId: 'user-4',
      title: 'Title 4',
      author: 'Author 4',
      audnexusAsin: 'ASIN4',
    } as any);
    prismaMock.bookDateSwipe.create.mockResolvedValueOnce({} as any);
    prismaMock.audiobook.findFirst.mockResolvedValueOnce(null);
    prismaMock.audiobook.create.mockResolvedValueOnce({ id: 'ab-4', title: 'Title 4', author: 'Author 4', audibleAsin: 'ASIN4' } as any);
    prismaMock.request.findFirst.mockResolvedValueOnce(null);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-4',
      role: 'user',
      autoApproveRequests: null,
      plexUsername: 'testuser4',
    } as any);
    prismaMock.configuration.findUnique.mockResolvedValueOnce({
      key: 'auto_approve_requests',
      value: 'false',
    } as any);
    prismaMock.request.create.mockResolvedValueOnce({ id: 'req-4', audiobook: { title: 'Title 4' }, user: { id: 'user-4', plexUsername: 'testuser4' } } as any);

    const { POST } = await import('@/app/api/bookdate/swipe/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'awaiting_approval',
        }),
      })
    );
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_pending_approval',
      'req-4',
      'Title 4',
      'Author 4',
      'testuser4'
    );
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('undoes last swipe', async () => {
    prismaMock.bookDateSwipe.findFirst.mockResolvedValueOnce({
      id: 'swipe-1',
      recommendation: { id: 'rec-1', createdAt: new Date() },
    });
    prismaMock.bookDateRecommendation.findFirst.mockResolvedValueOnce(null);
    prismaMock.bookDateSwipe.delete.mockResolvedValueOnce({});
    prismaMock.bookDateRecommendation.update.mockResolvedValueOnce({ id: 'rec-1' });

    const { POST } = await import('@/app/api/bookdate/undo/route');
    const response = await POST({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
  });

  it('clears all swipes as admin', async () => {
    prismaMock.bookDateSwipe.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.bookDateRecommendation.deleteMany.mockResolvedValueOnce({ count: 1 });

    const { DELETE } = await import('@/app/api/bookdate/swipes/route');
    const response = await DELETE({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
  });

  it('tests BookDate connection without auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [{ id: 'model-1' }] }),
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('@/app/api/bookdate/test-connection/route');
    const response = await POST({
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({ provider: 'custom', baseUrl: 'http://custom', apiKey: '' }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.models[0].id).toBe('model-1');
  });
});

