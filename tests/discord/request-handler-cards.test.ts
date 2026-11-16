/**
 * Component: Discord /request Handler Tests: card announcement
 * Documentation: documentation/integrations/discord-bot.md
 *
 * A new request made with the Request button gets its card and approval message posted in
 * the background (through the facade, after the reply, even when the reply fails); a refused,
 * duplicate or failed request posts nothing.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASIN, fakeStep } from './discord-request-fakes';
import { PATH_ERROR, creator, h, linkAs, loadRequestHandlers, press, resetRequestHarness, state, toConfirm } from './request-handler-harness';

vi.mock('@/lib/db', async () => ({ prisma: (await import('./request-handler-harness')).prismaMock }));
vi.mock('@/lib/services/config.service', async () => {
  const { configService } = await import('./request-handler-harness');
  return { getConfigService: () => configService };
});
vi.mock('@/lib/integrations/audible.service', async () => {
  const { audible: fake } = await import('./request-handler-harness');
  return { getAudibleService: () => fake };
});
vi.mock('@/lib/services/request-creator.service', async () => (await import('./request-handler-harness')).creator);
vi.mock('@/lib/services/job-queue.service', async () => {
  const { jobQueue } = await import('./request-handler-harness');
  return { getJobQueueService: () => jobQueue };
});
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn(async () => ({ plexGuid: 'p' })) }));
vi.mock('@/lib/services/ebook-request-creator.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/ebook-request-creator.service')>();
  return { createEbookRequestForUser: vi.fn(actual.createEbookRequestForUser) };
});
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const announce = vi.hoisted(() => vi.fn());
vi.mock('@/lib/services/discord/discord-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/discord/discord-runtime')>()),
  announceDiscordRequest: announce,
}));

beforeAll(loadRequestHandlers);
beforeEach(resetRequestHarness);

describe('/request posts the new request\'s card', () => {
  it('audiobook created: announced with its ID, after the reply', async () => {
    creator.createRequestForUser.mockResolvedValue({ success: true, request: { id: 'req-1', status: 'awaiting_approval' } });
    const { confirmId } = await toConfirm('audiobook');
    const button = await press(confirmId);

    expect(announce).toHaveBeenCalledWith('req-1');
    expect(announce.mock.invocationCallOrder[0]).toBeGreaterThan(button.editReply.mock.invocationCallOrder.at(-1)!);
  });

  it('the reply fails after the request was made: still announced', async () => {
    creator.createRequestForUser.mockResolvedValue({ success: true, request: { id: 'req-1', status: 'awaiting_approval' } });
    const { confirmId } = await toConfirm('audiobook');
    const button = fakeStep('button', { customId: confirmId, order: state.order });
    button.editReply.mockRejectedValue(new Error('Unknown interaction'));
    await h.handleRequestComponent(button);

    expect(creator.createRequestForUser).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('req-1');
  });

  it('ebook created: announced with its ID', async () => {
    const { confirmId } = await toConfirm('ebook');
    await press(confirmId);
    expect(announce).toHaveBeenCalledWith('ebook-1');
  });

  it.each([
    ['a duplicate', { success: false, reason: 'duplicate', message: 'x' }],
    ['already in the library', { success: false, reason: 'already_available', message: 'x' }],
  ])('audiobook %s: nothing announced', async (_label, result) => {
    creator.createRequestForUser.mockResolvedValue(result);
    const { confirmId } = await toConfirm('audiobook');
    await press(confirmId);
    expect(announce).not.toHaveBeenCalled();
  });

  it('a creator error or a refused account: nothing announced', async () => {
    creator.createRequestForUser.mockRejectedValue(new Error(PATH_ERROR));
    const { confirmId } = await toConfirm('audiobook');
    await press(confirmId);
    linkAs(null);
    await press(confirmId);
    expect(announce).not.toHaveBeenCalled();
    expect(ASIN).toBeTruthy();
  });
});
